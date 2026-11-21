-- Effective-dated employee lifecycle, contract history, and payroll eligibility.
-- Approved lifecycle changes are requests reviewed by a second authorized user.

alter table public.employees drop constraint if exists employees_employment_status_check;
alter table public.employees add constraint employees_employment_status_check
  check (employment_status in ('ACTIVE', 'SUSPENDED', 'SEPARATED', 'TERMINATED'));

alter table public.employee_employment_history
  drop constraint if exists employee_employment_history_previous_status_check,
  drop constraint if exists employee_employment_history_new_status_check;
alter table public.employee_employment_history
  add constraint employee_employment_history_previous_status_check
    check (previous_status in ('ACTIVE', 'SUSPENDED', 'SEPARATED', 'TERMINATED')),
  add constraint employee_employment_history_new_status_check
    check (new_status in ('ACTIVE', 'SUSPENDED', 'SEPARATED', 'TERMINATED'));
alter table public.employee_employment_history drop constraint if exists employee_employment_history_reason_check;
alter table public.employee_employment_history add constraint employee_employment_history_reason_check
  check (char_length(btrim(reason)) between 3 and 2000);
alter table public.employee_employment_history
  add column if not exists effective_date date,
  add column if not exists action text not null default 'STATUS_CHANGE',
  add column if not exists pay_classification text,
  add column if not exists expected_return_date date,
  add column if not exists last_working_day date,
  add column if not exists notice_details text,
  add column if not exists settlement_notes text,
  add column if not exists hr_notes text;
update public.employee_employment_history set effective_date = occurred_at::date where effective_date is null;
alter table public.employee_employment_history alter column effective_date set not null;
alter table public.employee_employment_history
  add constraint employee_employment_history_action_check
    check (action in ('STATUS_CHANGE', 'SUSPENSION', 'SUSPENSION_LIFTED', 'SEPARATION', 'TERMINATION', 'REACTIVATION')),
  add constraint employee_employment_history_pay_classification_check
    check (pay_classification is null or pay_classification in ('PAID', 'UNPAID'));

