-- Portfolio-level Company Administrator.
-- This role can establish companies/branches and administer HR/branch accounts.
-- It deliberately has no employee, salary, payroll, reporting, or audit access.

alter table public.portfolio_memberships
  drop constraint portfolio_memberships_role_check;
alter table public.portfolio_memberships
  add constraint portfolio_memberships_role_check
  check (role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR'));

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
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'), ('PORTFOLIO_ADMIN', 'payslip.view'), ('PORTFOLIO_ADMIN', 'payslip.issue'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'reports.export'), ('PORTFOLIO_ADMIN', 'users.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'), ('OVERALL_HR_MANAGER', 'branch.calendar.manage'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.edit'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'), ('OVERALL_HR_MANAGER', 'employee.status.manage'), ('OVERALL_HR_MANAGER', 'employee.private.view'), ('OVERALL_HR_MANAGER', 'compensation.view'), ('OVERALL_HR_MANAGER', 'compensation.edit'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'), ('OVERALL_HR_MANAGER', 'payslip.view'), ('OVERALL_HR_MANAGER', 'payslip.issue'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'reports.export'), ('OVERALL_HR_MANAGER', 'users.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'branch.calendar.manage'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.edit'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'), ('BRANCH_MANAGER', 'compensation.view'), ('BRANCH_MANAGER', 'compensation.edit'),
      ('BRANCH_MANAGER', 'payroll.view'), ('BRANCH_MANAGER', 'payroll.prepare'), ('BRANCH_MANAGER', 'payroll.edit'), ('BRANCH_MANAGER', 'payroll.submit'), ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view'),
      ('COMPANY_ADMIN', 'company.view'), ('COMPANY_ADMIN', 'company.create'), ('COMPANY_ADMIN', 'company.edit'), ('COMPANY_ADMIN', 'branch.view'), ('COMPANY_ADMIN', 'branch.create'), ('COMPANY_ADMIN', 'branch.edit'),
      ('COMPANY_ADMIN', 'employee.view'), ('COMPANY_ADMIN', 'employee.create'), ('COMPANY_ADMIN', 'employee.submit'), ('COMPANY_ADMIN', 'employee.import'),
      ('COMPANY_ADMIN', 'attendance.view'), ('COMPANY_ADMIN', 'attendance.manage'), ('COMPANY_ADMIN', 'leave.view'), ('COMPANY_ADMIN', 'leave.request'), ('COMPANY_ADMIN', 'leave.review'),
      ('COMPANY_ADMIN', 'deduction.view'), ('COMPANY_ADMIN', 'deduction.create'), ('COMPANY_ADMIN', 'reports.view'), ('COMPANY_ADMIN', 'reports.export'), ('COMPANY_ADMIN', 'branch.calendar.manage'), ('COMPANY_ADMIN', 'users.view'), ('COMPANY_ADMIN', 'users.manage'),
      ('COMPANY_PAYROLL_PREPARER', 'company.view'), ('COMPANY_PAYROLL_PREPARER', 'branch.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.create'), ('COMPANY_PAYROLL_PREPARER', 'employee.edit'), ('COMPANY_PAYROLL_PREPARER', 'employee.submit'), ('COMPANY_PAYROLL_PREPARER', 'employee.import'), ('COMPANY_PAYROLL_PREPARER', 'employee.private.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.edit'), ('COMPANY_PAYROLL_PREPARER', 'attendance.view'), ('COMPANY_PAYROLL_PREPARER', 'leave.view'), ('COMPANY_PAYROLL_PREPARER', 'deduction.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.prepare'), ('COMPANY_PAYROLL_PREPARER', 'payroll.edit'), ('COMPANY_PAYROLL_PREPARER', 'payroll.submit'), ('COMPANY_PAYROLL_PREPARER', 'reports.view'),
      ('COMPANY_PAYROLL_APPROVER', 'company.view'), ('COMPANY_PAYROLL_APPROVER', 'branch.view'), ('COMPANY_PAYROLL_APPROVER', 'employee.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.review'), ('COMPANY_PAYROLL_APPROVER', 'payroll.approve'), ('COMPANY_PAYROLL_APPROVER', 'payroll.finalize'), ('COMPANY_PAYROLL_APPROVER', 'reports.view'), ('COMPANY_PAYROLL_REVIEWER', 'company.view'), ('COMPANY_PAYROLL_REVIEWER', 'branch.view'), ('COMPANY_PAYROLL_REVIEWER', 'employee.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.review'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.approve')
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
          and (pm.role <> 'COMPANY_ADMIN' or p_permission in (
            'company.view', 'company.create', 'company.edit', 'branch.view', 'branch.create', 'branch.edit', 'users.view', 'users.manage'
          ))
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
        join role_permissions rp on rp.role = cm.role and rp.permission = p_permission
        where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
          and cm.user_id = auth.uid() and cm.revoked_at is null
      ))
    )
  );
