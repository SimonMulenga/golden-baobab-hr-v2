-- Attendance history and company-calendared leave workflows. All additions are
-- forward-only; legacy payroll inputs continue to read APPROVED periods only.

create table public.attendance_period_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null, company_id uuid not null, branch_id uuid not null,
  attendance_period_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  previous_status text,
  new_status text not null,
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key(portfolio_id,company_id,branch_id,attendance_period_id)
    references public.attendance_periods(portfolio_id,company_id,branch_id,id) on delete restrict
);
create index attendance_period_history_lookup_idx on public.attendance_period_history(portfolio_id,company_id,branch_id,attendance_period_id,occurred_at desc);
alter table public.attendance_period_history enable row level security;
revoke all on public.attendance_period_history from public,anon,authenticated;
grant select on public.attendance_period_history to authenticated;
create policy attendance_period_history_read_authorized on public.attendance_period_history for select to authenticated
  using (app_private.has_permission('attendance.view',portfolio_id,company_id,branch_id));

create or replace function app_private.capture_attendance_period_history()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_actor uuid;
begin
  v_actor:=coalesce(auth.uid(),new.created_by);
  if tg_op='INSERT' then
    insert into public.attendance_period_history(portfolio_id,company_id,branch_id,attendance_period_id,actor_id,action,new_status)
    values(new.portfolio_id,new.company_id,new.branch_id,new.id,v_actor,'CREATED',new.status);
  elsif new.status is distinct from old.status then
    insert into public.attendance_period_history(portfolio_id,company_id,branch_id,attendance_period_id,actor_id,action,previous_status,new_status,reason)
    values(new.portfolio_id,new.company_id,new.branch_id,new.id,v_actor,'STATUS_CHANGED',old.status,new.status,new.review_reason);
  end if;
  return new;
end $$;
revoke all on function app_private.capture_attendance_period_history() from public,anon,authenticated;
create trigger attendance_period_history_capture after insert or update of status on public.attendance_periods
  for each row execute function app_private.capture_attendance_period_history();

create table public.leave_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null, company_id uuid not null,
  calendar_date date not null,
  is_working_day boolean not null default false,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique(portfolio_id,company_id,calendar_date),
  foreign key(portfolio_id,company_id) references public.companies(portfolio_id,id) on delete restrict
);
create index leave_calendar_company_date_idx on public.leave_calendar_exceptions(portfolio_id,company_id,calendar_date);
alter table public.leave_calendar_exceptions enable row level security;
revoke all on public.leave_calendar_exceptions from public,anon,authenticated;
grant select on public.leave_calendar_exceptions to authenticated;
create policy leave_calendar_read_authorized on public.leave_calendar_exceptions for select to authenticated
  using(app_private.has_permission('leave.view',portfolio_id,company_id,null));

alter table public.leave_policies
  add column day_count_method text not null default 'WORKING_DAYS' check(day_count_method in ('WORKING_DAYS','CALENDAR_DAYS')),
  add column carry_forward_limit_days numeric(7,2) check(carry_forward_limit_days is null or carry_forward_limit_days>=0);
alter table public.leave_requests
  add column leave_policy_id uuid,
  add column review_reason text;
alter table public.leave_requests
  add constraint leave_requests_policy_tenant_fk foreign key(portfolio_id,company_id,leave_policy_id)
    references public.leave_policies(portfolio_id,company_id,id) on delete restrict;
alter table public.leave_requests
  add constraint leave_requests_tenant_branch_id_unique unique(portfolio_id,company_id,branch_id,id);
do $$
begin
  -- Migration 003 created exactly these legacy checks: the inline status
  -- constraint and the second table-level check (reviewed_at consistency).
  -- Do not remove unrelated/custom checks based on matching SQL text.
  if not exists(select 1 from pg_constraint where conrelid='public.leave_requests'::regclass
      and conname='leave_requests_status_check' and contype='c') then
    raise exception 'Expected legacy leave_requests_status_check was not found; inspect schema drift before migration 029.';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.leave_requests'::regclass
      and conname='leave_requests_check1' and contype='c') then
    raise exception 'Expected legacy leave_requests_check1 was not found; inspect schema drift before migration 029.';
  end if;
end $$;
alter table public.leave_requests
  drop constraint leave_requests_status_check,
  drop constraint leave_requests_check1,
  add constraint leave_requests_status_check check(status in ('PENDING','APPROVED','REJECTED','RETURNED_FOR_CORRECTION','CANCELED')),
  add constraint leave_requests_review_state_check check(
    (status in ('APPROVED','REJECTED','RETURNED_FOR_CORRECTION')) = (reviewed_at is not null)
  );