create table public.employee_lifecycle_requests (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  action text not null check (action in ('SUSPENSION', 'SUSPENSION_LIFTED', 'SEPARATION', 'TERMINATION', 'REACTIVATION', 'CONTRACT_RENEWAL')),
  effective_date date not null,
  previous_status text not null check (previous_status in ('ACTIVE', 'SUSPENDED', 'SEPARATED', 'TERMINATED')),
  resulting_status text not null check (resulting_status in ('ACTIVE', 'SUSPENDED', 'SEPARATED', 'TERMINATED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  separation_type text check (separation_type is null or separation_type in ('RESIGNATION','RETIREMENT','MUTUAL_SEPARATION','REDUNDANCY','CONTRACT_COMPLETION','OTHER')),
  pay_classification text check (pay_classification is null or pay_classification in ('PAID', 'UNPAID')),
  expected_return_date date,
  last_working_day date,
  notice_details text,
  settlement_notes text,
  final_settlement_status text check (final_settlement_status is null or final_settlement_status in ('REVIEW_REQUIRED','IN_PROGRESS','APPROVED','PAID')),
  hr_notes text,
  contract_type text,
  contract_start_date date,
  contract_end_date date,
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_reason text,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (action <> 'SUSPENSION' or pay_classification is not null),
  check (expected_return_date is null or expected_return_date >= effective_date),
  check (last_working_day is null or last_working_day <= effective_date),
  check ((contract_start_date is null and contract_end_date is null) or
         (contract_start_date is not null and (contract_end_date is null or contract_end_date >= contract_start_date))),
  check ((status = 'PENDING_APPROVAL' and reviewed_by is null and reviewed_at is null) or
         (status <> 'PENDING_APPROVAL' and reviewed_by is not null and reviewed_at is not null))
);
create unique index employee_lifecycle_one_pending_request_idx
  on public.employee_lifecycle_requests(employee_id) where status = 'PENDING_APPROVAL';
create index employee_lifecycle_scope_status_idx
  on public.employee_lifecycle_requests(portfolio_id, company_id, branch_id, status, effective_date desc);
alter table public.employee_lifecycle_requests enable row level security;
revoke all on public.employee_lifecycle_requests from public, anon, authenticated;
grant select on public.employee_lifecycle_requests to authenticated;
create policy employee_lifecycle_requests_read_authorized on public.employee_lifecycle_requests
  for select to authenticated using (
    app_private.has_permission('employee.view', portfolio_id, company_id, branch_id)
    and (app_private.has_permission('employee.status.manage', portfolio_id, company_id, branch_id)
      or app_private.has_permission('employee.approve', portfolio_id, company_id, branch_id)
      or app_private.has_permission('employee.reject', portfolio_id, company_id, branch_id))
  );

create table public.employee_contract_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  contract_type text not null,
  contract_start_date date not null,
  contract_end_date date,
  source_request_id uuid not null references public.employee_lifecycle_requests(id) on delete restrict,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (contract_end_date is null or contract_end_date >= contract_start_date),
  unique (employee_id, source_request_id)
);
create index employee_contract_history_employee_dates_idx
  on public.employee_contract_history(employee_id, contract_start_date, contract_end_date);
alter table public.employee_contract_history enable row level security;
revoke all on public.employee_contract_history from public, anon, authenticated;
grant select on public.employee_contract_history to authenticated;
create policy employee_contract_history_read_authorized on public.employee_contract_history
  for select to authenticated using (app_private.has_permission('employee.view', portfolio_id, company_id, branch_id));

create or replace function app_private.employee_lifecycle_status_at(p_employee_id uuid, p_on_date date)
returns text language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_status text; v_employee public.employees%rowtype;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then return null; end if;
  select x.new_status into v_status from (
    select h.new_status, h.effective_date, h.occurred_at as recorded_at
      from public.employee_employment_history h where h.employee_id = p_employee_id
    union all
    select r.resulting_status, r.effective_date, r.reviewed_at
      from public.employee_lifecycle_requests r where r.employee_id = p_employee_id and r.status = 'APPROVED'
        and r.action <> 'CONTRACT_RENEWAL' and r.previous_status <> r.resulting_status
  ) x where x.effective_date <= p_on_date order by x.effective_date desc, x.recorded_at desc limit 1;
  if v_status is not null then return v_status; end if;
  select x.previous_status into v_status from (
    select h.previous_status, h.effective_date, h.occurred_at as recorded_at
      from public.employee_employment_history h where h.employee_id = p_employee_id
    union all
    select r.previous_status, r.effective_date, r.reviewed_at
      from public.employee_lifecycle_requests r where r.employee_id = p_employee_id and r.status = 'APPROVED'
        and r.action <> 'CONTRACT_RENEWAL' and r.previous_status <> r.resulting_status
  ) x order by x.effective_date, x.recorded_at limit 1;
  return coalesce(v_status, v_employee.employment_status);
end;
$$;
revoke all on function app_private.employee_lifecycle_status_at(uuid, date) from public, anon, authenticated;

create or replace function app_private.employee_payroll_date_eligibility(p_employee_id uuid, p_on_date date)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_status text;
  v_contract_matches integer;
  v_pay_classification text;
  v_last_working_day date;
  v_separation_previous_status text;
  v_warnings jsonb := '[]'::jsonb;
  v_eligible boolean := false;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.approval_status <> 'APPROVED' then
    return jsonb_build_object('eligible', false, 'warnings', jsonb_build_array('EMPLOYEE_NOT_APPROVED'));
  end if;
  select count(*)::integer into v_contract_matches from (
    select h.contract_start_date, h.contract_end_date from public.employee_contract_history h
      where h.employee_id = p_employee_id and h.contract_start_date <= p_on_date
        and (h.contract_end_date is null or h.contract_end_date >= p_on_date)
    union all
    select e.contract_start_date, e.contract_end_date from public.employees e
      where e.id = p_employee_id and e.contract_start_date <= p_on_date
        and (e.contract_end_date is null or e.contract_end_date >= p_on_date)
        and not exists (select 1 from public.employee_contract_history h where h.employee_id=e.id
          and h.contract_start_date=e.contract_start_date and h.contract_end_date is not distinct from e.contract_end_date)
  ) contracts;
  if v_contract_matches > 1 then
    v_warnings := v_warnings || jsonb_build_array('OVERLAPPING_CONTRACT_BASES');
  elsif v_contract_matches = 0 then
    return jsonb_build_object('eligible', false, 'warnings', jsonb_build_array('NO_VALID_CONTRACT_OR_EMPLOYMENT_BASIS'));
  end if;
  v_status := app_private.employee_lifecycle_status_at(p_employee_id, p_on_date);
  -- A last working day remains the final payable employment date even when
  -- the administrative separation effective date is recorded later.
  select r.previous_status, r.last_working_day into v_separation_previous_status, v_last_working_day
    from public.employee_lifecycle_requests r
    where r.employee_id=p_employee_id and r.status='APPROVED' and r.action in ('SEPARATION','TERMINATION')
      and r.effective_date<=p_on_date order by r.effective_date desc,r.reviewed_at desc limit 1;
  if v_separation_previous_status is not null and v_last_working_day is not null and p_on_date<=v_last_working_day then
    v_status:=v_separation_previous_status;
  end if;
  if v_status = 'ACTIVE' then
    v_eligible := v_contract_matches = 1;
  elsif v_status = 'SUSPENDED' then
    select h.pay_classification into v_pay_classification from public.employee_employment_history h
      where h.employee_id=p_employee_id and h.new_status='SUSPENDED' and h.effective_date<=p_on_date
      order by h.effective_date desc,h.occurred_at desc limit 1;
    if v_pay_classification = 'UNPAID' then
      v_eligible := false;
    else
      v_eligible := v_contract_matches = 1;
      v_warnings := v_warnings || jsonb_build_array(case when v_pay_classification='PAID'
        then 'PAID_SUSPENSION_POLICY_REQUIRES_REVIEW' else 'SUSPENSION_PAY_CLASSIFICATION_REQUIRES_REVIEW' end);
    end if;
  else
    v_eligible := false;
  end if;
  select r.last_working_day into v_last_working_day from public.employee_lifecycle_requests r
    where r.employee_id=p_employee_id and r.status='APPROVED' and r.action in ('SEPARATION','TERMINATION')
      and r.effective_date>p_on_date and r.last_working_day is not null and r.last_working_day<p_on_date
    order by r.effective_date limit 1;
  if v_last_working_day is not null then v_eligible := false; end if;
  if v_contract_matches > 1 then v_eligible := false; end if;
  return jsonb_build_object('eligible',v_eligible,'status',v_status,'warnings',v_warnings);
end;
$$;
revoke all on function app_private.employee_payroll_date_eligibility(uuid, date) from public, anon, authenticated;

create or replace function public.employee_lifecycle_capabilities(p_employee_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.employees%rowtype;
begin
  select * into v from public.employees where id=p_employee_id;
  if not found or not app_private.has_permission('employee.view',v.portfolio_id,v.company_id,v.workplace_branch_id) then
    raise exception using errcode='42501',message='Employee lifecycle access is not authorized.';
  end if;
  return jsonb_build_object(
    'can_request',app_private.has_permission('employee.status.manage',v.portfolio_id,v.company_id,v.workplace_branch_id),
    'can_approve',app_private.has_permission('employee.approve',v.portfolio_id,v.company_id,v.workplace_branch_id),
    'can_reject',app_private.has_permission('employee.reject',v.portfolio_id,v.company_id,v.workplace_branch_id),
    'status',app_private.employee_lifecycle_status_at(p_employee_id,current_date),
    'current_user_id',auth.uid(),
    'contract_expired',v.contract_end_date is not null and v.contract_end_date<current_date,
    'contract_end_date',v.contract_end_date
  );
end;
$$;
revoke all on function public.employee_lifecycle_capabilities(uuid) from public, anon;
grant execute on function public.employee_lifecycle_capabilities(uuid) to authenticated;

create or replace function public.employee_lifecycle_roster(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_company_id uuid default null,p_branch_id uuid default null,p_department_id uuid default null,
  p_status text default null
)
returns table(
  id uuid,portfolio_id uuid,company_id uuid,workplace_branch_id uuid,employee_number text,first_name text,middle_name text,last_name text,
  job_title text,department text,employment_type text,contract_type text,contract_start_date date,contract_end_date date,
  retirement_age integer,retirement_status text,approval_status text,employment_status text,lifecycle_status text,
  contract_expired boolean,can_manage_lifecycle boolean,can_approve_lifecycle boolean,
  submitted_at timestamptz,reviewed_at timestamptz,created_at timestamptz,total_count bigint
)
language plpgsql stable security definer set search_path=pg_catalog set row_security=off
as $$
begin
  if p_page is null or p_page_size is null or p_page<1 or p_page_size<1 or p_page_size>100
    or (p_status is not null and p_status not in ('ACTIVE','SUSPENDED','SEPARATED','TERMINATED','CONTRACT_EXPIRED')) then
    raise exception using errcode='22023',message='Invalid lifecycle roster filter.';
  end if;
  return query
  with scoped as (
    select e.*,app_private.employee_lifecycle_status_at(e.id,current_date) as effective_status,
      (e.contract_end_date is not null and e.contract_end_date<current_date) as is_contract_expired
    from public.employees e
    where e.approval_status='APPROVED'
      and app_private.has_permission('employee.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
      and (p_company_id is null or e.company_id=p_company_id)
      and (p_branch_id is null or e.workplace_branch_id=p_branch_id)
      and (p_department_id is null or e.department_id=p_department_id)
      and (p_search is null or btrim(p_search)='' or e.employee_number ilike '%'||btrim(p_search)||'%'
        or e.first_name ilike '%'||btrim(p_search)||'%' or e.last_name ilike '%'||btrim(p_search)||'%')
  ), filtered as (
    select s.* from scoped s where p_status is null or
      (p_status='CONTRACT_EXPIRED' and s.effective_status='ACTIVE' and s.is_contract_expired) or
      (p_status<>'CONTRACT_EXPIRED' and p_status=s.effective_status and not s.is_contract_expired)
  )
  select f.id,f.portfolio_id,f.company_id,f.workplace_branch_id,f.employee_number,f.first_name,f.middle_name,f.last_name,
    f.job_title,f.department,f.employment_type,f.contract_type,f.contract_start_date,f.contract_end_date,
    f.retirement_age,f.retirement_status,f.approval_status,f.employment_status,f.effective_status,f.is_contract_expired,
    app_private.has_permission('employee.status.manage',f.portfolio_id,f.company_id,f.workplace_branch_id),
    app_private.has_permission('employee.approve',f.portfolio_id,f.company_id,f.workplace_branch_id),
    f.submitted_at,f.reviewed_at,f.created_at,count(*) over()
  from filtered f order by f.last_name,f.first_name,f.employee_number
  offset (p_page-1)*p_page_size limit p_page_size;
end;
$$;
revoke all on function public.employee_lifecycle_roster(integer,integer,text,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.employee_lifecycle_roster(integer,integer,text,uuid,uuid,uuid,text) to authenticated;

create or replace function public.employee_lifecycle_summary(p_company_id uuid default null,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set row_security=off
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'active',count(*) filter(where s.status='ACTIVE' and not s.expired),
    'suspended',count(*) filter(where s.status='SUSPENDED'),
    'separated',count(*) filter(where s.status='SEPARATED'),
    'terminated',count(*) filter(where s.status='TERMINATED'),
    'contract_expired',count(*) filter(where s.status='ACTIVE' and s.expired),
    'upcoming_expiry',count(*) filter(where s.status='ACTIVE' and s.contract_end_date between current_date and current_date+60),
    'final_settlement_review',count(*) filter(where s.final_settlement_status in ('REVIEW_REQUIRED','IN_PROGRESS'))
  ) into v_result
  from (
    select e.id,app_private.employee_lifecycle_status_at(e.id,current_date) as status,
      e.contract_end_date,(e.contract_end_date is not null and e.contract_end_date<current_date) as expired,
      (select r.final_settlement_status from public.employee_lifecycle_requests r where r.employee_id=e.id and r.status='APPROVED'
        and r.action in ('SEPARATION','TERMINATION') order by r.effective_date desc,r.reviewed_at desc limit 1) as final_settlement_status
    from public.employees e where e.approval_status='APPROVED'
      and app_private.has_permission('employee.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
      and (p_company_id is null or e.company_id=p_company_id)
      and (p_branch_id is null or e.workplace_branch_id=p_branch_id)
  ) s;
  return v_result;
end;
$$;
revoke all on function public.employee_lifecycle_summary(uuid,uuid) from public,anon;
grant execute on function public.employee_lifecycle_summary(uuid,uuid) to authenticated;

create or replace function public.employee_lifecycle_request_create(p_employee_id uuid, p_request jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_action text := upper(coalesce(p_request->>'action',''));
  v_date date := nullif(p_request->>'effective_date','')::date;
  v_reason text := nullif(btrim(p_request->>'reason'),'');
  v_current text;
  v_resulting text;
  v_id uuid;
  v_new_start date := nullif(p_request->>'contract_start_date','')::date;
  v_new_end date := nullif(p_request->>'contract_end_date','')::date;
begin
  if auth.uid() is null or v_action not in ('SUSPENSION','SUSPENSION_LIFTED','SEPARATION','TERMINATION','REACTIVATION','CONTRACT_RENEWAL')
    or v_date is null or v_reason is null or char_length(v_reason)<3 then
    raise exception using errcode='22023',message='Select a lifecycle action, effective date, and reason of at least three characters.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or v_employee.approval_status<>'APPROVED' or not app_private.has_permission('employee.status.manage',v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id) then
    raise exception using errcode='42501',message='Employee lifecycle request is not authorized.';
  end if;
  if exists(select 1 from public.employee_lifecycle_requests where employee_id=p_employee_id and status='PENDING_APPROVAL') then
    raise exception using errcode='23505',message='Resolve the existing pending lifecycle request before submitting another.';
  end if;
  v_current := app_private.employee_lifecycle_status_at(p_employee_id,v_date);
  v_resulting := case v_action when 'SUSPENSION' then 'SUSPENDED' when 'SEPARATION' then 'SEPARATED'
    when 'TERMINATION' then 'TERMINATED' when 'SUSPENSION_LIFTED' then 'ACTIVE' when 'REACTIVATION' then 'ACTIVE' else v_current end;
  if v_action='SUSPENSION' and (v_current<>'ACTIVE' or coalesce(p_request->>'pay_classification','') not in ('PAID','UNPAID')) then
    raise exception using errcode='22023',message='Suspension requires an active employee and a paid or unpaid classification.';
  elsif v_action='SUSPENSION_LIFTED' and v_current<>'SUSPENDED' then
    raise exception using errcode='22023',message='Only a suspended employee can have a suspension lifted.';
  elsif v_action in ('SEPARATION','TERMINATION') and v_current not in ('ACTIVE','SUSPENDED') then
    raise exception using errcode='22023',message='Separation or termination requires an active or suspended employee.';
  elsif v_action='REACTIVATION' and v_current not in ('SUSPENDED','SEPARATED','TERMINATED') then
    raise exception using errcode='22023',message='Only a suspended, separated, or terminated employee can be reactivated.';
  elsif v_action='CONTRACT_RENEWAL' and v_current not in ('ACTIVE','SUSPENDED') then
    raise exception using errcode='22023',message='Renew a contract only for an active or suspended employee; use reactivation for a separated employee.';
  elsif v_action='CONTRACT_RENEWAL' and (v_new_start is null or nullif(btrim(p_request->>'contract_type'),'') is null or (v_new_end is not null and v_new_end<v_new_start)) then
    raise exception using errcode='22023',message='Contract renewal requires a contract type and valid start/end dates.';
  end if;
  if v_action in ('CONTRACT_RENEWAL','REACTIVATION') and v_new_start is not null and v_new_start<v_date then
    raise exception using errcode='22023',message='The renewed contract cannot start before the lifecycle action effective date.';
  end if;
  if v_action in ('SEPARATION','TERMINATION') and nullif(p_request->>'last_working_day','') is null then
    raise exception using errcode='22023',message='Record the employee’s last working day.';
  end if;
  if v_action='SEPARATION' and coalesce(p_request->>'separation_type','') not in
      ('RESIGNATION','RETIREMENT','MUTUAL_SEPARATION','REDUNDANCY','CONTRACT_COMPLETION','OTHER') then
    raise exception using errcode='22023',message='Choose a supported separation type.';
  end if;
  if v_action='REACTIVATION' and (v_employee.contract_end_date is not null and v_employee.contract_end_date<v_date)
    and (v_new_start is null or nullif(btrim(p_request->>'contract_type'),'') is null or (v_new_end is not null and v_new_end<v_new_start)) then
    raise exception using errcode='22023',message='Reactivation requires a valid renewed contract or employment basis.';
  end if;
  insert into public.employee_lifecycle_requests(
    portfolio_id,company_id,branch_id,employee_id,action,effective_date,previous_status,resulting_status,reason,
    separation_type,pay_classification,expected_return_date,last_working_day,notice_details,settlement_notes,hr_notes,final_settlement_status,
    contract_type,contract_start_date,contract_end_date,requested_by
  ) values (
    v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,v_employee.id,v_action,v_date,v_current,v_resulting,v_reason,
    nullif(p_request->>'separation_type',''),nullif(p_request->>'pay_classification',''),nullif(p_request->>'expected_return_date','')::date,
    nullif(p_request->>'last_working_day','')::date,nullif(btrim(p_request->>'notice_details'),''),
    nullif(btrim(p_request->>'settlement_notes'),''),nullif(btrim(p_request->>'hr_notes'),''),
    case when v_action in ('SEPARATION','TERMINATION') then 'REVIEW_REQUIRED' else null end,
    coalesce(nullif(btrim(p_request->>'contract_type'),''),v_employee.contract_type),v_new_start,v_new_end,auth.uid()
  ) returning id into v_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),
      'EMPLOYEE_LIFECYCLE_REQUESTED','employees',v_id::text,jsonb_build_object('employee_id',v_employee.id,'action',v_action,'effective_date',v_date,'reason',v_reason));
  return v_id;
end;
$$;
revoke all on function public.employee_lifecycle_request_create(uuid,jsonb) from public, anon;
grant execute on function public.employee_lifecycle_request_create(uuid,jsonb) to authenticated;

create or replace function public.employee_lifecycle_request_review(p_request_id uuid,p_decision text,p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_request public.employee_lifecycle_requests%rowtype;
  v_employee public.employees%rowtype;
  v_permission text;
  v_contract_type text;
  v_start date;
  v_end date;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('APPROVE','REJECT')
    or (p_decision='REJECT' and char_length(btrim(coalesce(p_reason,'')))<3) then
    raise exception using errcode='22023',message='Choose approve or reject; rejection requires a reason.';
  end if;
  select * into v_request from public.employee_lifecycle_requests where id=p_request_id for update;
  if not found or v_request.status<>'PENDING_APPROVAL' or v_request.requested_by=auth.uid() then
    raise exception using errcode='42501',message='Lifecycle review is not authorized or the request is no longer pending.';
  end if;
  select * into v_employee from public.employees where id=v_request.employee_id for update;
  v_permission := case when p_decision='APPROVE' then 'employee.approve' else 'employee.reject' end;
  if not app_private.has_permission(v_permission,v_request.portfolio_id,v_request.company_id,v_request.branch_id) then
    raise exception using errcode='42501',message='Lifecycle review is not authorized for this employee scope.';
  end if;
  if p_decision='REJECT' then
    update public.employee_lifecycle_requests set status='REJECTED',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=btrim(p_reason) where id=v_request.id;
    insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
      values(v_request.portfolio_id,v_request.company_id,v_request.branch_id,auth.uid(),'EMPLOYEE_LIFECYCLE_REJECTED','employees',v_request.id::text,
        jsonb_build_object('employee_id',v_request.employee_id,'action',v_request.action,'reason',btrim(p_reason)));
    return v_request.id;
  end if;
  if app_private.employee_lifecycle_status_at(v_employee.id,v_request.effective_date) is distinct from v_request.previous_status then
    raise exception using errcode='40001',message='Employee lifecycle changed since this request was submitted. Refresh and review again.';
  end if;
  update public.employee_lifecycle_requests set status='APPROVED',reviewed_by=auth.uid(),reviewed_at=now() where id=v_request.id;
  if v_request.action in ('SUSPENSION','SUSPENSION_LIFTED','SEPARATION','TERMINATION','REACTIVATION') then
    insert into public.employee_employment_history(
      portfolio_id,company_id,branch_id,employee_id,previous_status,new_status,reason,actor_id,effective_date,action,
      pay_classification,expected_return_date,last_working_day,notice_details,settlement_notes,hr_notes
    ) values (
      v_request.portfolio_id,v_request.company_id,v_request.branch_id,v_request.employee_id,v_request.previous_status,
      v_request.resulting_status,v_request.reason,auth.uid(),v_request.effective_date,v_request.action,
      v_request.pay_classification,v_request.expected_return_date,v_request.last_working_day,
      v_request.notice_details,v_request.settlement_notes,v_request.hr_notes
    );
    if v_request.effective_date<=current_date then
      update public.employees set employment_status=v_request.resulting_status,updated_at=now() where id=v_employee.id;
    end if;
  end if;
  if v_request.action in ('CONTRACT_RENEWAL','REACTIVATION') and v_request.contract_start_date is not null then
    v_contract_type := coalesce(v_request.contract_type,v_employee.contract_type);
    v_start := v_request.contract_start_date;
    v_end := v_request.contract_end_date;
    insert into public.employee_contract_history(
      portfolio_id,company_id,branch_id,employee_id,contract_type,contract_start_date,contract_end_date,source_request_id,recorded_by
    ) select v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,v_employee.id,
        v_employee.contract_type,v_employee.contract_start_date,v_employee.contract_end_date,v_request.id,auth.uid()
      where not exists(select 1 from public.employee_contract_history h where h.employee_id=v_employee.id
        and h.contract_start_date=v_employee.contract_start_date and h.contract_end_date is not distinct from v_employee.contract_end_date);
    update public.employees set contract_type=v_contract_type,contract_start_date=v_start,contract_end_date=v_end,updated_at=now()
      where id=v_employee.id;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_request.portfolio_id,v_request.company_id,v_request.branch_id,auth.uid(),'EMPLOYEE_LIFECYCLE_APPROVED','employees',v_request.id::text,
      jsonb_build_object('employee_id',v_request.employee_id,'action',v_request.action,'effective_date',v_request.effective_date,
        'previous_status',v_request.previous_status,'resulting_status',v_request.resulting_status));
  return v_request.id;
end;
$$;
revoke all on function public.employee_lifecycle_request_review(uuid,text,text) from public, anon;
grant execute on function public.employee_lifecycle_request_review(uuid,text,text) to authenticated;
-- Prevent the legacy immediate status RPC from bypassing the new two-person,
-- effective-dated lifecycle approval workflow.
revoke all on function public.employee_set_employment_status(uuid,text,text) from public,anon,authenticated;

create or replace function app_private.payroll_employee_proration(
  p_employee_id uuid, p_period_start date, p_period_end date, p_scheduled_dates date[]
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_total_days integer := cardinality(p_scheduled_dates);
  v_eligible date[];
  v_eligible_days integer;
  v_gap_days integer;
  v_overlap_days integer;
  v_segment_count integer;
  v_segments jsonb;
  v_basic numeric(14,2);
  v_allowances jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_key text;
  v_missing_rule boolean;
  v_value numeric(14,2);
  v_needs_proration boolean;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then return jsonb_build_object('warnings', jsonb_build_array('EMPLOYEE_NOT_FOUND')); end if;
  select coalesce(array_agg(d order by d), '{}'::date[]) into v_eligible
  from unnest(p_scheduled_dates) d
  cross join lateral (select app_private.employee_payroll_date_eligibility(p_employee_id,d) as result) q
  where d between p_period_start and p_period_end and coalesce((q.result->>'eligible')::boolean,false);
  -- Also collect warnings from eligible dates, including company-policy gaps for paid suspension.
  select coalesce(jsonb_agg(distinct warning), '[]'::jsonb) into v_warnings
    from unnest(p_scheduled_dates) d
    cross join lateral (select app_private.employee_payroll_date_eligibility(p_employee_id,d) as result) q
    cross join lateral jsonb_array_elements(coalesce(q.result->'warnings','[]'::jsonb)) warning
    where d between p_period_start and p_period_end;
  v_eligible_days := cardinality(v_eligible);
  if v_total_days <= 0 or v_eligible_days <= 0 then
    return jsonb_build_object('eligible_scheduled_days',v_eligible_days,'total_scheduled_days',v_total_days,
      'warnings',v_warnings || jsonb_build_array('NO_ELIGIBLE_SCHEDULED_WORK_DAYS'),'valid_compensation',false);
  end if;
  select count(*) filter (where c.matches = 0), count(*) filter (where c.matches > 1)
    into v_gap_days, v_overlap_days
    from unnest(v_eligible) d
    cross join lateral (select count(*)::integer matches from public.employee_compensation ec
      where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
        and ec.workplace_branch_id = v_employee.workplace_branch_id
        and ec.effective_from <= d and (ec.effective_to is null or ec.effective_to >= d)) c;
  if v_gap_days > 0 then v_warnings := v_warnings || jsonb_build_array('COMPENSATION_GAP_FOR_SCHEDULED_DAYS'); end if;
  if v_overlap_days > 0 then v_warnings := v_warnings || jsonb_build_array('OVERLAPPING_COMPENSATION_FOR_SCHEDULED_DAYS'); end if;
  select count(*)::integer,
    round(sum(ec.basic_pay * covered.days / v_total_days)::numeric, 2),
    jsonb_agg(jsonb_build_object('effective_from', ec.effective_from, 'effective_to', ec.effective_to,
      'monthly_basic_pay', ec.basic_pay, 'eligible_scheduled_days', covered.days,
      'prorated_basic_pay', round(ec.basic_pay * covered.days / v_total_days, 2)) order by ec.effective_from)
    into v_segment_count, v_basic, v_segments
    from public.employee_compensation ec
    cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
      and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0;
  v_needs_proration := v_eligible_days < v_total_days or coalesce(v_segment_count, 0) > 1;
  foreach v_key in array array['housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances'] loop
    select exists (
      select 1 from public.employee_compensation ec
      cross join lateral (select count(*)::integer days from unnest(v_eligible) d
        where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
      where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
        and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0
        and case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end > 0
        and (ec.allowance_proration_rules ->> v_key) is distinct from 'SCHEDULED_DAYS'
    ) into v_missing_rule;
    if v_needs_proration and v_missing_rule then
      v_warnings := v_warnings || jsonb_build_array('ALLOWANCE_PRORATION_RULE_REQUIRED'); continue;
    end if;
    if v_needs_proration then
      select round(coalesce(sum((case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end) * covered.days / v_total_days), 0), 2)
        into v_value from public.employee_compensation ec
        cross join lateral (select count(*)::integer days from unnest(v_eligible) d
          where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
        where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
          and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0;
    else
      select case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end
        into v_value from public.employee_compensation ec
        where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id and ec.workplace_branch_id = v_employee.workplace_branch_id
          and ec.effective_from <= p_period_start and (ec.effective_to is null or ec.effective_to >= p_period_end) limit 1;
    end if;
    v_allowances := v_allowances || jsonb_build_object(v_key, coalesce(v_value, 0));
  end loop;
  if exists (select 1 from public.employee_compensation ec cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id=v_employee.id and ec.company_id=v_employee.company_id and ec.workplace_branch_id=v_employee.workplace_branch_id and covered.days>0 and ec.salary_frequency<>'MONTHLY')
  then v_warnings := v_warnings || jsonb_build_array('NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE'); end if;
  return jsonb_build_object('eligible_scheduled_days',v_eligible_days,'total_scheduled_days',v_total_days,
    'basic_pay',coalesce(v_basic,0),'allowances',v_allowances,'segments',coalesce(v_segments,'[]'::jsonb),
    'rounding','PostgreSQL NUMERIC round to 2 decimal places (half away from zero)','warnings',v_warnings,
    'valid_compensation',v_gap_days=0 and v_overlap_days=0);
end;
$$;
revoke all on function app_private.payroll_employee_proration(uuid,date,date,date[]) from public,anon,authenticated;

-- Extend the existing authoritative payroll input function to include lifecycle
-- candidates; the wrapper below excludes non-payable dates and blocks any
-- paid-suspension case until the company has a verified pay policy.
create or replace function public.payroll_preview_inputs_legacy(
  p_company_id uuid,
  p_branch_id uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_portfolio_id uuid; v_attendance public.attendance_periods%rowtype; v_result jsonb;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception using errcode = '22023', message = 'A valid payroll period is required.';
  end if;
  select b.portfolio_id into v_portfolio_id from public.branches b where b.company_id = p_company_id and b.id = p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare', v_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Payroll inputs are not authorized for this branch.';
  end if;
  select ap.* into v_attendance from public.attendance_periods ap
  where ap.portfolio_id = v_portfolio_id and ap.company_id = p_company_id and ap.branch_id = p_branch_id
    and ap.period_start = p_period_start and ap.period_end = p_period_end;
  if not found or v_attendance.status not in ('APPROVED', 'DRAFT') then
    raise exception using errcode = '22023', message = 'An approved attendance period matching the payroll dates is required.';
  end if;
  select jsonb_build_object(
    'portfolio_id', v_portfolio_id, 'company_id', p_company_id, 'branch_id', p_branch_id,
    'period_start', p_period_start, 'period_end', p_period_end, 'attendance_period_id', v_attendance.id,
    'attendance_approved_at', v_attendance.reviewed_at,
    'earning_inputs', coalesce((select jsonb_agg(jsonb_build_object(
      'id',pi.id,'employee_id',pi.employee_id,'employee_number',e2.employee_number,
      'employee_name',concat_ws(' ',e2.first_name,nullif(e2.middle_name,''),e2.last_name),
      'earning_type',pi.earning_type,'amount',pi.amount,'taxable_for_paye',pi.taxable_for_paye,
      'source_reference',pi.source_reference,'description',pi.description,'status',pi.status,
      'created_by',pi.created_by,'approved_by',pi.approved_by,'created_at',pi.created_at)
      order by pi.created_at,pi.id)
      from public.payroll_earning_inputs pi join public.employees e2 on e2.id=pi.employee_id
      where pi.portfolio_id=v_portfolio_id and pi.company_id=p_company_id and pi.branch_id=p_branch_id
        and pi.period_start=p_period_start and pi.period_end=p_period_end),'[]'::jsonb),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'employee_number', e.employee_number,
      'employee_name', concat_ws(' ', e.first_name, nullif(e.middle_name, ''), e.last_name),
      'contract_type', e.contract_type, 'employment_type', e.employment_type,
      'salary_frequency', comp.salary_frequency, 'compensation_effective_from', comp.effective_from,
      'basic_pay', comp.basic_pay, 'housing_allowance', comp.housing_allowance, 'meal_allowance', comp.meal_allowance,
      'transport_allowance', comp.transport_allowance, 'other_allowances', comp.other_allowances,
      'overtime_eligible', comp.overtime_eligible, 'unpaid_leave_deduction_method', comp.unpaid_leave_deduction_method, 'allowance_tax_treatment', comp.allowance_tax_treatment,
      'attendance', case when ae.id is null then null else jsonb_build_object(
        'scheduled_working_days', ae.scheduled_working_days, 'actual_days_worked', ae.actual_days_worked,
        'paid_leave_days', ae.paid_leave_days, 'unpaid_leave_days', ae.unpaid_leave_days,
        'other_payable_absence_days', ae.other_payable_absence_days) end,
      'approved_leave_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'leave_request_id', lr.id, 'pay_classification', lr.pay_classification, 'start_date', lr.start_date,
        'end_date', lr.end_date, 'leave_days', lr.leave_days) order by lr.start_date, lr.id)
        from public.leave_requests lr where lr.employee_id = e.id and lr.company_id = e.company_id
          and lr.branch_id = e.workplace_branch_id and lr.status = 'APPROVED'
          and lr.start_date <= p_period_end and lr.end_date >= p_period_start), '[]'::jsonb),
      'due_approved_deductions', coalesce((select jsonb_agg(jsonb_build_object(
        'deduction_id', d.id, 'installment_id', di.id, 'deduction_type', d.deduction_type,
        'scheduled_amount', di.scheduled_amount, 'due_period', di.due_period,
        'outstanding_balance', d.principal_amount - d.amount_deducted) order by di.due_period, d.id)
        from public.employee_deductions d join public.deduction_installments di on di.deduction_id = d.id and di.employee_id = d.employee_id
        where d.employee_id = e.id and d.status = 'ACTIVE' and di.due_period between p_period_start and p_period_end
          and di.scheduled_amount > 0), '[]'::jsonb),
      'approved_earnings', coalesce((select jsonb_agg(jsonb_build_object(
        'earning_input_id', pi.id, 'earning_type', pi.earning_type, 'amount', pi.amount,
        'taxable_for_paye', pi.taxable_for_paye, 'source_reference', pi.source_reference)
        order by pi.earning_type, pi.created_at, pi.id)
        from public.payroll_earning_inputs pi where pi.employee_id=e.id and pi.company_id=e.company_id
          and pi.period_start=p_period_start and pi.period_end=p_period_end and pi.status in ('APPROVED','RECORDED')), '[]'::jsonb),
      'input_warnings', to_jsonb(array_remove(array[
        case when comp.id is null then 'MISSING_EFFECTIVE_COMPENSATION' end,
        case when (select count(*) from public.employee_compensation ecx where ecx.employee_id=e.id
          and ecx.company_id=e.company_id and ecx.workplace_branch_id=e.workplace_branch_id
          and ecx.effective_from<=p_period_start and (ecx.effective_to is null or ecx.effective_to>=p_period_end)) <> 1
          then 'COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD' end,
        case when exists(select 1 from public.payroll_earning_inputs pending where pending.employee_id=e.id
          and pending.company_id=e.company_id and pending.period_start=p_period_start and pending.period_end=p_period_end
          and pending.status='SUBMITTED') then 'EARNING_INPUTS_AWAITING_APPROVAL' end,
        case when exists(select 1 from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
          and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED'
          and lr.start_date<=p_period_end and lr.end_date>=p_period_start
          and (lr.start_date<p_period_start or lr.end_date>p_period_end))
          then 'CROSS_PERIOD_LEAVE_REQUIRES_REVIEW' end,
        case when ae.id is not null and (
          coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
            and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='PAID'
            and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0) <> ae.paid_leave_days
          or coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
            and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='UNPAID'
            and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0) <> ae.unpaid_leave_days)
          then 'APPROVED_LEAVE_NOT_RECONCILED_WITH_ATTENDANCE' end,
        case when exists(select 1 from public.leave_requests la join public.leave_requests lb
          on lb.employee_id=la.employee_id and lb.id>la.id and lb.status='APPROVED'
          and daterange(lb.start_date,lb.end_date,'[]') && daterange(la.start_date,la.end_date,'[]')
          where la.employee_id=e.id and la.status='APPROVED' and la.start_date<=p_period_end and la.end_date>=p_period_start)
          then 'OVERLAPPING_APPROVED_LEAVE' end,
        case when ae.id is null then 'MISSING_APPROVED_ATTENDANCE_ENTRY' end,
        case when comp.salary_frequency is distinct from 'MONTHLY' then 'NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE' end
      ], null))
    ) order by e.employee_number), '[]'::jsonb)
  ) into v_result
  from public.employees e
  left join lateral (select ec.* from public.employee_compensation ec
    where ec.employee_id = e.id and ec.company_id = e.company_id and ec.workplace_branch_id = e.workplace_branch_id
      and ec.effective_from <= p_period_end and (ec.effective_to is null or ec.effective_to >= p_period_start)
    order by ec.effective_from desc, ec.created_at desc limit 1) comp on true
  left join public.attendance_entries ae on ae.attendance_period_id = v_attendance.id and ae.employee_id = e.id
  where e.portfolio_id = v_portfolio_id and e.company_id = p_company_id and e.workplace_branch_id = p_branch_id
    and e.approval_status = 'APPROVED';
  return v_result;
