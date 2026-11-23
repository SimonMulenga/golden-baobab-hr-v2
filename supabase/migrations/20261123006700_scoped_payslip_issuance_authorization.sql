-- Align the trusted payslip issuer with the application's existing scoped
-- permissions. Company administrators retain company scope; branch managers
-- gain issue permission only for an actively assigned branch. This does not
-- grant payroll finalization or email delivery to branch managers.

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
      ('PORTFOLIO_ADMIN', 'branch.view'), ('PORTFOLIO_ADMIN', 'branch.create'), ('PORTFOLIO_ADMIN', 'branch.edit'), ('PORTFOLIO_ADMIN', 'branch.calendar.manage'),
      ('PORTFOLIO_ADMIN', 'employee.view'), ('PORTFOLIO_ADMIN', 'employee.create'), ('PORTFOLIO_ADMIN', 'employee.edit'), ('PORTFOLIO_ADMIN', 'employee.submit'), ('PORTFOLIO_ADMIN', 'employee.approve'), ('PORTFOLIO_ADMIN', 'employee.reject'), ('PORTFOLIO_ADMIN', 'employee.import'), ('PORTFOLIO_ADMIN', 'employee.status.manage'), ('PORTFOLIO_ADMIN', 'employee.private.view'), ('PORTFOLIO_ADMIN', 'compensation.view'), ('PORTFOLIO_ADMIN', 'compensation.edit'),
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'), ('PORTFOLIO_ADMIN', 'leave.policy.manage'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'), ('PORTFOLIO_ADMIN', 'payslip.view'), ('PORTFOLIO_ADMIN', 'payslip.issue'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'reports.export'), ('PORTFOLIO_ADMIN', 'users.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'), ('OVERALL_HR_MANAGER', 'branch.calendar.manage'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.edit'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'), ('OVERALL_HR_MANAGER', 'employee.status.manage'), ('OVERALL_HR_MANAGER', 'employee.private.view'), ('OVERALL_HR_MANAGER', 'compensation.view'), ('OVERALL_HR_MANAGER', 'compensation.edit'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'), ('OVERALL_HR_MANAGER', 'leave.policy.manage'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'), ('OVERALL_HR_MANAGER', 'payslip.view'), ('OVERALL_HR_MANAGER', 'payslip.issue'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'reports.export'), ('OVERALL_HR_MANAGER', 'users.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'branch.calendar.manage'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.edit'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'), ('BRANCH_MANAGER', 'compensation.view'), ('BRANCH_MANAGER', 'compensation.edit'),
      ('BRANCH_MANAGER', 'payroll.view'), ('BRANCH_MANAGER', 'payroll.prepare'), ('BRANCH_MANAGER', 'payroll.edit'), ('BRANCH_MANAGER', 'payroll.submit'), ('BRANCH_MANAGER', 'payslip.issue'), ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view'),
      ('COMPANY_PAYROLL_PREPARER', 'company.view'), ('COMPANY_PAYROLL_PREPARER', 'branch.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.create'), ('COMPANY_PAYROLL_PREPARER', 'employee.edit'), ('COMPANY_PAYROLL_PREPARER', 'employee.submit'), ('COMPANY_PAYROLL_PREPARER', 'employee.import'), ('COMPANY_PAYROLL_PREPARER', 'employee.private.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.edit'), ('COMPANY_PAYROLL_PREPARER', 'attendance.view'), ('COMPANY_PAYROLL_PREPARER', 'leave.view'), ('COMPANY_PAYROLL_PREPARER', 'deduction.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.prepare'), ('COMPANY_PAYROLL_PREPARER', 'payroll.edit'), ('COMPANY_PAYROLL_PREPARER', 'payroll.submit'), ('COMPANY_PAYROLL_PREPARER', 'reports.view'),
      ('COMPANY_PAYROLL_APPROVER', 'company.view'), ('COMPANY_PAYROLL_APPROVER', 'branch.view'), ('COMPANY_PAYROLL_APPROVER', 'employee.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.review'), ('COMPANY_PAYROLL_APPROVER', 'payroll.approve'), ('COMPANY_PAYROLL_APPROVER', 'payroll.finalize'), ('COMPANY_PAYROLL_APPROVER', 'reports.view'),
      ('COMPANY_PAYROLL_REVIEWER', 'company.view'), ('COMPANY_PAYROLL_REVIEWER', 'branch.view'), ('COMPANY_PAYROLL_REVIEWER', 'employee.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.review'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.approve')
  ),
  effective_role_permissions(role, permission) as (
    select role, permission from role_permissions
    union all
    select 'COMPANY_ADMIN', permission from role_permissions where role = 'PORTFOLIO_ADMIN'
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
        join effective_role_permissions rp on rp.role = pm.role and rp.permission = p_permission
        where pm.portfolio_id = p_portfolio_id and pm.user_id = auth.uid() and pm.revoked_at is null
          and (pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'COMPANY_ADMIN') or (
            p_company_id is not null and exists (
              select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
                and ba.company_id = p_company_id and ba.user_id = auth.uid() and ba.role = pm.role
                and ba.revoked_at is null and (p_branch_id is null or ba.branch_id = p_branch_id)
            )
          ))
      )
      or (p_company_id is not null and exists (
        select 1 from public.company_memberships cm
        join effective_role_permissions rp on rp.role = cm.role and rp.permission = p_permission
        where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
          and cm.user_id = auth.uid() and cm.revoked_at is null
      ))
    )
  );