alter table public.leave_balance_ledger drop constraint if exists leave_balance_ledger_event_type_check;
alter table public.leave_balance_ledger add constraint leave_balance_ledger_event_type_check
  check(event_type in ('ACCRUAL','PAID_LEAVE','ADJUSTMENT','REVERSAL','EXPIRY'));

create table public.leave_request_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,company_id uuid not null,branch_id uuid not null,leave_request_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,previous_status text,new_status text not null,reason text,
  occurred_at timestamptz not null default now(),
  foreign key(portfolio_id,company_id,branch_id,leave_request_id)
    references public.leave_requests(portfolio_id,company_id,branch_id,id) on delete restrict
);
create index leave_request_history_lookup_idx on public.leave_request_history(portfolio_id,company_id,branch_id,leave_request_id,occurred_at desc);
alter table public.leave_request_history enable row level security;
revoke all on public.leave_request_history from public,anon,authenticated;
grant select on public.leave_request_history to authenticated;
create policy leave_request_history_read_authorized on public.leave_request_history for select to authenticated
  using(app_private.has_permission('leave.view',portfolio_id,company_id,branch_id));

create or replace function app_private.capture_leave_request_history()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_actor uuid;
begin
  if tg_op='INSERT' then
    v_actor:=coalesce(auth.uid(),new.requested_by);
    insert into public.leave_request_history(portfolio_id,company_id,branch_id,leave_request_id,actor_id,action,new_status,reason)
      values(new.portfolio_id,new.company_id,new.branch_id,new.id,v_actor,'REQUESTED',new.status,new.reason);
  elsif new.status is distinct from old.status then
    v_actor:=coalesce(auth.uid(),new.reviewed_by,new.requested_by);
    insert into public.leave_request_history(portfolio_id,company_id,branch_id,leave_request_id,actor_id,action,previous_status,new_status,reason)
      values(new.portfolio_id,new.company_id,new.branch_id,new.id,v_actor,'STATUS_CHANGED',old.status,new.status,new.review_reason);
  end if;
  return new;
end $$;
revoke all on function app_private.capture_leave_request_history() from public,anon,authenticated;
create trigger leave_request_history_capture after insert or update of status on public.leave_requests
  for each row execute function app_private.capture_leave_request_history();

create or replace function public.leave_calendar_exception_save(
  p_company_id uuid,p_calendar_date date,p_is_working_day boolean,p_label text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_company public.companies%rowtype;v_id uuid;
begin
  if auth.uid() is null or p_calendar_date is null or p_is_working_day is null or nullif(btrim(p_label),'') is null
    or char_length(p_label)>200 or not app_private.can_manage_company_hr_configuration(p_company_id) then
    raise exception using errcode='42501',message='Calendar exception is invalid or unauthorized.';
  end if;
  insert into public.leave_calendar_exceptions(portfolio_id,company_id,calendar_date,is_working_day,label,created_by)
  values(v_company.portfolio_id,v_company.id,p_calendar_date,p_is_working_day,btrim(p_label),auth.uid())
  on conflict(portfolio_id,company_id,calendar_date) do update set is_working_day=excluded.is_working_day,label=excluded.label,updated_at=now()
  returning id into v_id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v_company.portfolio_id,v_company.id,auth.uid(),'LEAVE_CALENDAR_EXCEPTION_SAVED','leave',v_id::text,jsonb_build_object('date',p_calendar_date,'is_working_day',p_is_working_day));
  return v_id;
end $$;

create or replace function public.leave_calendar_exception_remove(p_exception_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.leave_calendar_exceptions%rowtype;
begin
  select * into v from public.leave_calendar_exceptions where id=p_exception_id for update;
  if not found or auth.uid() is null or not app_private.can_manage_company_hr_configuration(v.company_id) then
    raise exception using errcode='42501',message='Calendar exception removal is unauthorized.';
  end if;
  delete from public.leave_calendar_exceptions where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,auth.uid(),'LEAVE_CALENDAR_EXCEPTION_REMOVED','leave',v.id::text,jsonb_build_object('date',v.calendar_date));
  return v.id;
end $$;

