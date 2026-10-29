-- User-scoped operational notifications and company workspace defaults.
-- Notification text is generated from workflow status only; no employee or
-- payroll values are copied into the inbox.

create table public.company_workspace_settings (
  portfolio_id uuid not null,
  company_id uuid not null,
  timezone text not null default 'Africa/Lusaka',
  date_format text not null default 'DD/MM/YYYY' check (date_format in ('DD/MM/YYYY','YYYY-MM-DD')),
  currency_code text not null default 'ZMW' check (currency_code = 'ZMW'),
  payroll_cutoff_day integer not null default 25 check (payroll_cutoff_day between 1 and 28),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (portfolio_id,company_id),
  foreign key (portfolio_id,company_id) references public.companies(portfolio_id,id) on delete restrict
);
alter table public.company_workspace_settings enable row level security;
revoke all on public.company_workspace_settings from public,anon,authenticated;
grant select on public.company_workspace_settings to authenticated;
create policy company_workspace_settings_read on public.company_workspace_settings for select to authenticated
  using (app_private.has_permission('company.view',portfolio_id,company_id,null));

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('EMPLOYEE','LEAVE','ATTENDANCE','PAYROLL')),
  source_id uuid not null,
  transition text not null,
  title text not null,
  message text not null,
  action_path text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  foreign key(portfolio_id,company_id) references public.companies(portfolio_id,id) on delete restrict,
  foreign key(portfolio_id,company_id,branch_id) references public.branches(portfolio_id,company_id,id) on delete restrict
);
create index user_notifications_inbox_idx on public.user_notifications(recipient_id,created_at desc,id);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public,anon,authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at) on public.user_notifications to authenticated;
create policy user_notifications_read_own on public.user_notifications for select to authenticated
  using(recipient_id=auth.uid());
create policy user_notifications_update_own_read_state on public.user_notifications for update to authenticated
  using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());

create or replace function app_private.capture_workflow_notification()
returns trigger language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_recipient uuid;
  v_actor uuid;
  v_portfolio uuid;
  v_company uuid;
  v_branch uuid;
  v_status text;
  v_source_id uuid;
  v_source_type text:=tg_argv[0];
  v_action_path text:=tg_argv[1];
begin
  v_old:=to_jsonb(old);
  v_new:=to_jsonb(new);
  v_status:=v_new->>tg_argv[3];
  if v_old->>tg_argv[3] is not distinct from v_status then return new; end if;
  v_recipient:=nullif(v_new->>tg_argv[2],'')::uuid;
  v_actor:=auth.uid();
  v_source_id:=nullif(v_new->>'id','')::uuid;
  v_portfolio:=nullif(v_new->>'portfolio_id','')::uuid;
  v_company:=nullif(v_new->>'company_id','')::uuid;
  v_branch:=nullif(v_new->>'workplace_branch_id','')::uuid;
  if v_branch is null then v_branch:=nullif(v_new->>'branch_id','')::uuid; end if;
  if v_recipient is null or v_recipient=v_actor or v_source_id is null or v_portfolio is null or v_company is null then return new; end if;
  insert into public.user_notifications(portfolio_id,company_id,branch_id,recipient_id,source_type,source_id,transition,title,message,action_path)
  values(v_portfolio,v_company,v_branch,v_recipient,v_source_type,v_source_id,v_status,
    initcap(lower(v_source_type))||' workflow updated',
    'Your '||lower(v_source_type)||' record status changed to '||lower(replace(v_status,'_',' '))||'.',
    v_action_path);
  return new;
end $$;
revoke all on function app_private.capture_workflow_notification() from public,anon,authenticated;

create trigger employee_workflow_notification after update of approval_status on public.employees
  for each row execute function app_private.capture_workflow_notification('EMPLOYEE','/employees','created_by','approval_status');
create trigger leave_workflow_notification after update of status on public.leave_requests
  for each row execute function app_private.capture_workflow_notification('LEAVE','/leave','requested_by','status');
create trigger attendance_workflow_notification after update of status on public.attendance_periods
  for each row execute function app_private.capture_workflow_notification('ATTENDANCE','/attendance','created_by','status');
create trigger payroll_workflow_notification after update of status on public.payroll_runs
  for each row execute function app_private.capture_workflow_notification('PAYROLL','/payroll','created_by','status');

create or replace function public.company_workspace_settings_save(
  p_company_id uuid,p_timezone text,p_date_format text,p_currency_code text,p_payroll_cutoff_day integer
) returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v_company public.companies%rowtype;
begin
  select * into v_company from public.companies where id=p_company_id;
  if not found or auth.uid() is null or not app_private.can_manage_company_hr_configuration(p_company_id)
    or nullif(btrim(p_timezone),'') is null
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
    or p_date_format is null or p_date_format not in ('DD/MM/YYYY','YYYY-MM-DD')
    or p_currency_code is distinct from 'ZMW'
    or p_payroll_cutoff_day is null or p_payroll_cutoff_day not between 1 and 28 then
    raise exception using errcode='42501',message='Workspace settings are invalid or unauthorized.';
  end if;
  insert into public.company_workspace_settings(portfolio_id,company_id,timezone,date_format,currency_code,payroll_cutoff_day,updated_by)
  values(v_company.portfolio_id,v_company.id,p_timezone,p_date_format,p_currency_code,p_payroll_cutoff_day,auth.uid())
  on conflict(portfolio_id,company_id) do update set timezone=excluded.timezone,date_format=excluded.date_format,
    currency_code=excluded.currency_code,payroll_cutoff_day=excluded.payroll_cutoff_day,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
  values(v_company.portfolio_id,v_company.id,auth.uid(),'WORKSPACE_SETTINGS_UPDATED','settings',v_company.id::text,
    jsonb_build_object('timezone',p_timezone,'date_format',p_date_format,'currency_code',p_currency_code,'payroll_cutoff_day',p_payroll_cutoff_day));
  return v_company.id;
end $$;
revoke all on function public.company_workspace_settings_save(uuid,text,text,text,integer) from public,anon;
grant execute on function public.company_workspace_settings_save(uuid,text,text,text,integer) to authenticated;

comment on table public.user_notifications is 'Private per-user workflow inbox. Messages contain status changes only; no payroll or employee values.';
comment on table public.company_workspace_settings is 'Company-scoped display and planning defaults; payroll cut-off is informational and does not block payroll actions.';