end;
$$;
revoke all on function public.payroll_preview_inputs_legacy(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.payroll_preview_inputs_legacy(uuid,uuid,date,date) to authenticated;

create or replace function public.payroll_preview_inputs(p_company_id uuid,p_branch_id uuid,p_period_start date,p_period_end date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_result jsonb; v_item jsonb; v_updated jsonb:='[]'::jsonb; v_excluded jsonb:='[]'::jsonb;
  v_proration jsonb; v_warnings jsonb; v_dates date[];
begin
  v_result:=public.payroll_preview_inputs_legacy(p_company_id,p_branch_id,p_period_start,p_period_end);
  select coalesce(array_agg(day::date order by day),'{}'::date[]) into v_dates
    from generate_series(p_period_start::timestamp,p_period_end::timestamp,interval '1 day') days(day)
    where extract(isodow from day) between 1 and 5;
  for v_item in select value from jsonb_array_elements(coalesce(v_result->'items','[]'::jsonb)) loop
    v_warnings:=coalesce(v_item->'input_warnings','[]'::jsonb);
    v_proration:=app_private.payroll_employee_proration((v_item->>'employee_id')::uuid,p_period_start,p_period_end,v_dates);
    if coalesce((v_proration->>'eligible_scheduled_days')::integer,0)=0 then
      v_excluded:=v_excluded||jsonb_build_array(jsonb_build_object('employee_id',v_item->>'employee_id','employee_number',v_item->>'employee_number','reason',v_proration->'warnings'));
      continue;
    end if;
    if coalesce((v_proration->>'valid_compensation')::boolean,false) then
      select coalesce(jsonb_agg(value),'[]'::jsonb) into v_warnings
        from jsonb_array_elements_text(coalesce(v_warnings,'[]'::jsonb)) w(value)
        where value not in ('MISSING_EFFECTIVE_COMPENSATION','COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD');
      v_item:=jsonb_set(v_item,'{basic_pay}',to_jsonb((v_proration->>'basic_pay')::numeric));
      v_item:=jsonb_set(v_item,'{housing_allowance}',coalesce(v_proration#>'{allowances,housing_allowance}','0'::jsonb));
      v_item:=jsonb_set(v_item,'{meal_allowance}',coalesce(v_proration#>'{allowances,meal_allowance}','0'::jsonb));
      v_item:=jsonb_set(v_item,'{transport_allowance}',coalesce(v_proration#>'{allowances,transport_allowance}','0'::jsonb));
      v_item:=jsonb_set(v_item,'{other_allowances}',coalesce(v_proration#>'{allowances,other_allowances}','0'::jsonb));
    end if;
    v_warnings:=v_warnings||coalesce(v_proration->'warnings','[]'::jsonb);
    v_item:=jsonb_set(v_item,'{input_warnings}',v_warnings);
    v_item:=jsonb_set(v_item,'{basic_salary_proration}',v_proration);
    v_updated:=v_updated||jsonb_build_array(v_item);
  end loop;
  return jsonb_set(jsonb_set(v_result,'{items}',v_updated),'{lifecycle_exclusions}',v_excluded);
end;
$$;
revoke all on function public.payroll_preview_inputs(uuid,uuid,date,date) from public,anon;
grant execute on function public.payroll_preview_inputs(uuid,uuid,date,date) to authenticated;

create table public.payroll_lifecycle_review_flags (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  lifecycle_request_id uuid not null references public.employee_lifecycle_requests(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  run_was_finalized boolean not null default false,
  resolution text not null check (resolution in ('OPEN','RECALCULATED','ADJUSTMENT_REQUIRED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (payroll_run_id,employee_id,lifecycle_request_id)
);
create index payroll_lifecycle_review_flags_open_idx on public.payroll_lifecycle_review_flags(payroll_run_id,resolution);
alter table public.payroll_lifecycle_review_flags enable row level security;
revoke all on public.payroll_lifecycle_review_flags from public,anon,authenticated;
grant select on public.payroll_lifecycle_review_flags to authenticated;
create policy payroll_lifecycle_review_flags_read_authorized on public.payroll_lifecycle_review_flags
  for select to authenticated using (app_private.has_permission('payroll.view',portfolio_id,company_id,branch_id));

create or replace function app_private.record_lifecycle_payroll_impact()
returns trigger language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v_start date; v_end date;
begin
  if new.status<>'APPROVED' or old.status='APPROVED' then return new; end if;
  v_start:=least(new.effective_date,coalesce(new.last_working_day,new.effective_date),coalesce(new.contract_start_date,new.effective_date),coalesce(new.contract_end_date,new.effective_date));
  v_end:=greatest(new.effective_date,coalesce(new.last_working_day,new.effective_date),coalesce(new.contract_start_date,new.effective_date),coalesce(new.contract_end_date,new.effective_date));
  insert into public.payroll_lifecycle_review_flags(
    portfolio_id,company_id,branch_id,payroll_run_id,employee_id,lifecycle_request_id,period_start,period_end,run_was_finalized,resolution
  )
  select r.portfolio_id,r.company_id,r.branch_id,r.id,new.employee_id,new.id,p.period_start,p.period_end,
    r.status='FINALIZED',case when r.status='FINALIZED' then 'ADJUSTMENT_REQUIRED' else 'OPEN' end
  from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
  where r.company_id=new.company_id and r.branch_id=new.branch_id
    and p.period_start<=v_end and p.period_end>=v_start
    and r.status not in ('CANCELED','REVERSED')
  on conflict (payroll_run_id,employee_id,lifecycle_request_id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.record_lifecycle_payroll_impact() from public,anon,authenticated;
create trigger employee_lifecycle_payroll_impact_after_approval
  after update of status on public.employee_lifecycle_requests
  for each row execute function app_private.record_lifecycle_payroll_impact();

create or replace function app_private.block_stale_payroll_lifecycle_decision()
returns trigger language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
begin
  if new.status is distinct from old.status and new.status in ('SUBMITTED_FOR_APPROVAL','UNDER_REVIEW','APPROVED','FINALIZED')
    and exists(select 1 from public.payroll_lifecycle_review_flags f where f.payroll_run_id=new.id and f.resolution='OPEN') then
    raise exception using errcode='40001',message='An employee lifecycle change affects this payroll period. Recalculate the draft or complete an authorized adjustment review before proceeding.';
  end if;
  return new;
end;
$$;
revoke all on function app_private.block_stale_payroll_lifecycle_decision() from public,anon,authenticated;
create trigger payroll_run_block_open_lifecycle_impact
  before update of status on public.payroll_runs
  for each row execute function app_private.block_stale_payroll_lifecycle_decision();

create or replace function app_private.resolve_payroll_lifecycle_flags_after_calculation()
returns trigger language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
begin
  if new.status='CALCULATED' and (new.status is distinct from old.status or new.version is distinct from old.version) then
    update public.payroll_lifecycle_review_flags set resolution='RECALCULATED',resolved_at=now()
      where payroll_run_id=new.id and resolution='OPEN';
  end if;
  return new;
end;
$$;
revoke all on function app_private.resolve_payroll_lifecycle_flags_after_calculation() from public,anon,authenticated;
create trigger payroll_run_resolve_lifecycle_flags_after_calculation
  after update of status,version on public.payroll_runs
  for each row execute function app_private.resolve_payroll_lifecycle_flags_after_calculation();

comment on table public.employee_lifecycle_requests is 'Permission-checked, two-person lifecycle decisions. Approved rows provide effective-dated employment changes; rejected/pending history is retained.';
comment on table public.employee_contract_history is 'Previous approved contract terms retained when a renewal or reactivation changes the employee current contract fields.';
comment on function public.payroll_preview_inputs(uuid,uuid,date,date) is 'Regular payroll selects only approved employees with a valid contract and lifecycle-payable scheduled dates. Paid suspension is blocked until an approved company policy exists.';