create or replace function public.leave_policy_save_configured(
  p_company_id uuid,p_leave_policy_id uuid,p_leave_type text,p_pay_classification text,
  p_accrual_days_per_month numeric,p_maximum_balance_days numeric,p_effective_from date,p_effective_to date,
  p_day_count_method text,p_carry_forward_limit_days numeric
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_company public.companies%rowtype;v_id uuid;v_policy_enabled boolean:=true;v_overlap_count integer;v_exact_count integer;
begin
  if auth.uid() is null or nullif(btrim(p_leave_type),'') is null or char_length(p_leave_type)>100
    or p_pay_classification not in ('PAID','UNPAID') or p_accrual_days_per_month<0
    or (p_pay_classification='UNPAID' and p_accrual_days_per_month<>0)
    or (p_maximum_balance_days is not null and p_maximum_balance_days<=0)
    or p_effective_from is null or (p_effective_to is not null and p_effective_to<p_effective_from)
    or p_day_count_method not in ('WORKING_DAYS','CALENDAR_DAYS')
    or (p_carry_forward_limit_days is not null and p_carry_forward_limit_days<0)
    or not app_private.can_manage_company_hr_configuration(p_company_id) then
    raise exception using errcode='22023',message='Leave policy values are invalid or unauthorized.';
  end if;
  -- Serialize policy changes within this company so concurrent saves cannot
  -- both pass the overlap check and create overlapping enabled versions.
  select * into v_company from public.companies where id=p_company_id for update;
  if not found then raise exception using errcode='42501',message='Leave policy company is unavailable.'; end if;
  if p_leave_policy_id is not null then
    select enabled into v_policy_enabled from public.leave_policies
      where id=p_leave_policy_id and portfolio_id=v_company.portfolio_id and company_id=v_company.id for update;
    if not found then raise exception using errcode='42501',message='Leave policy is outside this company.'; end if;
  end if;
  if v_policy_enabled then
    select count(*) into v_overlap_count from public.leave_policies lp
    where lp.portfolio_id=v_company.portfolio_id and lp.company_id=v_company.id
      and lp.leave_type=btrim(p_leave_type) and lp.enabled
      and lp.id is distinct from p_leave_policy_id
      and daterange(lp.effective_from,lp.effective_to,'[]')
          && daterange(p_effective_from,p_effective_to,'[]');
  else
    v_overlap_count:=0;
  end if;
  if v_overlap_count>0 then
    if p_leave_policy_id is null then
      select count(*) into v_exact_count from public.leave_policies lp
      where lp.portfolio_id=v_company.portfolio_id and lp.company_id=v_company.id
        and lp.leave_type=btrim(p_leave_type) and lp.pay_classification=p_pay_classification
        and lp.accrual_days_per_month=p_accrual_days_per_month
        and lp.maximum_balance_days is not distinct from p_maximum_balance_days
        and lp.effective_from=p_effective_from and lp.effective_to is not distinct from p_effective_to
        and lp.day_count_method=p_day_count_method
        and lp.carry_forward_limit_days is not distinct from p_carry_forward_limit_days
        and lp.enabled;
      if v_exact_count=1 and v_overlap_count=1 then
        select lp.id into v_id from public.leave_policies lp
        where lp.portfolio_id=v_company.portfolio_id and lp.company_id=v_company.id
          and lp.leave_type=btrim(p_leave_type) and lp.pay_classification=p_pay_classification
          and lp.accrual_days_per_month=p_accrual_days_per_month
          and lp.maximum_balance_days is not distinct from p_maximum_balance_days
          and lp.effective_from=p_effective_from and lp.effective_to is not distinct from p_effective_to
          and lp.day_count_method=p_day_count_method
          and lp.carry_forward_limit_days is not distinct from p_carry_forward_limit_days and lp.enabled;
        return v_id;
      end if;
    end if;
    raise exception using errcode='23P01',message='Leave policy effective dates overlap another enabled policy for this company and leave type.';
  end if;
  if p_leave_policy_id is null then
    insert into public.leave_policies(portfolio_id,company_id,leave_type,pay_classification,accrual_days_per_month,maximum_balance_days,effective_from,effective_to,day_count_method,carry_forward_limit_days,created_by)
    values(v_company.portfolio_id,v_company.id,btrim(p_leave_type),p_pay_classification,p_accrual_days_per_month,p_maximum_balance_days,p_effective_from,p_effective_to,p_day_count_method,p_carry_forward_limit_days,auth.uid()) returning id into v_id;
  else
    update public.leave_policies set leave_type=btrim(p_leave_type),pay_classification=p_pay_classification,accrual_days_per_month=p_accrual_days_per_month,maximum_balance_days=p_maximum_balance_days,effective_from=p_effective_from,effective_to=p_effective_to,day_count_method=p_day_count_method,carry_forward_limit_days=p_carry_forward_limit_days
      where id=p_leave_policy_id and portfolio_id=v_company.portfolio_id and company_id=v_company.id returning id into v_id;
    if v_id is null then raise exception using errcode='42501',message='Leave policy is outside this company.'; end if;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v_company.portfolio_id,v_company.id,auth.uid(),'LEAVE_POLICY_CONFIGURED','leave',v_id::text,jsonb_build_object('leave_type',btrim(p_leave_type),'effective_from',p_effective_from,'day_count_method',p_day_count_method));
  return v_id;
