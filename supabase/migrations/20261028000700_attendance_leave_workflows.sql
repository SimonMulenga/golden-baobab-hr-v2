-- M6: trusted monthly attendance and leave workflows.
-- Forward-only: all mutations pass through narrow SECURITY DEFINER RPCs.

alter table public.attendance_periods
  drop constraint attendance_periods_status_check,
  add constraint attendance_periods_status_check
    check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED_FOR_CORRECTION', 'LOCKED')),
  add column reviewed_by uuid references public.profiles(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column review_reason text;

alter table public.attendance_entries
  add column correction_note text,
  add column updated_by uuid references public.profiles(id) on delete restrict,
  add column updated_at timestamptz not null default now();

alter table public.leave_requests
  add column idempotency_key text not null default gen_random_uuid()::text;
alter table public.leave_requests
  add constraint leave_requests_request_key_unique unique (requested_by, idempotency_key);

create table public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  leave_type text not null,
  pay_classification text not null check (pay_classification in ('PAID', 'UNPAID')),
  accrual_days_per_month numeric(6,2) not null default 0 check (accrual_days_per_month >= 0),
  maximum_balance_days numeric(7,2) check (maximum_balance_days is null or maximum_balance_days > 0),
  effective_from date not null,
  effective_to date,
  enabled boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (portfolio_id, company_id, id),
  unique (portfolio_id, company_id, leave_type, effective_from),
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  check (pay_classification = 'PAID' or accrual_days_per_month = 0)
);
create index leave_policies_asof_idx on public.leave_policies(portfolio_id, company_id, leave_type, enabled, effective_from desc);

create table public.leave_balance_ledger (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  leave_policy_id uuid not null,
  event_type text not null check (event_type in ('ACCRUAL', 'PAID_LEAVE', 'ADJUSTMENT', 'REVERSAL')),
  amount_delta numeric(8,2) not null check (amount_delta <> 0),
  reference_id text not null,
  period_start date not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, leave_policy_id)
    references public.leave_policies(portfolio_id, company_id, id) on delete restrict,
  unique (portfolio_id, company_id, employee_id, leave_policy_id, event_type, reference_id)
);
create index leave_balance_employee_idx on public.leave_balance_ledger(portfolio_id, company_id, employee_id, leave_policy_id, period_start);

create view public.leave_balances with (security_invoker = true) as
select l.portfolio_id, l.company_id, l.branch_id, l.employee_id, l.leave_policy_id,
  p.leave_type, p.pay_classification, p.accrual_days_per_month,
  sum(l.amount_delta)::numeric(10,2) as available_days
from public.leave_balance_ledger l
join public.leave_policies p on p.id = l.leave_policy_id and p.portfolio_id = l.portfolio_id and p.company_id = l.company_id
group by l.portfolio_id, l.company_id, l.branch_id, l.employee_id, l.leave_policy_id,
  p.leave_type, p.pay_classification, p.accrual_days_per_month;

alter table public.leave_policies enable row level security;
alter table public.leave_balance_ledger enable row level security;
revoke all on public.leave_policies, public.leave_balance_ledger from anon, authenticated;
grant select on public.leave_policies, public.leave_balance_ledger to authenticated;
grant select on public.leave_balances to authenticated;

create policy leave_policies_read_authorized on public.leave_policies
  for select to authenticated using (app_private.has_permission('leave.view', portfolio_id, company_id, null));
create policy leave_balance_ledger_read_authorized on public.leave_balance_ledger
  for select to authenticated using (app_private.has_permission('leave.view', portfolio_id, company_id, branch_id));

