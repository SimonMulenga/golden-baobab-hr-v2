-- M4 authorization checkpoint: read access is tenant and branch scoped.
-- Domain tables intentionally have no direct browser write grants; privileged
-- state transitions are exposed only through reviewed SECURITY DEFINER RPCs.

create or replace function app_private.has_permission(
  p_permission text,
  p_portfolio_id uuid,
  p_company_id uuid default null,
  p_branch_id uuid default null
)
returns boolean
language sql stable security definer
set search_path = pg_catalog
set row_security = off
as $$
  with role_permissions(role, permission) as (
    values
      ('PORTFOLIO_ADMIN', 'company.view'), ('PORTFOLIO_ADMIN', 'company.create'), ('PORTFOLIO_ADMIN', 'company.edit'),
      ('PORTFOLIO_ADMIN', 'branch.view'), ('PORTFOLIO_ADMIN', 'branch.create'), ('PORTFOLIO_ADMIN', 'branch.edit'),
      ('PORTFOLIO_ADMIN', 'employee.view'), ('PORTFOLIO_ADMIN', 'employee.create'), ('PORTFOLIO_ADMIN', 'employee.submit'), ('PORTFOLIO_ADMIN', 'employee.approve'), ('PORTFOLIO_ADMIN', 'employee.reject'), ('PORTFOLIO_ADMIN', 'employee.import'), ('PORTFOLIO_ADMIN', 'employee.private.view'), ('PORTFOLIO_ADMIN', 'compensation.view'), ('PORTFOLIO_ADMIN', 'compensation.edit'),
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'), ('OVERALL_HR_MANAGER', 'employee.private.view'), ('OVERALL_HR_MANAGER', 'compensation.view'), ('OVERALL_HR_MANAGER', 'compensation.edit'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'),
      ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'compensation.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view')
  ),
  company_exists as (
    select exists (
      select 1 from public.companies c
      where c.id = p_company_id and c.portfolio_id = p_portfolio_id
    ) as ok
  ),
  branch_exists as (
    select exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.portfolio_id = p_portfolio_id
        and (p_company_id is null or b.company_id = p_company_id)
    ) as ok
  )
  select p_portfolio_id is not null
    and (p_company_id is null or (select ok from company_exists))
    and (p_branch_id is null or (select ok from branch_exists))
    and exists (
      select 1
      from public.portfolio_memberships pm
      join role_permissions rp on rp.role = pm.role and rp.permission = p_permission
      where pm.portfolio_id = p_portfolio_id
        and pm.user_id = auth.uid()
        and pm.revoked_at is null
        and (
          pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER')
          or (
            p_company_id is not null
            and exists (
              select 1 from public.branch_assignments ba
              where ba.portfolio_id = p_portfolio_id
                and ba.company_id = p_company_id
                and ba.user_id = auth.uid()
                and ba.role = pm.role
                and ba.revoked_at is null
                and (p_branch_id is null or ba.branch_id = p_branch_id)
            )
          )
        )
    );
$$;

-- Customer-level metadata access is still membership-scoped. Platform
-- administration must use separately audited operations, never a tenant RLS bypass.
drop policy if exists portfolios_read_member on public.client_portfolios;
create policy portfolios_read_member on public.client_portfolios
  for select to authenticated using (
    app_private.has_portfolio_role(id, 'PORTFOLIO_ADMIN')
    or app_private.has_portfolio_role(id, 'OVERALL_HR_MANAGER')
    or app_private.has_portfolio_role(id, 'BRANCH_MANAGER')
    or app_private.has_portfolio_role(id, 'PAYROLL_PROCESSOR')
  );

drop policy if exists portfolio_memberships_read_self_or_manager on public.portfolio_memberships;
create policy portfolio_memberships_read_self_or_manager on public.portfolio_memberships
  for select to authenticated using (
    (user_id = auth.uid() and revoked_at is null)
    or app_private.has_permission('users.manage', portfolio_id, null, null)
  );

drop policy if exists branch_assignments_read_self_or_manager on public.branch_assignments;
create policy branch_assignments_read_self_or_manager on public.branch_assignments
  for select to authenticated using (
    app_private.has_permission('branch.view', portfolio_id, company_id, branch_id)
  );

create policy employees_read_authorized on public.employees
  for select to authenticated using (
    app_private.has_permission('employee.view', portfolio_id, company_id, workplace_branch_id)
  );
create policy employee_private_details_read_authorized on public.employee_private_details
  for select to authenticated using (
    app_private.has_permission('employee.private.view', portfolio_id, company_id, null)
  );
create policy employee_compensation_read_authorized on public.employee_compensation
  for select to authenticated using (
    app_private.has_permission('compensation.view', portfolio_id, company_id, workplace_branch_id)
  );
create policy employee_approval_history_read_authorized on public.employee_approval_history
  for select to authenticated using (
    app_private.has_permission('employee.view', portfolio_id, company_id, branch_id)
  );
create policy attendance_periods_read_authorized on public.attendance_periods
  for select to authenticated using (
    app_private.has_permission('attendance.view', portfolio_id, company_id, branch_id)
  );
create policy attendance_entries_read_authorized on public.attendance_entries
  for select to authenticated using (
    app_private.has_permission('attendance.view', portfolio_id, company_id, branch_id)
  );
create policy leave_requests_read_authorized on public.leave_requests
  for select to authenticated using (
    app_private.has_permission('leave.view', portfolio_id, company_id, branch_id)
  );
create policy employee_deductions_read_authorized on public.employee_deductions
  for select to authenticated using (
    app_private.has_permission('deduction.view', portfolio_id, company_id, branch_id)
  );
create policy deduction_approval_history_read_authorized on public.deduction_approval_history
  for select to authenticated using (
    app_private.has_permission('deduction.view', portfolio_id, company_id, branch_id)
  );
create policy deduction_installments_read_authorized on public.deduction_installments
  for select to authenticated using (
    app_private.has_permission('deduction.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_periods_read_authorized on public.payroll_periods
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_runs_read_authorized on public.payroll_runs
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_run_statutory_rules_read_authorized on public.payroll_run_statutory_rules
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_run_items_read_authorized on public.payroll_run_items
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_item_deductions_read_authorized on public.payroll_item_deductions
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy deduction_transactions_read_authorized on public.deduction_transactions
  for select to authenticated using (
    app_private.has_permission('deduction.view', portfolio_id, company_id, branch_id)
  );
create policy payroll_approvals_read_authorized on public.payroll_approvals
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
create policy audit_logs_read_authorized on public.audit_logs
  for select to authenticated using (
    app_private.has_permission('reports.view', portfolio_id, company_id, branch_id)
  );

grant select on public.employees, public.employee_private_details, public.employee_compensation,
  public.employee_approval_history, public.attendance_periods, public.attendance_entries,
  public.leave_requests, public.employee_deductions, public.deduction_approval_history, public.deduction_installments,
  public.payroll_periods, public.payroll_runs, public.payroll_run_statutory_rules, public.payroll_run_items,
  public.payroll_item_deductions, public.deduction_transactions,
  public.payroll_approvals, public.audit_logs to authenticated;

revoke execute on function app_private.is_platform_super_admin() from authenticated;
revoke execute on function app_private.has_portfolio_role(uuid, text) from public, anon;
grant execute on function app_private.has_portfolio_role(uuid, text) to authenticated;
grant execute on function app_private.has_permission(text, uuid, uuid, uuid) to authenticated;