end $$;

create or replace function public.leave_create_request_calculated(
  p_portfolio_id uuid,p_company_id uuid,p_branch_id uuid,p_employee_id uuid,p_leave_policy_id uuid,
  p_start_date date,p_end_date date,p_reason text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_employee public.employees%rowtype;v_policy public.leave_policies%rowtype;v_existing public.leave_requests%rowtype;v_days numeric(6,2);v_id uuid;v_count integer;
begin
  if auth.uid() is null or p_start_date is null or p_end_date is null or p_end_date<p_start_date
    or p_end_date>p_start_date+interval '366 days' or nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Leave request dates or idempotency key are invalid.';
  end if;
  if not app_private.has_permission('leave.request',p_portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Leave request is not authorized for this branch.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id and portfolio_id=p_portfolio_id and company_id=p_company_id and workplace_branch_id=p_branch_id for update;
  if not found or v_employee.approval_status<>'APPROVED' then raise exception using errcode='42501',message='Leave requires an approved employee in the selected branch.'; end if;
  select * into v_policy from public.leave_policies where id=p_leave_policy_id and portfolio_id=p_portfolio_id and company_id=p_company_id
    and enabled and effective_from<=p_start_date and (effective_to is null or p_end_date<=effective_to);
  if not found then raise exception using errcode='22023',message='No single enabled leave policy covers the complete requested date range.'; end if;
  if v_policy.day_count_method='CALENDAR_DAYS' then v_days:=(p_end_date-p_start_date)+1;
  else
    select count(*)::numeric(6,2) into v_days from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d(day_value)
      left join public.leave_calendar_exceptions x on x.portfolio_id=p_portfolio_id and x.company_id=p_company_id and x.calendar_date=d.day_value::date
      where coalesce(x.is_working_day,(extract(isodow from d.day_value) between 1 and 5));
  end if;
  if v_days<=0 then raise exception using errcode='22023',message='The requested dates contain no leave days under the company calendar.'; end if;
  select * into v_existing from public.leave_requests where requested_by=auth.uid() and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.portfolio_id<>p_portfolio_id or v_existing.company_id<>p_company_id or v_existing.branch_id<>p_branch_id
      or v_existing.employee_id<>p_employee_id or v_existing.leave_policy_id<>p_leave_policy_id
      or v_existing.start_date<>p_start_date or v_existing.end_date<>p_end_date
      or v_existing.leave_days<>v_days or v_existing.reason is distinct from nullif(btrim(p_reason),'') then
      raise exception using errcode='23505',message='This leave request key was already used with different details.';
    end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status in ('PENDING','APPROVED')
    and daterange(l.start_date,l.end_date,'[]') && daterange(p_start_date,p_end_date,'[]')) then
    raise exception using errcode='23505',message='Leave dates overlap an existing pending or approved request.';
  end if;
  insert into public.leave_requests(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,leave_type,pay_classification,start_date,end_date,leave_days,requested_by,reason,idempotency_key)
  values(p_portfolio_id,p_company_id,p_branch_id,p_employee_id,v_policy.id,v_policy.leave_type,v_policy.pay_classification,p_start_date,p_end_date,v_days,auth.uid(),nullif(btrim(p_reason),''),p_idempotency_key) returning id into v_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),'LEAVE_REQUESTED','leave',v_id::text,jsonb_build_object('employee_id',p_employee_id,'policy_id',v_policy.id,'days',v_days));
  return v_id;
end $$;

