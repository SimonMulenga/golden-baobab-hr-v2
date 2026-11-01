-- M50: permit authorized portfolio HR reviewers to complete their own
-- onboarding submissions, while retaining the database permission/scope check,
-- row locking, one-way status transition, and immutable review/audit history.
-- Also provides audited, soft-deactivation and reactivation workflows for user
-- role assignments; Auth accounts and historical records are never deleted.

create or replace function public.employee_review_submission(
  p_employee_id uuid,
  p_decision text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_required_permission text;
  v_new_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in with an authorized HR account to review this submission.';
  end if;
  if p_decision is null or p_decision not in ('APPROVE', 'REJECT', 'RETURN') then
    raise exception using errcode = '22023', message = 'Choose approve, reject, or return for correction.';
  end if;
  if p_decision in ('REJECT', 'RETURN') and nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'A reason is required when rejecting or returning an employee submission.';
  end if;

  select e.* into v_employee
  from public.employees e
  where e.id = p_employee_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This employee submission is unavailable in your authorized scope.';
  end if;

  v_required_permission := case when p_decision = 'APPROVE' then 'employee.approve' else 'employee.reject' end;
  if not app_private.has_permission(
    v_required_permission,
    v_employee.portfolio_id,
    v_employee.company_id,
    v_employee.workplace_branch_id
  ) then
    raise exception using errcode = '42501', message = 'Your account does not have employee review permission for this company and branch.';
  end if;

  -- HR users may create and submit onboarding records as part of their duties.
  -- Authorization is the explicit employee.approve/reject permission above;
  -- payroll self-approval controls remain separate and unchanged.
  if v_employee.approval_status <> 'SUBMITTED_FOR_HR_APPROVAL' then
    raise exception using errcode = '40001', message = 'This submission has already changed. Refresh the review queue before acting again.';
  end if;

  v_new_status := case p_decision
    when 'APPROVE' then 'APPROVED'
    when 'REJECT' then 'REJECTED'
    else 'RETURNED_FOR_CORRECTION'
  end;

  update public.employees
  set approval_status = v_new_status,
      reviewed_by = auth.uid(),
      reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_employee.id
    and approval_status = 'SUBMITTED_FOR_HR_APPROVAL';
  if not found then
    raise exception using errcode = '40001', message = 'This submission was reviewed by another user. Refresh the queue.';
  end if;

  insert into public.employee_approval_history(
    portfolio_id, company_id, branch_id, employee_id, actor_id, action, reason
  ) values (
    v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id,
    v_employee.id, auth.uid(), v_new_status, nullif(btrim(p_reason), '')
  );

  insert into public.audit_logs(
    portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details
  ) values (
    v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id,
    auth.uid(), 'EMPLOYEE_' || v_new_status, 'employees', v_employee.id::text,
    jsonb_build_object(
      'previous_status', v_employee.approval_status,
      'new_status', v_new_status,
      'reason', nullif(btrim(p_reason), '')
    )
  );
  return v_employee.id;
end;
$$;

revoke all on function public.employee_review_submission(uuid, text, text) from public, anon;
grant execute on function public.employee_review_submission(uuid, text, text) to authenticated;

-- One row per effectively scoped account/role. Branch labels and status are
-- evaluated from stored membership and branch assignments, not inferred by
-- the browser from a role string.
create or replace function public.managed_user_assignment_directory(
  p_portfolio_id uuid,
  p_company_id uuid
)
returns table(
  user_id uuid,
  email text,
  display_name text,
  role text,
  scope_type text,
  company_id uuid,
  scope_label text,
  created_at timestamptz,
  revoked_at timestamptz,
  branch_ids uuid[],
  assignment_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  if p_portfolio_id is null or p_company_id is null
    or not exists (select 1 from public.companies c where c.id = p_company_id and c.portfolio_id = p_portfolio_id)
    or not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'User assignments are not available for this company scope.';
  end if;

  return query
  select pm.user_id, u.email::text, p.display_name, pm.role, 'PORTFOLIO'::text, null::uuid,
    case pm.role when 'PORTFOLIO_ADMIN' then 'Portfolio-wide access'
      when 'OVERALL_HR_MANAGER' then 'All authorized branches'
      else 'Portfolio access' end,
    pm.created_at, pm.revoked_at, '{}'::uuid[],
    case when pm.revoked_at is null then 'ACTIVE' else 'INACTIVE' end
  from public.portfolio_memberships pm
  join auth.users u on u.id = pm.user_id
  join public.profiles p on p.id = pm.user_id
  where pm.portfolio_id = p_portfolio_id
    and pm.role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER')

  union all

  select pm.user_id, u.email::text, p.display_name, pm.role, 'BRANCH'::text, p_company_id,
    coalesce(
      string_agg(
        distinct b.name || case
          when b.status <> 'ACTIVE' then ' (inactive branch)'
          when ba.revoked_at is not null then ' (inactive assignment)'
          else '' end,
        ', ' order by b.name || case
          when b.status <> 'ACTIVE' then ' (inactive branch)'
          when ba.revoked_at is not null then ' (inactive assignment)'
          else '' end
      ),
      'No branch assignments'
    ),
    pm.created_at,
    case when pm.revoked_at is not null then pm.revoked_at
      when count(*) filter (where ba.revoked_at is null and b.status = 'ACTIVE') = 0
        then max(ba.revoked_at) else null end,
    coalesce(array_agg(distinct ba.branch_id order by ba.branch_id)
      filter (where ba.revoked_at is null and b.status = 'ACTIVE'), '{}'::uuid[]),
    case when pm.revoked_at is null and count(*) filter (where ba.revoked_at is null and b.status = 'ACTIVE') > 0
      then 'ACTIVE' else 'INACTIVE' end
  from public.portfolio_memberships pm
  join auth.users u on u.id = pm.user_id
  join public.profiles p on p.id = pm.user_id
  join public.branch_assignments ba on ba.portfolio_id = pm.portfolio_id
    and ba.user_id = pm.user_id and ba.role = pm.role and ba.company_id = p_company_id
  join public.branches b on b.id = ba.branch_id and b.company_id = p_company_id and b.portfolio_id = p_portfolio_id
  where pm.portfolio_id = p_portfolio_id and pm.role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
  group by pm.user_id, u.email, p.display_name, pm.role, pm.created_at, pm.revoked_at;

  return query
  select cm.user_id, u.email::text, p.display_name, cm.role, 'COMPANY'::text, cm.company_id,
    'All company branches'::text, cm.created_at, cm.revoked_at, '{}'::uuid[],
    case when cm.revoked_at is null then 'ACTIVE' else 'INACTIVE' end
  from public.company_memberships cm
  join auth.users u on u.id = cm.user_id
  join public.profiles p on p.id = cm.user_id
  where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id;
end;
$$;

revoke all on function public.managed_user_assignment_directory(uuid, uuid) from public, anon;
grant execute on function public.managed_user_assignment_directory(uuid, uuid) to authenticated;

-- Edit, revoke, and reactivate branch-limited assignments without deleting
-- membership history or touching other companies' branch assignments.
create or replace function public.manage_company_branch_role_assignment(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_current_role text,
  p_action text,
  p_new_role text default null,
  p_branch_ids uuid[] default '{}'::uuid[],
  p_reason text default null,
  p_display_name text default null,
  p_new_company_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_branch_count integer;
  v_expected integer;
  v_before uuid[];
  v_new_role text;
  v_target_company_id uuid := coalesce(p_new_company_id, p_company_id);
  v_membership public.portfolio_memberships%rowtype;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_current_role not in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    or p_action not in ('EDIT', 'REVOKE', 'REACTIVATE', 'REMOVE')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account, supported branch role, action, and audit reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null)
    or not app_private.has_permission('users.manage', p_portfolio_id, v_target_company_id, null) then
    raise exception using errcode = '42501', message = 'You cannot manage users in the source and destination company scopes.';
  end if;

  select pm.* into v_membership from public.portfolio_memberships pm
  where pm.portfolio_id = p_portfolio_id and pm.user_id = p_user_id and pm.role = p_current_role
  for update;
  if not found or not exists (
    select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
      and ba.company_id = p_company_id and ba.user_id = p_user_id and ba.role = p_current_role
  ) then
    raise exception using errcode = '22023', message = 'This branch role assignment no longer exists. Refresh the user list.';
  end if;

  select coalesce(array_agg(ba.branch_id order by ba.branch_id), '{}'::uuid[]) into v_before
  from public.branch_assignments ba
  where ba.portfolio_id = p_portfolio_id and ba.company_id = p_company_id
    and ba.user_id = p_user_id and ba.role = p_current_role and ba.revoked_at is null;

  if p_action in ('REVOKE', 'REMOVE') then
    if nullif(btrim(p_reason), '') is null then
      raise exception using errcode = '22023', message = 'Enter a reason to deactivate this role assignment.';
    end if;
    update public.branch_assignments set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id
      and role = p_current_role and revoked_at is null;
    if not found and cardinality(v_before) = 0 then
      raise exception using errcode = '40001', message = 'This role assignment has already changed. Refresh the user list.';
    end if;
    if not exists (select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
      and ba.user_id = p_user_id and ba.role = p_current_role and ba.revoked_at is null) then
      update public.portfolio_memberships set revoked_at = coalesce(revoked_at, clock_timestamp())
      where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
    end if;
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(),
      case p_action when 'REMOVE' then 'USER_ROLE_ASSIGNMENT_REMOVED' else 'USER_ROLE_ASSIGNMENT_REVOKED' end,
      'users', p_user_id::text,
      jsonb_build_object('role', p_current_role, 'before_branch_ids', to_jsonb(v_before), 'reason', btrim(p_reason)));
    return;
  end if;

  v_new_role := case when p_action = 'REACTIVATE' then p_current_role else coalesce(p_new_role, p_current_role) end;
  if v_new_role not in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    raise exception using errcode = '22023', message = 'Choose a branch-scoped role.';
  end if;
  if p_action = 'REACTIVATE' and v_membership.revoked_at is null and cardinality(v_before) > 0 then
    raise exception using errcode = '22023', message = 'This role assignment is already active.';
  end if;
  if p_action = 'REACTIVATE' and v_target_company_id <> p_company_id then
    raise exception using errcode = '22023', message = 'A revoked assignment must be reactivated in its original company.';
  end if;
  if p_action = 'EDIT' and v_membership.revoked_at is not null then
    raise exception using errcode = '22023', message = 'Reactivate the role assignment before editing it.';
  end if;
  if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Display name must contain 1 to 120 characters.';
  end if;
  v_expected := coalesce(cardinality(p_branch_ids), 0);
  if v_expected = 0 or v_expected <> (select count(distinct x) from unnest(coalesce(p_branch_ids, '{}'::uuid[])) x) then
    raise exception using errcode = '22023', message = 'Select one or more distinct active branches.';
  end if;
  select count(*) into v_branch_count from public.branches b
  where b.portfolio_id = p_portfolio_id and b.company_id = v_target_company_id
    and b.id = any(p_branch_ids) and b.status = 'ACTIVE';
  if v_branch_count <> v_expected then
    raise exception using errcode = '42501', message = 'Every selected branch must be active and belong to the destination company.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The user account is not available for reactivation.';
  end if;

  if v_new_role <> p_current_role or v_target_company_id <> p_company_id then
    update public.branch_assignments set revoked_at = coalesce(revoked_at, clock_timestamp())
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id
      and role = p_current_role and revoked_at is null;
    if not exists (select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
      and ba.user_id = p_user_id and ba.role = p_current_role and ba.revoked_at is null) then
      update public.portfolio_memberships set revoked_at = coalesce(revoked_at, clock_timestamp())
      where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
    end if;
    insert into public.portfolio_memberships(portfolio_id, user_id, role, revoked_at)
    values (p_portfolio_id, p_user_id, v_new_role, null)
    on conflict (portfolio_id, user_id, role) do update set revoked_at = null;
  else
    update public.portfolio_memberships set revoked_at = null
    where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
  end if;

  update public.branch_assignments set revoked_at = clock_timestamp()
  where portfolio_id = p_portfolio_id and company_id = v_target_company_id and user_id = p_user_id
    and role = v_new_role and revoked_at is null and not (branch_id = any(p_branch_ids));
  insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role, assigned_by, revoked_at)
  select p_portfolio_id, v_target_company_id, x.branch_id, p_user_id, v_new_role, auth.uid(), null
  from unnest(p_branch_ids) as x(branch_id)
  on conflict (portfolio_id, branch_id, user_id, role)
  do update set company_id = excluded.company_id, assigned_by = auth.uid(), assigned_at = clock_timestamp(), revoked_at = null;

  if p_display_name is not null then
    update public.profiles set display_name = btrim(p_display_name) where id = p_user_id;
  end if;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(),
    case p_action when 'REACTIVATE' then 'USER_ROLE_ASSIGNMENT_REACTIVATED' else 'USER_ROLE_ASSIGNMENT_EDITED' end,
    'users', p_user_id::text,
    jsonb_build_object('previous_role', p_current_role, 'role', v_new_role,
      'previous_company_id', p_company_id, 'company_id', v_target_company_id,
      'before_branch_ids', to_jsonb(v_before), 'after_branch_ids', to_jsonb(p_branch_ids), 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.manage_company_branch_role_assignment(uuid, uuid, uuid, text, text, text, uuid[], text, text, uuid) from public, anon;
grant execute on function public.manage_company_branch_role_assignment(uuid, uuid, uuid, text, text, text, uuid[], text, text, uuid) to authenticated;

-- Portfolio-wide roles retain scope in the portfolio membership row. The last
-- administrator trigger remains active for revocation or role downgrade.
create or replace function public.manage_portfolio_role_assignment(
  p_portfolio_id uuid,
  p_user_id uuid,
  p_current_role text,
  p_action text,
  p_new_role text default null,
  p_reason text default null,
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_row public.portfolio_memberships%rowtype;
  v_new_role text;
  v_is_admin boolean;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_action not in ('EDIT', 'REVOKE', 'REACTIVATE', 'REMOVE')
    or p_current_role not in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account, supported portfolio role, action, and audit reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio user management is not authorized.';
  end if;
  v_is_admin := app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN')
    or app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN');
  if p_current_role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN') and not v_is_admin then
    raise exception using errcode = '42501', message = 'Only an authorized administrator may manage an administrator assignment.';
  end if;

  select pm.* into v_row from public.portfolio_memberships pm
  where pm.portfolio_id = p_portfolio_id and pm.user_id = p_user_id and pm.role = p_current_role
  for update;
  if not found then raise exception using errcode = '22023', message = 'This role assignment no longer exists.'; end if;

  if p_action in ('REVOKE', 'REMOVE') then
    if v_row.revoked_at is not null then
      raise exception using errcode = '22023', message = 'This role assignment is already inactive.';
    end if;
    update public.portfolio_memberships set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
    update public.branch_assignments set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role and revoked_at is null;
    insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, auth.uid(),
      case p_action when 'REMOVE' then 'USER_ROLE_ASSIGNMENT_REMOVED' else 'USER_ROLE_ASSIGNMENT_REVOKED' end,
      'users', p_user_id::text, jsonb_build_object('role', p_current_role, 'reason', btrim(p_reason)));
    return;
  end if;

  if p_action = 'REACTIVATE' then
    if v_row.revoked_at is null then raise exception using errcode = '22023', message = 'This role assignment is already active.'; end if;
    update public.portfolio_memberships set revoked_at = null
    where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
    insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, auth.uid(), 'USER_ROLE_ASSIGNMENT_REACTIVATED', 'users', p_user_id::text,
      jsonb_build_object('role', p_current_role, 'reason', btrim(p_reason)));
    return;
  end if;

  if v_row.revoked_at is not null then raise exception using errcode = '22023', message = 'Reactivate the assignment before editing it.'; end if;
  v_new_role := coalesce(p_new_role, p_current_role);
  if v_new_role not in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER') then
    raise exception using errcode = '22023', message = 'Choose a portfolio-wide role.';
  end if;
  if v_new_role in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN') and not v_is_admin then
    raise exception using errcode = '42501', message = 'Only an authorized administrator may assign administrator access.';
  end if;
  if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Display name must contain 1 to 120 characters.';
  end if;
  if v_new_role <> p_current_role then
    update public.portfolio_memberships set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_current_role;
    insert into public.portfolio_memberships(portfolio_id, user_id, role, revoked_at)
    values (p_portfolio_id, p_user_id, v_new_role, null)
    on conflict (portfolio_id, user_id, role) do update set revoked_at = null;
  end if;
  if p_display_name is not null then update public.profiles set display_name = btrim(p_display_name) where id = p_user_id; end if;
  insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, auth.uid(), 'USER_ROLE_ASSIGNMENT_EDITED', 'users', p_user_id::text,
    jsonb_build_object('previous_role', p_current_role, 'role', v_new_role, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.manage_portfolio_role_assignment(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.manage_portfolio_role_assignment(uuid, uuid, text, text, text, text, text) to authenticated;

-- Company Administrator assignments are soft-deactivated/reactivated. This
-- function does not and cannot delete or ban the Supabase Auth account.
create or replace function public.manage_company_admin_assignment(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason text default null,
  p_display_name text default null,
  p_new_company_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare v_row public.company_memberships%rowtype;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_action not in ('EDIT', 'REVOKE', 'REACTIVATE', 'REMOVE')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account, supported action, and audit reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null)
    or not app_private.has_permission('users.manage', p_portfolio_id, coalesce(p_new_company_id, p_company_id), null)
    or not exists (select 1 from public.companies c where c.id = coalesce(p_new_company_id, p_company_id) and c.portfolio_id = p_portfolio_id) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized for the source and destination scopes.';
  end if;
  select cm.* into v_row from public.company_memberships cm
  where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
    and cm.user_id = p_user_id and cm.role = 'COMPANY_ADMIN'
  for update;
  if not found then raise exception using errcode = '22023', message = 'This company assignment no longer exists.'; end if;
  if p_action in ('REVOKE', 'REMOVE') then
    if coalesce(p_new_company_id, p_company_id) <> p_company_id then
      raise exception using errcode = '22023', message = 'A company assignment can only be moved while active.';
    end if;
    if v_row.revoked_at is not null then raise exception using errcode = '22023', message = 'This company assignment is already inactive.'; end if;
    update public.company_memberships set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id and role = 'COMPANY_ADMIN';
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(),
      case p_action when 'REMOVE' then 'USER_ROLE_ASSIGNMENT_REMOVED' else 'USER_ROLE_ASSIGNMENT_REVOKED' end,
      'users', p_user_id::text, jsonb_build_object('role', 'COMPANY_ADMIN', 'reason', btrim(p_reason)));
    return;
  elsif p_action = 'REACTIVATE' then
    if coalesce(p_new_company_id, p_company_id) <> p_company_id then
      raise exception using errcode = '22023', message = 'A company assignment must be reactivated in its original company.';
    end if;
    if v_row.revoked_at is null then raise exception using errcode = '22023', message = 'This company assignment is already active.'; end if;
    update public.company_memberships set revoked_at = null
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id and role = 'COMPANY_ADMIN';
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(), 'USER_ROLE_ASSIGNMENT_REACTIVATED', 'users', p_user_id::text,
      jsonb_build_object('role', 'COMPANY_ADMIN', 'reason', btrim(p_reason)));
    return;
  end if;
  if v_row.revoked_at is not null then raise exception using errcode = '22023', message = 'Reactivate the company assignment before editing it.'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Display name must contain 1 to 120 characters.';
  end if;
  perform 1 from public.companies c
    where c.id in (p_company_id, coalesce(p_new_company_id, p_company_id)) and c.portfolio_id = p_portfolio_id
    order by c.id for update;
  if coalesce(p_new_company_id, p_company_id) <> p_company_id then
    update public.company_memberships set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and company_id = p_company_id
      and user_id = p_user_id and role = 'COMPANY_ADMIN';
    insert into public.company_memberships(portfolio_id, company_id, user_id, role, created_by, revoked_at)
    values (p_portfolio_id, p_new_company_id, p_user_id, 'COMPANY_ADMIN', auth.uid(), null)
    on conflict (portfolio_id, company_id, user_id, role)
    do update set created_by = auth.uid(), created_at = clock_timestamp(), revoked_at = null;
  end if;
  update public.profiles set display_name = btrim(p_display_name) where id = p_user_id;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'USER_ROLE_ASSIGNMENT_EDITED', 'users', p_user_id::text,
    jsonb_build_object('role', 'COMPANY_ADMIN', 'previous_company_id', p_company_id,
      'company_id', coalesce(p_new_company_id, p_company_id), 'display_name_changed', true, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.manage_company_admin_assignment(uuid, uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.manage_company_admin_assignment(uuid, uuid, uuid, text, text, text, uuid) to authenticated;

comment on function public.employee_review_submission(uuid, text, text) is
  'Reviews submitted employee onboarding atomically for users with employee.approve/reject in the employee company/branch scope, records reviewer and audit history, and prevents duplicate decisions.';
comment on function public.managed_user_assignment_directory(uuid, uuid) is
  'Returns role assignments and effective company/branch scope only to an authorized users.manage caller.';
comment on function public.manage_company_branch_role_assignment(uuid, uuid, uuid, text, text, text, uuid[], text, text, uuid) is
  'Atomically edits, revokes, or reactivates branch-scoped role assignments within one company; account and history are retained.';
comment on function public.manage_portfolio_role_assignment(uuid, uuid, text, text, text, text, text) is
  'Audited portfolio role lifecycle. Existing last-administrator protection remains enforced by its trigger.';
comment on function public.manage_company_admin_assignment(uuid, uuid, uuid, text, text, text, uuid) is
  'Audited Company Administrator assignment lifecycle; does not delete Auth users or history.';

-- Company-scoped lifecycle for company roles in company_memberships. Sensitive
-- destination roles require the actor to hold the matching underlying
-- capability as well as users.manage; finalization remains independently
-- checked by payroll RPCs and is never granted to the person being reviewed.
create or replace function public.manage_company_role_assignment(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_current_role text,
  p_action text,
  p_new_role text default null,
  p_reason text default null,
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_row public.company_memberships%rowtype;
  v_new_role text;
  v_capability text;
  v_old_display_name text;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid()
    or p_current_role not in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_PREPARER', 'COMPANY_PAYROLL_APPROVER', 'COMPANY_PAYROLL_REVIEWER')
    or p_action not in ('EDIT', 'REVOKE', 'REACTIVATE', 'REMOVE')
    or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account, supported company role, action, and audit reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  select cm.* into v_row from public.company_memberships cm
  where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
    and cm.user_id = p_user_id and cm.role = p_current_role
  for update;
  if not found then raise exception using errcode = '22023', message = 'This company role assignment no longer exists.'; end if;
  select p.display_name into v_old_display_name from public.profiles p where p.id = p_user_id;

  if p_action in ('REVOKE', 'REMOVE') then
    if v_row.revoked_at is not null then raise exception using errcode = '22023', message = 'This company role assignment is already inactive.'; end if;
    update public.company_memberships set revoked_at = clock_timestamp()
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id and role = p_current_role;
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(),
      case p_action when 'REMOVE' then 'USER_ROLE_ASSIGNMENT_REMOVED' else 'USER_ROLE_ASSIGNMENT_REVOKED' end,
      'users', p_user_id::text,
      jsonb_build_object('role', p_current_role, 'before_display_name', v_old_display_name, 'reason', btrim(p_reason)));
    return;
  end if;

  v_new_role := case when p_action = 'REACTIVATE' then p_current_role else coalesce(p_new_role, p_current_role) end;
  if v_new_role not in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_PREPARER', 'COMPANY_PAYROLL_APPROVER', 'COMPANY_PAYROLL_REVIEWER') then
    raise exception using errcode = '22023', message = 'Choose an eligible company role.';
  end if;
  v_capability := case v_new_role
    when 'COMPANY_ADMIN' then 'users.manage'
    when 'COMPANY_PAYROLL_PREPARER' then 'payroll.prepare'
    when 'COMPANY_PAYROLL_APPROVER' then 'payroll.finalize'
    else 'payroll.approve'
  end;
  if not app_private.has_permission(v_capability, p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Your role cannot grant this level of company access.';
  end if;
  if p_action = 'REACTIVATE' then
    if v_row.revoked_at is null then raise exception using errcode = '22023', message = 'This company role assignment is already active.'; end if;
    update public.company_memberships set revoked_at = null
    where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id and role = p_current_role;
  else
    if v_row.revoked_at is not null then raise exception using errcode = '22023', message = 'Reactivate this assignment before editing it.'; end if;
    if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'Display name must contain 1 to 120 characters.';
    end if;
    if v_new_role <> p_current_role then
      update public.company_memberships set revoked_at = clock_timestamp()
      where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id and role = p_current_role;
      insert into public.company_memberships(portfolio_id, company_id, user_id, role, created_by, revoked_at)
      values (p_portfolio_id, p_company_id, p_user_id, v_new_role, auth.uid(), null)
      on conflict (portfolio_id, company_id, user_id, role)
      do update set created_by = auth.uid(), created_at = clock_timestamp(), revoked_at = null;
    end if;
    if p_display_name is not null then update public.profiles set display_name = btrim(p_display_name) where id = p_user_id; end if;
  end if;

  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(),
    case p_action when 'REACTIVATE' then 'USER_ROLE_ASSIGNMENT_REACTIVATED' else 'USER_ROLE_ASSIGNMENT_EDITED' end,
    'users', p_user_id::text,
    jsonb_build_object('previous_role', p_current_role, 'role', v_new_role,
      'before_display_name', v_old_display_name, 'after_display_name', coalesce(btrim(p_display_name), v_old_display_name), 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.manage_company_role_assignment(uuid, uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.manage_company_role_assignment(uuid, uuid, uuid, text, text, text, text, text) to authenticated;

comment on function public.manage_company_role_assignment(uuid, uuid, uuid, text, text, text, text, text) is
  'Audited company role lifecycle; destination role requires both user-management authority and the matching capability.';
