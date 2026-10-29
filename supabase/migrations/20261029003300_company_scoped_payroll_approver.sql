
-- Company scoped payroll approver. This role can review and finalize payroll
-- only for its assigned company; no portfolio membership or branch assignment is added.
alter table public.company_memberships drop constraint company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_APPROVER'));
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
      ('COMPANY_ADMIN', 'deduction.view'), ('COMPANY_ADMIN', 'deduction.create'), ('COMPANY_ADMIN', 'reports.view'),
      ('COMPANY_PAYROLL_APPROVER', 'company.view'), ('COMPANY_PAYROLL_APPROVER', 'branch.view'), ('COMPANY_PAYROLL_APPROVER', 'employee.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.review'), ('COMPANY_PAYROLL_APPROVER', 'payroll.approve'), ('COMPANY_PAYROLL_APPROVER', 'payroll.finalize'), ('COMPANY_PAYROLL_APPROVER', 'reports.view'), ('COMPANY_ADMIN', 'reports.export'), ('COMPANY_ADMIN', 'users.view'), ('COMPANY_ADMIN', 'users.manage')
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
create or replace function public.assign_company_payroll_approver(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'A different target account is required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The target account must be activated first.';
  end if;
  insert into public.company_memberships(portfolio_id, company_id, user_id, role, created_by, revoked_at)
  values (p_portfolio_id, p_company_id, p_user_id, 'COMPANY_PAYROLL_APPROVER', auth.uid(), null)
  on conflict (portfolio_id, company_id, user_id, role)
  do update set created_by = auth.uid(), created_at = now(), revoked_at = null;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_PAYROLL_APPROVER_ASSIGNED', 'users', p_user_id::text,
    jsonb_build_object('role', 'COMPANY_PAYROLL_APPROVER'));
end;
$$;

create or replace function public.revoke_company_payroll_approver(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_changed integer;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account and a revocation reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  update public.company_memberships set revoked_at = coalesce(revoked_at, now())
  where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id
    and role = 'COMPANY_PAYROLL_APPROVER' and revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_PAYROLL_APPROVER_REVOKED', 'users', p_user_id::text,
      jsonb_build_object('role', 'COMPANY_PAYROLL_APPROVER', 'reason', btrim(p_reason)));
  end if;
end;
$$;

create or replace function public.company_payroll_approver_members(p_portfolio_id uuid, p_company_id uuid)
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
    and cm.role = 'COMPANY_PAYROLL_APPROVER'
  order by cm.created_at desc, cm.user_id;
end;
$$;

revoke all on function public.assign_company_payroll_approver(uuid, uuid, uuid) from public, anon;
revoke all on function public.revoke_company_payroll_approver(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.company_payroll_approver_members(uuid, uuid) from public, anon;
grant execute on function public.assign_company_payroll_approver(uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_company_payroll_approver(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.company_payroll_approver_members(uuid, uuid) to authenticated;
comment on function public.assign_company_payroll_approver(uuid, uuid, uuid) is 'Assigns an audited payroll approver bound to one company after an authorized user-management check.';
comment on function public.company_payroll_approver_members(uuid, uuid) is 'Lists only company-scoped payroll approvers for an authorized company user manager.';
