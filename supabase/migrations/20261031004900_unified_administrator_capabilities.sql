-- M49: make portfolio and company administrators equivalent where their
-- authorized resource scopes overlap. Scope remains enforced by membership,
-- company/branch ownership checks, and the existing RLS policies.

create or replace function app_private.has_portfolio_role(p_portfolio_id uuid, p_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select exists (
    select 1 from public.portfolio_memberships pm
    where pm.portfolio_id = p_portfolio_id
      and pm.user_id = auth.uid()
      and pm.revoked_at is null
      and (
        pm.role = p_role
        or (p_role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN') and pm.role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN'))
      )
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
      ('BRANCH_MANAGER', 'payroll.view'), ('BRANCH_MANAGER', 'payroll.prepare'), ('BRANCH_MANAGER', 'payroll.edit'), ('BRANCH_MANAGER', 'payroll.submit'), ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
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

revoke all on function app_private.has_permission(text, uuid, uuid, uuid) from public, anon;
grant execute on function app_private.has_permission(text, uuid, uuid, uuid) to authenticated;
revoke all on function app_private.has_portfolio_role(uuid, text) from public, anon;
grant execute on function app_private.has_portfolio_role(uuid, text) to authenticated;

-- Remove the narrower Company Administrator role-assignment trigger. RLS and
-- the audited membership RPCs remain the only authenticated write path.
drop trigger if exists company_admin_portfolio_membership_guard on public.portfolio_memberships;
drop trigger if exists company_admin_branch_assignment_guard on public.branch_assignments;

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
  if p_role not in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    or not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Invitation is not authorized for this resource scope.';
  end if;
  if p_role = 'PORTFOLIO_ADMIN' and (p_company_id is not null
    or not (app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN')
      or app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN'))) then
    raise exception using errcode = '42501', message = 'Only a portfolio administrator may appoint another portfolio administrator.';
  end if;
  if p_role = 'COMPANY_ADMIN' and p_company_id is null then
    raise exception using errcode = '42501', message = 'Company Administrator invitations require an authorized company.';
  end if;
  if p_role = 'OVERALL_HR_MANAGER' and (p_company_id is not null
    or not app_private.has_permission('users.manage', p_portfolio_id, null, null)) then
    raise exception using errcode = '42501', message = 'Overall HR Manager invitations require portfolio-wide administrator authority.';
  end if;
end;
$$;

drop policy if exists portfolio_memberships_read_self_or_manager on public.portfolio_memberships;
create policy portfolio_memberships_read_self_or_manager on public.portfolio_memberships
  for select to authenticated using (
    (user_id = (select auth.uid()) and revoked_at is null)
    or app_private.is_platform_super_admin()
    or app_private.has_permission('users.manage', portfolio_id, null, null)
  );

drop policy if exists branch_assignments_read_self_or_manager on public.branch_assignments;
create policy branch_assignments_read_self_or_manager on public.branch_assignments
  for select to authenticated using (
    user_id = (select auth.uid())
    or app_private.is_platform_super_admin()
    or app_private.has_permission('users.manage', portfolio_id, company_id, null)
  );

-- Protect the last active portfolio-level administrator, including direct
-- owner/service-role changes. A row lock serializes concurrent revocations.
create or replace function app_private.prevent_last_portfolio_administrator_removal()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if old.revoked_at is null and old.role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN')
    and (tg_op = 'DELETE' or new.revoked_at is not null or new.role not in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN')) then
    perform 1 from public.client_portfolios cp where cp.id = old.portfolio_id for update;
    if not exists (
      select 1 from public.portfolio_memberships pm
      where pm.portfolio_id = old.portfolio_id and pm.revoked_at is null
        and pm.role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN')
        and (pm.user_id <> old.user_id or pm.role <> old.role)
    ) then
      raise exception using errcode = '42501', message = 'The last active portfolio administrator cannot be removed.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.prevent_last_portfolio_administrator_removal() from public, anon, authenticated;
drop trigger if exists preserve_last_portfolio_administrator on public.portfolio_memberships;
create trigger preserve_last_portfolio_administrator
  before update or delete on public.portfolio_memberships
  for each row execute function app_private.prevent_last_portfolio_administrator_removal();

-- A company-scoped administrator must not accidentally remove the last active
-- company administrator for that company. Portfolio administrators remain a
-- separate, broader scope and do not silently replace this company assignment.
create or replace function app_private.prevent_last_company_administrator_removal()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if old.revoked_at is null and old.role = 'COMPANY_ADMIN'
    and (tg_op = 'DELETE' or new.revoked_at is not null) then
    perform 1 from public.companies c
      where c.portfolio_id = old.portfolio_id and c.id = old.company_id for update;
    if not exists (
      select 1 from public.company_memberships cm
      where cm.portfolio_id = old.portfolio_id and cm.company_id = old.company_id
        and cm.role = 'COMPANY_ADMIN' and cm.revoked_at is null and cm.user_id <> old.user_id
    ) then
      raise exception using errcode = '42501', message = 'The last active company administrator cannot be removed.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.prevent_last_company_administrator_removal() from public, anon, authenticated;
drop trigger if exists preserve_last_company_administrator on public.company_memberships;
create trigger preserve_last_company_administrator
  before update or delete on public.company_memberships
  for each row execute function app_private.prevent_last_company_administrator_removal();

-- Policy administration is scoped to a company and available to either admin
-- role (and Overall HR) through the same permission resolver.
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
  if not app_private.has_permission('leave.policy.manage', p_portfolio_id, p_company_id, null) then
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
    p_maximum_balance_days, p_effective_from, p_effective_to, auth.uid()) returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'LEAVE_POLICY_SAVED', 'leave', v_id::text,
    jsonb_build_object('leave_type', btrim(p_leave_type), 'effective_from', p_effective_from));
  return v_id;
end;
$$;

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
    or not app_private.has_permission('leave.policy.manage', v_policy.portfolio_id, v_policy.company_id, null) then
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
  if extract(month from p_period_start) = 1 then
    perform public.leave_apply_carry_forward(p_policy_id, extract(year from p_period_start)::integer);
  end if;
  return v_count;
end;
$$;

revoke all on function public.portfolio_membership_directory(uuid) from public, anon;
revoke all on function public.authorize_member_invitation(uuid, text, uuid) from public, anon;
revoke all on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) from public, anon;
revoke all on function public.leave_accrue_month(uuid, date) from public, anon;
grant execute on function public.portfolio_membership_directory(uuid) to authenticated;
grant execute on function public.authorize_member_invitation(uuid, text, uuid) to authenticated;
grant execute on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) to authenticated;
grant execute on function public.leave_accrue_month(uuid, date) to authenticated;