create or replace function public.leave_request_transition(p_leave_request_id uuid,p_decision text,p_reason text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.leave_requests%rowtype;v_policy public.leave_policies%rowtype;v_balance numeric(10,2);
begin
  if auth.uid() is null or p_decision not in ('APPROVE','REJECT','RETURN','SUBMIT','CANCEL')
    or (p_decision in ('REJECT','RETURN','CANCEL') and nullif(btrim(p_reason),'') is null) then
    raise exception using errcode='22023',message='Leave transition or required reason is invalid.';
  end if;
  select * into v from public.leave_requests where id=p_leave_request_id for update;
  if not found then raise exception using errcode='42501',message='Leave request is unavailable.'; end if;
  if p_decision='SUBMIT' then
    if v.requested_by<>auth.uid() or v.status<>'RETURNED_FOR_CORRECTION'
      or not app_private.has_permission('leave.request',v.portfolio_id,v.company_id,v.branch_id) then
      raise exception using errcode='42501',message='Only the authorized requester can resubmit a returned leave request.';
    end if;
    if exists(select 1 from public.leave_requests x where x.id<>v.id and x.employee_id=v.employee_id and x.status in ('PENDING','APPROVED')
      and daterange(x.start_date,x.end_date,'[]') && daterange(v.start_date,v.end_date,'[]')) then
      raise exception using errcode='23505',message='Leave dates overlap another pending or approved request.';
    end if;
    update public.leave_requests set status='PENDING',reviewed_by=null,reviewed_at=null,review_reason=null where id=v.id;
  elsif p_decision='CANCEL' and v.requested_by=auth.uid() and v.status in ('PENDING','RETURNED_FOR_CORRECTION') then
    update public.leave_requests set status='CANCELED',reviewed_by=auth.uid(),reviewed_at=null,review_reason=btrim(p_reason) where id=v.id;
  elsif p_decision='CANCEL' and v.status='APPROVED' and app_private.has_permission('leave.review',v.portfolio_id,v.company_id,v.branch_id) then
    if v.pay_classification='PAID' and v.leave_policy_id is not null then
      insert into public.leave_balance_ledger(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,event_type,amount_delta,reference_id,period_start,actor_id)
      values(v.portfolio_id,v.company_id,v.branch_id,v.employee_id,v.leave_policy_id,'REVERSAL',v.leave_days,'CANCEL:'||v.id::text,date_trunc('month',v.start_date)::date,auth.uid())
      on conflict(portfolio_id,company_id,employee_id,leave_policy_id,event_type,reference_id) do nothing;
    end if;
    update public.leave_requests set status='CANCELED',reviewed_by=auth.uid(),reviewed_at=null,review_reason=btrim(p_reason) where id=v.id;
  elsif p_decision in ('APPROVE','REJECT','RETURN') and v.status in ('PENDING','RETURNED_FOR_CORRECTION')
    and app_private.has_permission('leave.review',v.portfolio_id,v.company_id,v.branch_id) then
    if p_decision='APPROVE' then
      if v.leave_policy_id is null then raise exception using errcode='22023',message='The request has no recorded effective policy; correct it before approval.'; end if;
      select * into v_policy from public.leave_policies where id=v.leave_policy_id and portfolio_id=v.portfolio_id and company_id=v.company_id and enabled;
      if not found or v_policy.leave_type<>v.leave_type or v_policy.pay_classification<>v.pay_classification then raise exception using errcode='22023',message='The request no longer matches an enabled company leave policy.'; end if;
      if v.pay_classification='PAID' then
        select coalesce(sum(amount_delta),0) into v_balance from public.leave_balance_ledger where employee_id=v.employee_id and leave_policy_id=v.leave_policy_id;
        if v_balance<v.leave_days then raise exception using errcode='22023',message='The employee has insufficient accrued paid leave.'; end if;
        insert into public.leave_balance_ledger(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,event_type,amount_delta,reference_id,period_start,actor_id)
        values(v.portfolio_id,v.company_id,v.branch_id,v.employee_id,v.leave_policy_id,'PAID_LEAVE',-v.leave_days,v.id::text,date_trunc('month',v.start_date)::date,auth.uid());
      end if;
      update public.leave_requests set status='APPROVED',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=null where id=v.id;
    elsif p_decision='REJECT' then
      update public.leave_requests set status='REJECTED',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=btrim(p_reason) where id=v.id;
    else
      update public.leave_requests set status='RETURNED_FOR_CORRECTION',reviewed_by=auth.uid(),reviewed_at=now(),review_reason=btrim(p_reason) where id=v.id;
    end if;
  else
    raise exception using errcode='42501',message='Leave transition is not authorized for the current request state.';
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'LEAVE_'||p_decision,'leave',v.id::text,jsonb_build_object('employee_id',v.employee_id,'reason',nullif(btrim(p_reason),'')));
  return v.id;
end $$;

