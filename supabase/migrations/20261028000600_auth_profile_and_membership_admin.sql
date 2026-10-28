-- M6: create profiles with Auth users and expose audited, scoped membership
-- administration. Browser clients cannot write membership tables directly.

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function app_private.handle_new_auth_user();

insert into public.profiles(id)
select u.id from auth.users u
on conflict (id) do nothing;

create or replace function public.assign_portfolio_membership(
  p_portfolio_id uuid,
  p_user_id uuid,
  p_role text,
  p_branch_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_branch record;
  v_branch_count integer;
begin
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'Users cannot assign or elevate their own access.';
  end if;
  if p_role not in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    raise exception using errcode = '22023', message = 'The requested portfolio role is not supported.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio user management is not authorized.';
  end if;
  if app_private.has_portfolio_role(p_portfolio_id, 'OVERALL_HR_MANAGER')
     and not app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN')
     and p_role = 'PORTFOLIO_ADMIN' then
    raise exception using errcode = '42501', message = 'Overall HR cannot appoint a portfolio administrator.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The invited user must complete account provisioning before assignment.';
  end if;

  if p_role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    if coalesce(cardinality(p_branch_ids), 0) = 0 then
      raise exception using errcode = '22023', message = 'Branch-scoped roles require at least one branch assignment.';
    end if;
    select count(distinct b.id) into v_branch_count
    from public.branches b
    where b.portfolio_id = p_portfolio_id and b.id = any(p_branch_ids);
    if v_branch_count <> cardinality(p_branch_ids) then
      raise exception using errcode = '22023', message = 'Every assigned branch must belong to the selected portfolio.';
    end if;
  elsif coalesce(cardinality(p_branch_ids), 0) <> 0 then
    raise exception using errcode = '22023', message = 'Portfolio-wide roles cannot carry branch assignments.';
  end if;

  insert into public.portfolio_memberships(portfolio_id, user_id, role, revoked_at)
  values (p_portfolio_id, p_user_id, p_role, null)
  on conflict (portfolio_id, user_id, role) do update set revoked_at = null;

  if p_role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR') then
    for v_branch in
      select b.id, b.company_id from public.branches b
      where b.portfolio_id = p_portfolio_id and b.id = any(p_branch_ids)
    loop
      insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role, assigned_by, revoked_at)
      values (p_portfolio_id, v_branch.company_id, v_branch.id, p_user_id, p_role, auth.uid(), null)
      on conflict (portfolio_id, branch_id, user_id, role)
      do update set assigned_by = auth.uid(), assigned_at = now(), revoked_at = null;
    end loop;
  end if;

  insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, auth.uid(), 'PORTFOLIO_MEMBERSHIP_ASSIGNED', 'users', p_user_id::text,
    jsonb_build_object('role', p_role, 'branch_ids', coalesce(to_jsonb(p_branch_ids), '[]'::jsonb)));
end;
$$;

create or replace function public.revoke_portfolio_membership(
  p_portfolio_id uuid,
  p_user_id uuid,
  p_role text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare v_changed integer;
begin
  if p_user_id is null or p_user_id = auth.uid() or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different target user and a reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio user management is not authorized.';
  end if;
  update public.portfolio_memberships
  set revoked_at = coalesce(revoked_at, now())
  where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_role and revoked_at is null;
  get diagnostics v_changed = row_count;
  update public.branch_assignments
  set revoked_at = coalesce(revoked_at, now())
  where portfolio_id = p_portfolio_id and user_id = p_user_id and role = p_role and revoked_at is null;
  if v_changed > 0 then
    insert into public.audit_logs(portfolio_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, auth.uid(), 'PORTFOLIO_MEMBERSHIP_REVOKED', 'users', p_user_id::text,
      jsonb_build_object('role', p_role, 'reason', btrim(p_reason)));
  end if;
end;
$$;

revoke all on function public.assign_portfolio_membership(uuid, uuid, text, uuid[]) from public, anon;
revoke all on function public.revoke_portfolio_membership(uuid, uuid, text, text) from public, anon;
grant execute on function public.assign_portfolio_membership(uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.revoke_portfolio_membership(uuid, uuid, text, text) to authenticated;