$$;

create or replace function app_private.payslip_actor_has_permission(
  p_actor_id uuid, p_permission text, p_portfolio_id uuid, p_company_id uuid, p_branch_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select p_actor_id is not null
    and p_permission in ('payslip.issue', 'payroll.finalize', 'payroll.view')
    and exists (
      select 1 from public.companies c
      join public.branches b on b.company_id = c.id and b.portfolio_id = c.portfolio_id
      where c.id = p_company_id and c.portfolio_id = p_portfolio_id and b.id = p_branch_id
    )
    and (
      exists (
        select 1 from public.portfolio_memberships pm
        where pm.user_id = p_actor_id and pm.portfolio_id = p_portfolio_id and pm.revoked_at is null
          and (
            pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'COMPANY_ADMIN')
            or (pm.role = 'BRANCH_MANAGER'
              and p_permission in ('payslip.issue', 'payroll.view')
              and exists (
                select 1 from public.branch_assignments ba where ba.user_id = p_actor_id
                  and ba.portfolio_id = p_portfolio_id and ba.company_id = p_company_id
                  and ba.branch_id = p_branch_id and ba.role = pm.role and ba.revoked_at is null
              ))
          )
      )
      or (p_permission in ('payslip.issue', 'payroll.finalize', 'payroll.view') and exists (
        select 1 from public.company_memberships cm
        where cm.user_id = p_actor_id and cm.portfolio_id = p_portfolio_id
          and cm.company_id = p_company_id and cm.role = 'COMPANY_ADMIN' and cm.revoked_at is null
      ))
    );
$$;
revoke all on function app_private.payslip_actor_has_permission(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function app_private.payslip_snapshot_for_user(
  p_actor_id uuid, p_payroll_run_id uuid, p_employee_id uuid, p_issuance boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'portfolio_id', r.portfolio_id,
    'company_id', r.company_id,
    'branch_id', r.branch_id,
    'payroll_run_id', r.id,
    'employee_id', i.employee_id,
    'payroll_version', i.version,
    'finalized_at', r.finalized_at,
    'period_start', pp.period_start,
    'period_end', pp.period_end,
    'company', jsonb_build_object('name', c.name, 'address', c.physical_address, 'town', c.town, 'province', c.province),
    'branch', jsonb_build_object('name', b.name),
    'employee', jsonb_build_object('employee_number', e.employee_number,
      'first_name', e.first_name, 'middle_name', e.middle_name, 'last_name', e.last_name,
      'job_title', e.job_title, 'department', e.department),
    'payroll_item', to_jsonb(i)
  ) into v_payload
  from public.payroll_runs r
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  join public.companies c on c.id = r.company_id and c.portfolio_id = r.portfolio_id
  join public.branches b on b.id = r.branch_id and b.company_id = r.company_id and b.portfolio_id = r.portfolio_id
  join public.payroll_run_items i on i.payroll_run_id = r.id and i.version = r.version
  join public.employees e on e.id = i.employee_id and e.company_id = i.company_id and e.portfolio_id = i.portfolio_id
  where r.id = p_payroll_run_id and i.employee_id = p_employee_id and r.status = 'FINALIZED';
  if v_payload is null then
    raise exception using errcode = 'P0002', message = 'Finalized payslip source was not found.';
  end if;
  if p_actor_id is null or not app_private.payslip_actor_has_permission(
    p_actor_id,
    case when p_issuance then 'payslip.issue' else 'payroll.view' end,
    (v_payload->>'portfolio_id')::uuid,
    (v_payload->>'company_id')::uuid,
    (v_payload->>'branch_id')::uuid
  ) then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  return v_payload || app_private.payslip_financial_details(p_payroll_run_id, p_employee_id);
end;
$$;
revoke all on function app_private.payslip_snapshot_for_user(uuid,uuid,uuid,boolean) from public, anon, authenticated;