$$;

revoke all on function app_private.has_permission(text, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.has_permission(text, uuid, uuid, uuid) to authenticated;

-- Limit the new administrator to creating HR/branch users and managing branch-manager assignments.
create or replace function app_private.guard_company_admin_membership_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is not null and app_private.has_portfolio_role(coalesce(new.portfolio_id, old.portfolio_id), 'COMPANY_ADMIN') then
    if tg_table_name = 'portfolio_memberships' and new.role not in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER') then
      raise exception using errcode = '42501', message = 'Company Administrators may assign or revoke only HR Manager and Branch Manager portfolio roles.';
    end if;
    if tg_table_name = 'branch_assignments' and new.role <> 'BRANCH_MANAGER' then
      raise exception using errcode = '42501', message = 'Company Administrators may manage Branch Manager assignments only.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_company_admin_membership_change() from public, anon, authenticated;
drop trigger if exists company_admin_portfolio_membership_guard on public.portfolio_memberships;
create trigger company_admin_portfolio_membership_guard
  before insert or update on public.portfolio_memberships
  for each row execute function app_private.guard_company_admin_membership_change();
drop trigger if exists company_admin_branch_assignment_guard on public.branch_assignments;
create trigger company_admin_branch_assignment_guard
  before insert or update on public.branch_assignments
  for each row execute function app_private.guard_company_admin_membership_change();

create or replace function public.portfolio_membership_directory(p_portfolio_id uuid)
returns table(
  user_id uuid, email text, display_name text, role text,
  created_at timestamptz, revoked_at timestamptz, branch_ids uuid[]
)
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio user directory is not authorized.';
  end if;
  return query
  select pm.user_id, u.email::text, p.display_name, pm.role, pm.created_at, pm.revoked_at,
    coalesce(array_agg(ba.branch_id order by ba.branch_id) filter (where ba.revoked_at is null), '{}'::uuid[])
  from public.portfolio_memberships pm
  join auth.users u on u.id = pm.user_id
  join public.profiles p on p.id = pm.user_id
  left join public.branch_assignments ba on ba.portfolio_id = pm.portfolio_id
    and ba.user_id = pm.user_id and ba.role = pm.role
  where pm.portfolio_id = p_portfolio_id
    and (not app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN')
      or pm.role in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER'))
  group by pm.user_id, u.email, p.display_name, pm.role, pm.created_at, pm.revoked_at
  order by pm.created_at desc, pm.role;
end;
$$;

create or replace function public.authorize_member_invitation(
  p_portfolio_id uuid, p_role text, p_company_id uuid default null
)
returns void language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if p_company_id is not null and not exists (
    select 1 from public.companies c where c.id = p_company_id and c.portfolio_id = p_portfolio_id
  ) then
    raise exception using errcode = '42501', message = 'Invitation company is outside the authorized portfolio.';
  end if;
  if p_role = 'COMPANY_ADMIN' then
    if p_company_id is null or not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null)
      or app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN') then
      raise exception using errcode = '42501', message = 'Company-scoped administrator invitation is not authorized.';
    end if;
    return;
  end if;
  if p_role not in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    or not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio invitation is not authorized.';
  end if;
  if app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN')
    and p_role not in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER') then
    raise exception using errcode = '42501', message = 'Company Administrators may invite only HR Managers and Branch Managers.';
  end if;
  if p_role = 'PORTFOLIO_ADMIN' and not app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN') then
    raise exception using errcode = '42501', message = 'Only an existing portfolio administrator can appoint another portfolio administrator.';
  end if;
end;
$$;

drop policy if exists portfolio_memberships_read_self_or_manager on public.portfolio_memberships;
create policy portfolio_memberships_read_self_or_manager on public.portfolio_memberships
  for select to authenticated using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or app_private.is_platform_super_admin()
    or (app_private.has_permission('users.manage', portfolio_id, null, null)
      and (not app_private.has_portfolio_role(portfolio_id, 'COMPANY_ADMIN')
        or role in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER')))
  );

drop policy if exists branch_assignments_read_self_or_manager on public.branch_assignments;
create policy branch_assignments_read_self_or_manager on public.branch_assignments
  for select to authenticated using (
    user_id = (select auth.uid())
    or app_private.is_platform_super_admin()
    or (app_private.has_permission('users.manage', portfolio_id, company_id, null)
      and (not app_private.has_portfolio_role(portfolio_id, 'COMPANY_ADMIN') or role = 'BRANCH_MANAGER'))
  );

revoke all on function public.portfolio_membership_directory(uuid) from public, anon;
revoke all on function public.authorize_member_invitation(uuid, text, uuid) from public, anon;
grant execute on function public.portfolio_membership_directory(uuid) to authenticated;
grant execute on function public.authorize_member_invitation(uuid, text, uuid) to authenticated;

-- Owner-only first-admin bootstrap. It is usable only before this portfolio has
-- any companies or memberships, and only for an already-confirmed Auth account.
alter table public.audit_logs alter column actor_id drop not null;
alter table public.audit_logs add column actor_kind text not null default 'USER';
alter table public.audit_logs add constraint audit_logs_actor_kind_check
  check ((actor_kind = 'USER' and actor_id is not null) or (actor_kind = 'SYSTEM' and actor_id is null));

create or replace function public.bootstrap_first_company_administrator(p_portfolio_id uuid, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_email_confirmed timestamptz;
begin
  if p_portfolio_id is null or p_user_id is null then
    raise exception using errcode = '22023', message = 'A portfolio and existing user are required.';
  end if;
  perform 1 from public.client_portfolios where id = p_portfolio_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'The requested portfolio does not exist.';
  end if;
  if exists (select 1 from public.companies where portfolio_id = p_portfolio_id)
    or exists (select 1 from public.portfolio_memberships where portfolio_id = p_portfolio_id)
    or exists (select 1 from public.branch_assignments where portfolio_id = p_portfolio_id) then
    raise exception using errcode = '42501', message = 'Bootstrap is allowed only for a portfolio with no companies or memberships.';
  end if;
  select u.email_confirmed_at into v_email_confirmed from auth.users u
  where u.id = p_user_id and u.deleted_at is null;
  if not found or v_email_confirmed is null
    or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception using errcode = '22023', message = 'The target must be an existing, confirmed Auth user with a profile.';
  end if;

  insert into public.portfolio_memberships(portfolio_id, user_id, role)
  values (p_portfolio_id, p_user_id, 'COMPANY_ADMIN');
  insert into public.audit_logs(portfolio_id, actor_id, actor_kind, action, module, record_id, details)
  values (p_portfolio_id, null, 'SYSTEM', 'COMPANY_ADMIN_BOOTSTRAPPED', 'users', p_user_id::text,
    jsonb_build_object('role', 'COMPANY_ADMIN', 'provisioning_method', 'database_owner_bootstrap'));
end;
$$;

revoke all on function public.bootstrap_first_company_administrator(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.portfolio_membership_directory(uuid) to authenticated;
grant execute on function public.authorize_member_invitation(uuid, text, uuid) to authenticated;

comment on function app_private.has_permission(text, uuid, uuid, uuid) is
  'Permission authority for current scoped roles. Portfolio COMPANY_ADMIN is limited to company/branch setup and HR/branch user management.';
comment on function public.bootstrap_first_company_administrator(uuid, uuid) is
  'Owner-only, one-time bootstrap for a confirmed Auth user in a portfolio with no companies or memberships. Not executable by API roles.';
