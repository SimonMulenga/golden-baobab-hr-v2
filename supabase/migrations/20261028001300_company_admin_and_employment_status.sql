-- Add company-scoped administration and audited employment lifecycle status.
-- Existing portfolio and branch roles remain unchanged.

create table public.company_memberships (
  portfolio_id uuid not null,
  company_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role = 'COMPANY_ADMIN'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (portfolio_id, company_id, user_id, role),
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict
);
create index company_memberships_user_active_idx
  on public.company_memberships(user_id, portfolio_id, company_id) where revoked_at is null;
alter table public.company_memberships enable row level security;
revoke all on public.company_memberships from public, anon, authenticated;
grant select on public.company_memberships to authenticated;
create policy company_memberships_read_authorized on public.company_memberships
  for select to authenticated using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or app_private.has_permission('users.manage', portfolio_id, company_id, null)
  );

-- COMPANY_ADMIN privileges are company-bound and deliberately exclude employee approval,
-- private identifiers, compensation, deduction approval, payroll processing/approval,
-- finalization, and platform administration.
create or replace function app_private.has_permission(
  p_permission text,
  p_portfolio_id uuid,
  p_company_id uuid default null,
  p_branch_id uuid default null
)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  with role_permissions(role, permission) as (
    values
      ('PORTFOLIO_ADMIN', 'company.view'), ('PORTFOLIO_ADMIN', 'company.create'), ('PORTFOLIO_ADMIN', 'company.edit'),
      ('PORTFOLIO_ADMIN', 'branch.view'), ('PORTFOLIO_ADMIN', 'branch.create'), ('PORTFOLIO_ADMIN', 'branch.edit'),
      ('PORTFOLIO_ADMIN', 'employee.view'), ('PORTFOLIO_ADMIN', 'employee.create'), ('PORTFOLIO_ADMIN', 'employee.edit'), ('PORTFOLIO_ADMIN', 'employee.submit'), ('PORTFOLIO_ADMIN', 'employee.approve'), ('PORTFOLIO_ADMIN', 'employee.reject'), ('PORTFOLIO_ADMIN', 'employee.import'), ('PORTFOLIO_ADMIN', 'employee.status.manage'), ('PORTFOLIO_ADMIN', 'employee.private.view'), ('PORTFOLIO_ADMIN', 'compensation.view'), ('PORTFOLIO_ADMIN', 'compensation.edit'),
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'), ('PORTFOLIO_ADMIN', 'payslip.view'), ('PORTFOLIO_ADMIN', 'payslip.issue'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'reports.export'), ('PORTFOLIO_ADMIN', 'users.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.edit'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'), ('OVERALL_HR_MANAGER', 'employee.status.manage'), ('OVERALL_HR_MANAGER', 'employee.private.view'), ('OVERALL_HR_MANAGER', 'compensation.view'), ('OVERALL_HR_MANAGER', 'compensation.edit'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'), ('OVERALL_HR_MANAGER', 'payslip.view'), ('OVERALL_HR_MANAGER', 'payslip.issue'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'reports.export'), ('OVERALL_HR_MANAGER', 'users.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'),
      ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view'),
      ('COMPANY_ADMIN', 'company.view'), ('COMPANY_ADMIN', 'company.edit'), ('COMPANY_ADMIN', 'branch.view'), ('COMPANY_ADMIN', 'branch.create'), ('COMPANY_ADMIN', 'branch.edit'),
      ('COMPANY_ADMIN', 'employee.view'), ('COMPANY_ADMIN', 'employee.create'), ('COMPANY_ADMIN', 'employee.submit'), ('COMPANY_ADMIN', 'employee.import'),
      ('COMPANY_ADMIN', 'attendance.view'), ('COMPANY_ADMIN', 'attendance.manage'), ('COMPANY_ADMIN', 'leave.view'), ('COMPANY_ADMIN', 'leave.request'), ('COMPANY_ADMIN', 'leave.review'),
      ('COMPANY_ADMIN', 'deduction.view'), ('COMPANY_ADMIN', 'deduction.create'), ('COMPANY_ADMIN', 'reports.view'), ('COMPANY_ADMIN', 'reports.export'), ('COMPANY_ADMIN', 'users.view'), ('COMPANY_ADMIN', 'users.manage')
  ),
  company_exists as (
    select exists (select 1 from public.companies c where c.id = p_company_id and c.portfolio_id = p_portfolio_id) as ok
  ),
  branch_exists as (
    select exists (select 1 from public.branches b where b.id = p_branch_id and b.portfolio_id = p_portfolio_id
      and (p_company_id is null or b.company_id = p_company_id)) as ok
  )
  select (
    p_portfolio_id is not null
    and (p_company_id is null or (select ok from company_exists))
    and (p_branch_id is null or (select ok from branch_exists))
    and (
      exists (
        select 1 from public.portfolio_memberships pm
        join role_permissions rp on rp.role = pm.role and rp.permission = p_permission
        where pm.portfolio_id = p_portfolio_id and pm.user_id = auth.uid() and pm.revoked_at is null
          and (pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER') or (
            p_company_id is not null and exists (
              select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
                and ba.company_id = p_company_id and ba.user_id = auth.uid() and ba.role = pm.role
                and ba.revoked_at is null and (p_branch_id is null or ba.branch_id = p_branch_id)
            )
          ))
      )
      or (p_company_id is not null and exists (
        select 1 from public.company_memberships cm
        join role_permissions rp on rp.role = cm.role and rp.permission = p_permission
        where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
          and cm.user_id = auth.uid() and cm.revoked_at is null
      ))
    )
  );