comment on function app_private.has_permission(text, uuid, uuid, uuid) is
  'Shared administrator permissions; portfolio or company/branch data remains limited by active membership, tenant ownership and RLS.';
comment on function app_private.prevent_last_company_administrator_removal() is
  'Preserves at least one active company-scoped administrator for each company.';

-- Branch-scoped administrators may assign only branch roles within one
-- company that they are authorized to manage. Portfolio roles remain portfolio-only.
create or replace function public.assign_portfolio_membership(
  p_portfolio_id uuid, p_user_id uuid, p_role text, p_branch_ids uuid[] default '{}'::uuid[]
)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_branch record;
  v_branch_count integer;
  v_company_count integer;
  v_company_id uuid;
  v_unique_branch_count integer;
begin
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'Users cannot assign or elevate their own access.';
  end if;
  if p_role not in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    raise exception using errcode = '22023', message = 'The requested portfolio role is not supported.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The invited user must complete account provisioning before assignment.';
  end if;
  if p_role = 'PORTFOLIO_ADMIN'
    and not (app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN')
      or app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN')) then
    raise exception using errcode = '42501', message = 'Only an active administrator may appoint another portfolio administrator.';
  end if;

  if p_role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    if coalesce(cardinality(p_branch_ids), 0) = 0 then
      raise exception using errcode = '22023', message = 'Branch-scoped roles require at least one branch assignment.';
    end if;
    select count(distinct b.id), count(distinct b.company_id), (array_agg(distinct b.company_id))[1],
      count(distinct x.branch_id)
    into v_branch_count, v_company_count, v_company_id, v_unique_branch_count
    from unnest(p_branch_ids) as x(branch_id)
    left join public.branches b on b.id = x.branch_id and b.portfolio_id = p_portfolio_id and b.status = 'ACTIVE';
    if v_branch_count <> cardinality(p_branch_ids) or v_unique_branch_count <> cardinality(p_branch_ids)
      or v_company_count <> 1 then
      raise exception using errcode = '22023', message = 'Every selected branch must be distinct, active and in one authorized company.';
    end if;
    if not (app_private.has_permission('users.manage', p_portfolio_id, null, null)
      or app_private.has_permission('users.manage', p_portfolio_id, v_company_id, null)) then
      raise exception using errcode = '42501', message = 'Branch user management is not authorized for this company.';
    end if;
  else
    if coalesce(cardinality(p_branch_ids), 0) <> 0 then
      raise exception using errcode = '22023', message = 'Portfolio-wide roles cannot carry branch assignments.';
    end if;
    if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
      raise exception using errcode = '42501', message = 'Portfolio user management is not authorized.';
    end if;
  end if;

  insert into public.portfolio_memberships(portfolio_id, user_id, role, revoked_at)
  values (p_portfolio_id, p_user_id, p_role, null)
  on conflict (portfolio_id, user_id, role) do update set revoked_at = null;

  if p_role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    for v_branch in
      select b.id, b.company_id from public.branches b
      where b.portfolio_id = p_portfolio_id and b.id = any(p_branch_ids) and b.status = 'ACTIVE'
    loop
      insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role, assigned_by, revoked_at)
      values (p_portfolio_id, v_branch.company_id, v_branch.id, p_user_id, p_role, auth.uid(), null)
      on conflict (portfolio_id, branch_id, user_id, role)
      do update set company_id = excluded.company_id, assigned_by = auth.uid(), assigned_at = now(), revoked_at = null;
    end loop;
  end if;

  insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, auth.uid(), 'PORTFOLIO_MEMBERSHIP_ASSIGNED', 'users', p_user_id::text,
    jsonb_build_object('role', p_role, 'company_id', v_company_id, 'branch_ids', coalesce(to_jsonb(p_branch_ids), '[]'::jsonb)));