create or replace function public.leave_apply_carry_forward(p_policy_id uuid,p_year integer)
returns integer language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_policy public.leave_policies%rowtype;v_count integer:=0;
begin
  if p_year not between 2000 and 2200 then raise exception using errcode='22023',message='Carry-forward year is invalid.'; end if;
  select * into v_policy from public.leave_policies where id=p_policy_id for update;
  if not found or auth.uid() is null or not app_private.has_permission('leave.review',v_policy.portfolio_id,v_policy.company_id,null) then
    raise exception using errcode='42501',message='Leave carry-forward is unauthorized.';
  end if;
  if v_policy.carry_forward_limit_days is null then return 0; end if;
  insert into public.leave_balance_ledger(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,event_type,amount_delta,reference_id,period_start,actor_id)
  select v_policy.portfolio_id,v_policy.company_id,e.workplace_branch_id,e.id,v_policy.id,'EXPIRY',-(b.balance-v_policy.carry_forward_limit_days),('CARRY_FORWARD_EXPIRY:'||p_year::text),make_date(p_year,1,1),auth.uid()
  from public.employees e join lateral(select sum(l.amount_delta) balance from public.leave_balance_ledger l where l.employee_id=e.id and l.leave_policy_id=v_policy.id and l.period_start<make_date(p_year,1,1)) b on true
  where e.portfolio_id=v_policy.portfolio_id and e.company_id=v_policy.company_id and b.balance>v_policy.carry_forward_limit_days
  on conflict(portfolio_id,company_id,employee_id,leave_policy_id,event_type,reference_id) do nothing;
  get diagnostics v_count=row_count;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v_policy.portfolio_id,v_policy.company_id,auth.uid(),'LEAVE_CARRY_FORWARD_APPLIED','leave',v_policy.id::text,jsonb_build_object('year',p_year,'employees_adjusted',v_count,'limit_days',v_policy.carry_forward_limit_days));
  return v_count;
end $$;

alter function public.leave_accrue_month(uuid,date) rename to leave_accrue_month_legacy;
create function public.leave_accrue_month(p_policy_id uuid,p_period_start date)
returns integer language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_count integer;
begin
  v_count:=public.leave_accrue_month_legacy(p_policy_id,p_period_start);
  if extract(month from p_period_start)=1 then perform public.leave_apply_carry_forward(p_policy_id,extract(year from p_period_start)::integer); end if;
  return v_count;
end $$;

revoke all on function public.leave_calendar_exception_save(uuid,date,boolean,text) from public,anon;
revoke all on function public.leave_calendar_exception_remove(uuid) from public,anon;
revoke all on function public.leave_policy_save_configured(uuid,uuid,text,text,numeric,numeric,date,date,text,numeric) from public,anon;
revoke all on function public.leave_policy_save(uuid,uuid,text,text,numeric,numeric,date,date) from public,anon,authenticated;
revoke all on function public.leave_create_request(uuid,uuid,uuid,uuid,text,text,date,date,numeric,text,text) from authenticated;
revoke all on function public.leave_create_request(uuid,uuid,uuid,uuid,text,text,date,date,numeric,text,text) from public,anon;
revoke all on function public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text) from public,anon;
revoke all on function public.leave_request_transition(uuid,text,text) from public,anon;
revoke all on function public.leave_review_request(uuid,text,text) from public,anon,authenticated;
revoke all on function public.leave_apply_carry_forward(uuid,integer) from public,anon;
revoke all on function public.leave_accrue_month_legacy(uuid,date) from authenticated,public,anon;
revoke all on function public.leave_accrue_month(uuid,date) from public,anon;
grant execute on function public.leave_calendar_exception_save(uuid,date,boolean,text) to authenticated;
grant execute on function public.leave_calendar_exception_remove(uuid) to authenticated;
grant execute on function public.leave_policy_save_configured(uuid,uuid,text,text,numeric,numeric,date,date,text,numeric) to authenticated;
grant execute on function public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text) to authenticated;
grant execute on function public.leave_request_transition(uuid,text,text) to authenticated;
grant execute on function public.leave_apply_carry_forward(uuid,integer) to authenticated;
grant execute on function public.leave_accrue_month(uuid,date) to authenticated;

comment on table public.leave_calendar_exceptions is 'Company date overrides for the default Monday-Friday leave work calendar.';
comment on table public.leave_request_history is 'Append-only status history for leave request lifecycle changes.';
comment on table public.attendance_period_history is 'Append-only history of attendance period creation and review transitions.';