$$;

alter table public.employees add column employment_status text not null default 'ACTIVE'
  check (employment_status in ('ACTIVE', 'SUSPENDED', 'TERMINATED'));
create index employees_tenant_branch_employment_status_idx
  on public.employees(portfolio_id, company_id, workplace_branch_id, employment_status, last_name, id);

create table public.employee_employment_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  previous_status text not null check (previous_status in ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
  new_status text not null check (new_status in ('ACTIVE', 'SUSPENDED', 'TERMINATED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (previous_status <> new_status)
);
create index employee_employment_history_employee_idx
  on public.employee_employment_history(portfolio_id, company_id, branch_id, employee_id, occurred_at desc);
alter table public.employee_employment_history enable row level security;
revoke all on public.employee_employment_history from public, anon, authenticated;
grant select on public.employee_employment_history to authenticated;
create policy employee_employment_history_read_authorized on public.employee_employment_history
  for select to authenticated using (
    app_private.has_permission('employee.view', portfolio_id, company_id, branch_id)
  );

create or replace function public.assign_company_admin(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'Users cannot assign company administrator access to themselves.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The user must complete account activation before company assignment.';
  end if;
  insert into public.company_memberships(portfolio_id, company_id, user_id, role, created_by, revoked_at)
  values (p_portfolio_id, p_company_id, p_user_id, 'COMPANY_ADMIN', auth.uid(), null)
  on conflict (portfolio_id, company_id, user_id, role)
  do update set created_by = auth.uid(), created_at = now(), revoked_at = null;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_ADMIN_ASSIGNED', 'users', p_user_id::text,
    jsonb_build_object('role', 'COMPANY_ADMIN'));
end;
$$;

create or replace function public.revoke_company_admin(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_changed integer;
begin
  if p_user_id is null or p_user_id = auth.uid() or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different target user and a revocation reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  update public.company_memberships set revoked_at = coalesce(revoked_at, now())
  where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id
    and role = 'COMPANY_ADMIN' and revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_ADMIN_REVOKED', 'users', p_user_id::text,
      jsonb_build_object('role', 'COMPANY_ADMIN', 'reason', btrim(p_reason)));
  end if;
end;
$$;

create or replace function public.company_admin_members(p_portfolio_id uuid, p_company_id uuid)
returns table(user_id uuid, email text, display_name text, role text, created_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user directory is not authorized.';
  end if;
  return query
  select cm.user_id, u.email::text, p.display_name, cm.role, cm.created_at, cm.revoked_at
  from public.company_memberships cm
  join auth.users u on u.id = cm.user_id
  join public.profiles p on p.id = cm.user_id
  where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
  order by cm.created_at desc, cm.user_id;
end;
$$;

create or replace function public.employee_set_employment_status(p_employee_id uuid, p_status text, p_reason text)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_employee public.employees%rowtype;
begin
  if p_status is null or p_status not in ('ACTIVE', 'SUSPENDED', 'TERMINATED')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Choose a valid employment status and provide a reason.';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or v_employee.approval_status <> 'APPROVED'
    or not app_private.has_permission('employee.status.manage', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employment status change is not authorized.';
  end if;
  if v_employee.employment_status = p_status then
    raise exception using errcode = '22023', message = 'Employee already has the selected employment status.';
  end if;
  if v_employee.employment_status = 'TERMINATED' then
    raise exception using errcode = '22023', message = 'A terminated employee cannot be reactivated through this workflow.';
  end if;
  update public.employees set employment_status = p_status, updated_at = now() where id = v_employee.id;
  insert into public.employee_employment_history(portfolio_id, company_id, branch_id, employee_id,
    previous_status, new_status, reason, actor_id)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, v_employee.id,
    v_employee.employment_status, p_status, btrim(p_reason), auth.uid());
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, auth.uid(),
    'EMPLOYEE_EMPLOYMENT_STATUS_CHANGED', 'employees', v_employee.id::text,
    jsonb_build_object('previous_status', v_employee.employment_status, 'new_status', p_status, 'reason', btrim(p_reason)));
  return v_employee.id;
end;
$$;

-- Payroll previews must not include suspended or terminated employees.
create or replace function public.payroll_preview_inputs(
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
  if not found or v_attendance.status <> 'APPROVED' then
    raise exception using errcode = '22023', message = 'An approved attendance period matching the payroll dates is required.';
  end if;
  select jsonb_build_object(
    'portfolio_id', v_portfolio_id, 'company_id', p_company_id, 'branch_id', p_branch_id,
    'period_start', p_period_start, 'period_end', p_period_end, 'attendance_period_id', v_attendance.id,
    'attendance_approved_at', v_attendance.reviewed_at,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'employee_number', e.employee_number,
      'employee_name', concat_ws(' ', e.first_name, nullif(e.middle_name, ''), e.last_name),
      'contract_type', e.contract_type, 'employment_type', e.employment_type,
      'salary_frequency', comp.salary_frequency, 'compensation_effective_from', comp.effective_from,
      'basic_pay', comp.basic_pay, 'housing_allowance', comp.housing_allowance, 'meal_allowance', comp.meal_allowance,
      'transport_allowance', comp.transport_allowance, 'other_allowances', comp.other_allowances,
      'overtime_eligible', comp.overtime_eligible, 'allowance_tax_treatment', comp.allowance_tax_treatment,
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
      'input_warnings', to_jsonb(array_remove(array[
        case when comp.id is null then 'MISSING_EFFECTIVE_COMPENSATION' end,
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
    and e.approval_status = 'APPROVED' and e.employment_status = 'ACTIVE'
    and e.contract_start_date <= p_period_end and (e.contract_end_date is null or e.contract_end_date >= p_period_start);
  return v_result;
end;
$$;

revoke all on function public.assign_company_admin(uuid, uuid, uuid) from public, anon;
revoke all on function public.revoke_company_admin(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.company_admin_members(uuid, uuid) from public, anon;
revoke all on function public.employee_set_employment_status(uuid, text, text) from public, anon;
revoke all on function public.payroll_preview_inputs(uuid, uuid, date, date) from public, anon;
grant execute on function public.assign_company_admin(uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_company_admin(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.company_admin_members(uuid, uuid) to authenticated;
grant execute on function public.employee_set_employment_status(uuid, text, text) to authenticated;
grant execute on function public.payroll_preview_inputs(uuid, uuid, date, date) to authenticated;

comment on table public.company_memberships is 'Company-scoped access. Company administrators do not gain portfolio-wide privileges.';
comment on function public.employee_set_employment_status(uuid, text, text) is 'Audited status workflow. Only active/suspended/terminated transitions are allowed; terminated is terminal.';
comment on function public.payroll_preview_inputs(uuid, uuid, date, date) is 'Read-only payroll input snapshot that requires approved attendance, approved employees, active employment status, and authorized branch access. Does not calculate or persist payroll.';