end;
$$;

create or replace function public.replace_branch_role_assignments(
  p_portfolio_id uuid, p_company_id uuid, p_user_id uuid, p_role text, p_branch_ids uuid[]
)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_expected integer; v_valid integer; v_branch uuid;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_role not in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    raise exception using errcode = '42501', message = 'A valid target user and branch-scoped role are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  if not exists(select 1 from public.portfolio_memberships pm where pm.portfolio_id = p_portfolio_id
    and pm.user_id = p_user_id and pm.role = p_role and pm.revoked_at is null) then
    raise exception using errcode = '22023', message = 'The account must first have the matching active portfolio role.';
  end if;
  v_expected := coalesce(cardinality(p_branch_ids), 0);
  if v_expected <> (select count(distinct x) from unnest(coalesce(p_branch_ids, '{}'::uuid[])) x) then
    raise exception using errcode = '22023', message = 'Choose distinct branches.';
  end if;
  select count(*) into v_valid from public.branches b where b.portfolio_id = p_portfolio_id
    and b.company_id = p_company_id and b.id = any(coalesce(p_branch_ids, '{}'::uuid[])) and b.status = 'ACTIVE';
  if v_valid <> v_expected then
    raise exception using errcode = '22023', message = 'Every selected active branch must belong to the selected company.';
  end if;

  update public.branch_assignments ba set revoked_at = coalesce(ba.revoked_at, now())
  where ba.portfolio_id = p_portfolio_id and ba.company_id = p_company_id and ba.user_id = p_user_id
    and ba.role = p_role and ba.revoked_at is null and not (ba.branch_id = any(coalesce(p_branch_ids, '{}'::uuid[])));
  foreach v_branch in array coalesce(p_branch_ids, '{}'::uuid[]) loop
    insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role, assigned_by, revoked_at)
    values (p_portfolio_id, p_company_id, v_branch, p_user_id, p_role, auth.uid(), null)
    on conflict (portfolio_id, branch_id, user_id, role)
    do update set company_id = excluded.company_id, assigned_by = auth.uid(), assigned_at = now(), revoked_at = null;
  end loop;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'BRANCH_ROLE_ASSIGNMENTS_REPLACED', 'users', p_user_id::text,
    jsonb_build_object('role', p_role, 'branch_ids', to_jsonb(coalesce(p_branch_ids, '{}'::uuid[]))));
end;
$$;

create or replace function public.company_branch_role_directory(p_portfolio_id uuid, p_company_id uuid)
returns table(
  user_id uuid, email text, display_name text, role text,
  created_at timestamptz, revoked_at timestamptz, branch_ids uuid[]
)
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company branch-role directory is not authorized.';
  end if;
  return query
  select pm.user_id, u.email::text, p.display_name, pm.role, pm.created_at, pm.revoked_at,
    array_agg(ba.branch_id order by ba.branch_id)::uuid[]
  from public.portfolio_memberships pm
  join auth.users u on u.id = pm.user_id
  join public.profiles p on p.id = pm.user_id
  join public.branch_assignments ba on ba.portfolio_id = pm.portfolio_id and ba.company_id = p_company_id
    and ba.user_id = pm.user_id and ba.role = pm.role and ba.revoked_at is null
  where pm.portfolio_id = p_portfolio_id and pm.role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    and pm.revoked_at is null
  group by pm.user_id, u.email, p.display_name, pm.role, pm.created_at, pm.revoked_at
  order by pm.created_at desc, pm.role;
end;
$$;

create or replace function public.revoke_company_branch_role_assignments(
  p_portfolio_id uuid, p_company_id uuid, p_user_id uuid, p_role text, p_reason text
)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_changed integer;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_role not in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different target user, branch role and reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  update public.branch_assignments ba set revoked_at = coalesce(ba.revoked_at, now())
  where ba.portfolio_id = p_portfolio_id and ba.company_id = p_company_id and ba.user_id = p_user_id
    and ba.role = p_role and ba.revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then raise exception using errcode = '22023', message = 'No active branch assignments exist in this company.'; end if;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'BRANCH_ROLE_ASSIGNMENTS_REVOKED', 'users', p_user_id::text,
    jsonb_build_object('role', p_role, 'reason', btrim(p_reason), 'revoked_assignments', v_changed));
end;
$$;

revoke all on function public.assign_portfolio_membership(uuid, uuid, text, uuid[]) from public, anon;
revoke all on function public.replace_branch_role_assignments(uuid, uuid, uuid, text, uuid[]) from public, anon;
revoke all on function public.company_branch_role_directory(uuid, uuid) from public, anon;
revoke all on function public.revoke_company_branch_role_assignments(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.assign_portfolio_membership(uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.replace_branch_role_assignments(uuid, uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.company_branch_role_directory(uuid, uuid) to authenticated;
grant execute on function public.revoke_company_branch_role_assignments(uuid, uuid, uuid, text, text) to authenticated;
