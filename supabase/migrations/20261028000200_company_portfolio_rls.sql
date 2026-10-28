-- M1 authorization checkpoint: explicit grants and deny-by-default RLS.
-- This migration follows the schema-only checkpoint. Do not run automatically.

create or replace function app_private.is_platform_super_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select exists (
    select 1 from public.platform_administrators pa
    where pa.user_id = auth.uid() and pa.revoked_at is null
  );
$$;

create or replace function app_private.has_portfolio_role(p_portfolio_id uuid, p_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select exists (
    select 1 from public.portfolio_memberships pm
    where pm.portfolio_id = p_portfolio_id
      and pm.user_id = auth.uid()
      and pm.role = p_role
      and pm.revoked_at is null
  );
$$;

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
      ('PORTFOLIO_ADMIN', 'employee.view'), ('PORTFOLIO_ADMIN', 'employee.create'), ('PORTFOLIO_ADMIN', 'employee.edit'), ('PORTFOLIO_ADMIN', 'employee.submit'), ('PORTFOLIO_ADMIN', 'employee.approve'), ('PORTFOLIO_ADMIN', 'employee.reject'), ('PORTFOLIO_ADMIN', 'employee.import'),
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'),
      ('PORTFOLIO_ADMIN', 'payslip.view'), ('PORTFOLIO_ADMIN', 'payslip.issue'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'reports.export'), ('PORTFOLIO_ADMIN', 'users.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.edit'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'),
      ('OVERALL_HR_MANAGER', 'payslip.view'), ('OVERALL_HR_MANAGER', 'payslip.issue'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'reports.export'), ('OVERALL_HR_MANAGER', 'users.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'),
      ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view')
  ),
  company_exists as (
    select exists (select 1 from public.companies c where c.id = p_company_id and c.portfolio_id = p_portfolio_id) as ok
  ),
  branch_exists as (
    select exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.portfolio_id = p_portfolio_id
        and (p_company_id is null or b.company_id = p_company_id)
    ) as ok
  )
  select (
      p_portfolio_id is not null
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
      )
    );
$$;

revoke all on function app_private.is_platform_super_admin() from public, anon;
revoke all on function app_private.has_portfolio_role(uuid, text) from public, anon;
revoke all on function app_private.has_permission(text, uuid, uuid, uuid) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_platform_super_admin() to authenticated;
grant execute on function app_private.has_portfolio_role(uuid, text) to authenticated;
grant execute on function app_private.has_permission(text, uuid, uuid, uuid) to authenticated;

grant select on public.profiles, public.client_portfolios, public.portfolio_memberships,
  public.companies, public.branches, public.branch_assignments to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert on public.companies to authenticated;
grant update (name, registration_number, tpin, industry, business_email, phone, province, town, physical_address, contact_person, status)
  on public.companies to authenticated;
grant insert on public.branches to authenticated;
grant update (name, code, province, town, physical_address, manager_name, contact_phone, status)
  on public.branches to authenticated;

create policy profiles_read_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy portfolios_read_member on public.client_portfolios
  for select to authenticated using (
    app_private.is_platform_super_admin()
    or exists (
      select 1 from public.portfolio_memberships pm
      where pm.portfolio_id = id and pm.user_id = (select auth.uid()) and pm.revoked_at is null
    )
  );
create policy portfolio_memberships_read_self_or_manager on public.portfolio_memberships
  for select to authenticated using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or app_private.has_permission('users.manage', portfolio_id, null, null)
    or app_private.is_platform_super_admin()
  );

create policy companies_read_authorized on public.companies
  for select to authenticated using (app_private.has_permission('company.view', portfolio_id, id, null));
create policy companies_create_authorized on public.companies
  for insert to authenticated with check (app_private.has_permission('company.create', portfolio_id, null, null));
create policy companies_update_authorized on public.companies
  for update to authenticated
  using (app_private.has_permission('company.edit', portfolio_id, id, null))
  with check (app_private.has_permission('company.edit', portfolio_id, id, null));

create policy branches_read_authorized on public.branches
  for select to authenticated using (app_private.has_permission('branch.view', portfolio_id, company_id, id));
create policy branches_create_authorized on public.branches
  for insert to authenticated with check (app_private.has_permission('branch.create', portfolio_id, company_id, null));
create policy branches_update_authorized on public.branches
  for update to authenticated
  using (app_private.has_permission('branch.edit', portfolio_id, company_id, id))
  with check (app_private.has_permission('branch.edit', portfolio_id, company_id, id));

create policy branch_assignments_read_self_or_manager on public.branch_assignments
  for select to authenticated using (
    user_id = (select auth.uid())
    or app_private.has_permission('users.manage', portfolio_id, company_id, null)
    or app_private.is_platform_super_admin()
  );

comment on function app_private.has_permission(text, uuid, uuid, uuid)
  is 'Validates active stored roles and relationships. Branch roles require an explicit active assignment; request IDs are never authority.';