create or replace function public.attendance_save_entry(
  p_portfolio_id uuid, p_company_id uuid, p_branch_id uuid,
  p_period_start date, p_period_end date, p_employee_id uuid,
  p_scheduled_days numeric, p_worked_days numeric, p_paid_leave_days numeric,
  p_unpaid_leave_days numeric, p_payable_absence_days numeric, p_contract_type text,
  p_correction_note text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_period public.attendance_periods%rowtype; v_employee public.employees%rowtype;
  v_previous public.attendance_entries%rowtype; v_id uuid;
begin
  if p_period_start is null or p_period_end is null or date_trunc('month', p_period_start)::date <> p_period_start
    or p_period_end <> (p_period_start + interval '1 month - 1 day')::date
    or p_scheduled_days < 0 or p_worked_days < 0 or p_paid_leave_days < 0 or p_unpaid_leave_days < 0
    or p_payable_absence_days < 0 or nullif(btrim(p_contract_type), '') is null
    or p_worked_days + p_paid_leave_days + p_unpaid_leave_days + p_payable_absence_days > p_scheduled_days then
    raise exception using errcode = '22023', message = 'Attendance values or monthly period are invalid.';
  end if;
  if not app_private.has_permission('attendance.manage', p_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Attendance entry is not authorized.';
  end if;
  select * into v_employee from public.employees e where e.id = p_employee_id and e.portfolio_id = p_portfolio_id
    and e.company_id = p_company_id and e.workplace_branch_id = p_branch_id for update;
  if not found or v_employee.approval_status <> 'APPROVED' then
    raise exception using errcode = '22023', message = 'Attendance requires an approved employee in the selected branch.';
  end if;
  insert into public.attendance_periods(portfolio_id, company_id, branch_id, period_start, period_end, created_by)
  values (p_portfolio_id, p_company_id, p_branch_id, p_period_start, p_period_end, auth.uid())
  on conflict (portfolio_id, company_id, branch_id, period_start, period_end) do nothing;
  select * into v_period from public.attendance_periods ap where ap.portfolio_id = p_portfolio_id
    and ap.company_id = p_company_id and ap.branch_id = p_branch_id and ap.period_start = p_period_start
    and ap.period_end = p_period_end for update;
  if v_period.status not in ('DRAFT', 'RETURNED_FOR_CORRECTION') then
    raise exception using errcode = '55000', message = 'Only draft or returned attendance periods can be corrected.';
  end if;
  select * into v_previous from public.attendance_entries ae where ae.attendance_period_id = v_period.id
    and ae.employee_id = p_employee_id for update;
  insert into public.attendance_entries(
    portfolio_id, company_id, branch_id, attendance_period_id, employee_id, scheduled_working_days,
    actual_days_worked, paid_leave_days, unpaid_leave_days, other_payable_absence_days, contract_type,
    correction_note, updated_by, updated_at
  ) values (
    p_portfolio_id, p_company_id, p_branch_id, v_period.id, p_employee_id, p_scheduled_days,
    p_worked_days, p_paid_leave_days, p_unpaid_leave_days, p_payable_absence_days, btrim(p_contract_type),
    nullif(btrim(p_correction_note), ''), auth.uid(), now()
  ) on conflict (attendance_period_id, employee_id) do update set
    scheduled_working_days = excluded.scheduled_working_days,
    actual_days_worked = excluded.actual_days_worked,
    paid_leave_days = excluded.paid_leave_days,
    unpaid_leave_days = excluded.unpaid_leave_days,
    other_payable_absence_days = excluded.other_payable_absence_days,
    contract_type = excluded.contract_type,
    correction_note = excluded.correction_note,
    updated_by = auth.uid(), updated_at = now()
  returning id into v_id;
  if v_period.status = 'RETURNED_FOR_CORRECTION' then
    update public.attendance_periods set status = 'DRAFT', reviewed_by = null, reviewed_at = null, review_reason = null where id = v_period.id;
  end if;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, p_branch_id, auth.uid(), 'ATTENDANCE_ENTRY_SAVED', 'attendance', v_id::text,
    jsonb_build_object('period_start', p_period_start, 'employee_id', p_employee_id,
      'previous', case when v_previous.id is null then null else jsonb_build_object(
        'scheduled_days', v_previous.scheduled_working_days, 'worked_days', v_previous.actual_days_worked,
        'paid_leave_days', v_previous.paid_leave_days, 'unpaid_leave_days', v_previous.unpaid_leave_days,
        'payable_absence_days', v_previous.other_payable_absence_days) end,
      'new', jsonb_build_object('scheduled_days', p_scheduled_days, 'worked_days', p_worked_days,
        'paid_leave_days', p_paid_leave_days, 'unpaid_leave_days', p_unpaid_leave_days,
        'payable_absence_days', p_payable_absence_days),
      'correction_note', nullif(btrim(p_correction_note), '')));
  return v_id;
end $$;

create or replace function public.attendance_submit_period(p_period_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype; v_count bigint;
begin
  select * into v from public.attendance_periods where id = p_period_id for update;
  if not found or v.created_by <> auth.uid() or v.status not in ('DRAFT', 'RETURNED_FOR_CORRECTION')
    or not app_private.has_permission('attendance.manage', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode = '42501', message = 'Attendance submission is not authorized.';
  end if;
  select count(*) into v_count from public.attendance_entries where attendance_period_id = v.id;
  if v_count = 0 then raise exception using errcode = '22023', message = 'Add monthly attendance entries before submitting.'; end if;
  update public.attendance_periods set status = 'SUBMITTED', reviewed_by = null, reviewed_at = null, review_reason = null where id = v.id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'ATTENDANCE_PERIOD_SUBMITTED', 'attendance', v.id::text,
    jsonb_build_object('entry_count', v_count, 'period_start', v.period_start));
  return v.id;
end $$;

create or replace function public.attendance_review_period(p_period_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype;
begin
  if p_decision not in ('APPROVE', 'RETURN') or (p_decision = 'RETURN' and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid attendance decision and reason are required.';
  end if;
  select * into v from public.attendance_periods where id = p_period_id for update;
  if not found or v.status <> 'SUBMITTED' or v.created_by = auth.uid()
    or not app_private.has_permission('attendance.manage', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode = '42501', message = 'Attendance review is not authorized.';
  end if;
  update public.attendance_periods set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED_FOR_CORRECTION' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_reason = nullif(btrim(p_reason), '') where id = v.id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'ATTENDANCE_PERIOD_' || p_decision, 'attendance', v.id::text,
    jsonb_build_object('reason', nullif(btrim(p_reason), ''), 'period_start', v.period_start));
  return v.id;
end $$;

create or replace function public.leave_policy_save(
  p_portfolio_id uuid, p_company_id uuid, p_leave_type text, p_pay_classification text,
  p_accrual_days_per_month numeric, p_maximum_balance_days numeric, p_effective_from date, p_effective_to date default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_id uuid;
begin
  if nullif(btrim(p_leave_type), '') is null or p_pay_classification not in ('PAID', 'UNPAID')
    or p_accrual_days_per_month < 0 or (p_pay_classification = 'UNPAID' and p_accrual_days_per_month <> 0)
    or p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from)
    or (p_maximum_balance_days is not null and p_maximum_balance_days <= 0) then
    raise exception using errcode = '22023', message = 'Leave policy values are invalid.';
  end if;
  if not app_private.has_permission('leave.review', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Leave policy management is not authorized.';
  end if;
  if exists (select 1 from public.leave_policies lp where lp.portfolio_id = p_portfolio_id and lp.company_id = p_company_id
    and lp.leave_type = btrim(p_leave_type) and daterange(lp.effective_from, lp.effective_to, '[]') &&
      daterange(p_effective_from, p_effective_to, '[]')) then
    select id into v_id from public.leave_policies lp where lp.portfolio_id = p_portfolio_id and lp.company_id = p_company_id
      and lp.leave_type = btrim(p_leave_type) and lp.effective_from = p_effective_from
      and lp.pay_classification = p_pay_classification and lp.accrual_days_per_month = p_accrual_days_per_month
      and lp.maximum_balance_days is not distinct from p_maximum_balance_days and lp.effective_to is not distinct from p_effective_to
      and lp.enabled;
    if v_id is not null then return v_id; end if;
    raise exception using errcode = '23P01', message = 'Leave policy effective dates overlap an existing version.';
  end if;
  insert into public.leave_policies(portfolio_id, company_id, leave_type, pay_classification, accrual_days_per_month,
    maximum_balance_days, effective_from, effective_to, created_by)
  values (p_portfolio_id, p_company_id, btrim(p_leave_type), p_pay_classification, p_accrual_days_per_month,
    p_maximum_balance_days, p_effective_from, p_effective_to, auth.uid())
  returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'LEAVE_POLICY_SAVED', 'leave', v_id::text,
    jsonb_build_object('leave_type', btrim(p_leave_type), 'effective_from', p_effective_from));
  return v_id;
end $$;

create or replace function public.leave_accrue_month(p_policy_id uuid, p_period_start date)
returns integer language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_policy public.leave_policies%rowtype; v_count integer;
begin
  if p_period_start is null or date_trunc('month', p_period_start)::date <> p_period_start then
    raise exception using errcode = '22023', message = 'Accrual period must be the first day of a month.';
  end if;
  select * into v_policy from public.leave_policies where id = p_policy_id for update;
  if not found or not v_policy.enabled or v_policy.pay_classification <> 'PAID' or v_policy.accrual_days_per_month <= 0
    or p_period_start < v_policy.effective_from or (v_policy.effective_to is not null and p_period_start > v_policy.effective_to)
    or not app_private.has_permission('leave.review', v_policy.portfolio_id, v_policy.company_id, null) then
    raise exception using errcode = '42501', message = 'Leave accrual is not authorized or the policy is not effective.';
  end if;
  insert into public.leave_balance_ledger(portfolio_id, company_id, branch_id, employee_id, leave_policy_id,
    event_type, amount_delta, reference_id, period_start, actor_id)
  select e.portfolio_id, e.company_id, e.workplace_branch_id, e.id, v_policy.id, 'ACCRUAL',
    case when v_policy.maximum_balance_days is null then v_policy.accrual_days_per_month
      else least(v_policy.accrual_days_per_month, greatest(v_policy.maximum_balance_days - coalesce(b.balance, 0), 0)) end,
    to_char(p_period_start, 'YYYY-MM'), p_period_start, auth.uid()
  from public.employees e
  left join lateral (select sum(l.amount_delta) as balance from public.leave_balance_ledger l
    where l.employee_id = e.id and l.leave_policy_id = v_policy.id) b on true
  where e.portfolio_id = v_policy.portfolio_id and e.company_id = v_policy.company_id and e.approval_status = 'APPROVED'
    and e.contract_start_date <= (p_period_start + interval '1 month - 1 day')::date
    and (e.contract_end_date is null or e.contract_end_date >= p_period_start)
    and (v_policy.maximum_balance_days is null or coalesce(b.balance, 0) < v_policy.maximum_balance_days)
  on conflict (portfolio_id, company_id, employee_id, leave_policy_id, event_type, reference_id) do nothing;
  get diagnostics v_count = row_count;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (v_policy.portfolio_id, v_policy.company_id, auth.uid(), 'LEAVE_MONTH_ACCRUED', 'leave', v_policy.id::text,
    jsonb_build_object('period_start', p_period_start, 'new_employee_balances', v_count));
  return v_count;
end $$;

create or replace function public.leave_create_request(
  p_portfolio_id uuid, p_company_id uuid, p_branch_id uuid, p_employee_id uuid,
  p_leave_type text, p_pay_classification text, p_start_date date, p_end_date date,
  p_leave_days numeric, p_reason text, p_idempotency_key text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_id uuid; v_employee public.employees%rowtype; v_existing public.leave_requests%rowtype;
begin
  if nullif(btrim(p_leave_type), '') is null or p_pay_classification not in ('PAID', 'UNPAID')
    or p_start_date is null or p_end_date < p_start_date or p_leave_days <= 0
    or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'Leave request details are incomplete.';
  end if;
  if not app_private.has_permission('leave.request', p_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Leave request is not authorized.';
  end if;
  select * into v_existing from public.leave_requests lr where lr.requested_by = auth.uid()
    and lr.idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.portfolio_id <> p_portfolio_id or v_existing.company_id <> p_company_id or v_existing.branch_id <> p_branch_id
      or v_existing.employee_id <> p_employee_id or v_existing.leave_type <> btrim(p_leave_type)
      or v_existing.pay_classification <> p_pay_classification or v_existing.start_date <> p_start_date
      or v_existing.end_date <> p_end_date or v_existing.leave_days <> p_leave_days
      or v_existing.reason is distinct from nullif(btrim(p_reason), '') then
      raise exception using errcode = '23505', message = 'This leave request key was already used for different details.';
    end if;
    return v_existing.id;
  end if;
  select * into v_employee from public.employees e where e.id = p_employee_id and e.portfolio_id = p_portfolio_id
    and e.company_id = p_company_id and e.workplace_branch_id = p_branch_id for update;
  if not found or v_employee.approval_status <> 'APPROVED' then
    raise exception using errcode = '22023', message = 'Leave requests require an approved employee in the selected branch.';
  end if;
  if exists (select 1 from public.leave_requests lr where lr.employee_id = p_employee_id
    and lr.status in ('PENDING', 'APPROVED') and daterange(lr.start_date, lr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')) then
    raise exception using errcode = '23505', message = 'Leave dates overlap an existing pending or approved request.';
  end if;
  insert into public.leave_requests(portfolio_id, company_id, branch_id, employee_id, leave_type, pay_classification,
    start_date, end_date, leave_days, requested_by, reason, idempotency_key)
  values (p_portfolio_id, p_company_id, p_branch_id, p_employee_id, btrim(p_leave_type), p_pay_classification,
    p_start_date, p_end_date, p_leave_days, auth.uid(), nullif(btrim(p_reason), ''), p_idempotency_key)
  returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, p_branch_id, auth.uid(), 'LEAVE_REQUEST_CREATED', 'leave', v_id::text,
    jsonb_build_object('employee_id', p_employee_id, 'leave_type', p_leave_type, 'dates', jsonb_build_array(p_start_date, p_end_date)));
  return v_id;
end $$;

create or replace function public.leave_review_request(p_leave_request_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.leave_requests%rowtype; v_policy public.leave_policies%rowtype; v_balance numeric(10,2);
begin
  if p_decision not in ('APPROVE', 'REJECT') or (p_decision = 'REJECT' and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid leave decision and reason are required.';
  end if;
  select * into v from public.leave_requests where id = p_leave_request_id for update;
  if not found or v.status <> 'PENDING' or v.requested_by = auth.uid()
    or not app_private.has_permission('leave.review', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode = '42501', message = 'Leave review is not authorized.';
  end if;
  perform 1 from public.employees e where e.id = v.employee_id and e.portfolio_id = v.portfolio_id
    and e.company_id = v.company_id and e.workplace_branch_id = v.branch_id for update;
  if p_decision = 'APPROVE' and v.pay_classification = 'PAID' then
    select * into v_policy from public.leave_policies lp where lp.portfolio_id = v.portfolio_id and lp.company_id = v.company_id
      and lp.leave_type = v.leave_type and lp.pay_classification = 'PAID' and lp.enabled
      and lp.effective_from <= v.start_date and (lp.effective_to is null or lp.effective_to >= v.start_date)
      order by lp.effective_from desc limit 1;
    if not found then raise exception using errcode = '22023', message = 'No effective paid leave policy exists for this request.'; end if;
    select coalesce(sum(l.amount_delta), 0) into v_balance from public.leave_balance_ledger l
      where l.employee_id = v.employee_id and l.leave_policy_id = v_policy.id;
    if v_balance < v.leave_days then raise exception using errcode = '22023', message = 'The employee has insufficient accrued paid leave.'; end if;
    insert into public.leave_balance_ledger(portfolio_id, company_id, branch_id, employee_id, leave_policy_id,
      event_type, amount_delta, reference_id, period_start, actor_id)
    values (v.portfolio_id, v.company_id, v.branch_id, v.employee_id, v_policy.id, 'PAID_LEAVE', -v.leave_days,
      v.id::text, date_trunc('month', v.start_date)::date, auth.uid());
  end if;
  update public.leave_requests set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
    reviewed_by = auth.uid(), reviewed_at = now(), reason = case when p_decision = 'REJECT' then coalesce(reason || ' | ', '') || btrim(p_reason) else reason end
    where id = v.id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'LEAVE_' || p_decision, 'leave', v.id::text,
    jsonb_build_object('reason', nullif(btrim(p_reason), ''), 'employee_id', v.employee_id));
  return v.id;
end $$;

revoke all on function public.attendance_save_entry(uuid, uuid, uuid, date, date, uuid, numeric, numeric, numeric, numeric, numeric, text, text) from public, anon;
revoke all on function public.attendance_submit_period(uuid) from public, anon;
revoke all on function public.attendance_review_period(uuid, text, text) from public, anon;
revoke all on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) from public, anon;
revoke all on function public.leave_accrue_month(uuid, date) from public, anon;
revoke all on function public.leave_create_request(uuid, uuid, uuid, uuid, text, text, date, date, numeric, text, text) from public, anon;
revoke all on function public.leave_review_request(uuid, text, text) from public, anon;
grant execute on function public.attendance_save_entry(uuid, uuid, uuid, date, date, uuid, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.attendance_submit_period(uuid) to authenticated;
grant execute on function public.attendance_review_period(uuid, text, text) to authenticated;
grant execute on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) to authenticated;
grant execute on function public.leave_accrue_month(uuid, date) to authenticated;
grant execute on function public.leave_create_request(uuid, uuid, uuid, uuid, text, text, date, date, numeric, text, text) to authenticated;
grant execute on function public.leave_review_request(uuid, text, text) to authenticated;

comment on table public.leave_policies is 'Company-configurable, effective-dated leave assumptions. No statutory entitlements are inferred.';
comment on table public.leave_balance_ledger is 'Auditable accrual and paid-leave ledger; balances are derived by summing transactions.';

