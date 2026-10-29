-- M14: portfolio membership directory and safe replacement of branch roles.
-- RLS remains default-deny for direct membership writes; these RPCs enforce scope.

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
  if not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio user management is not authorized.';
  end if;
  if not exists(select 1 from public.portfolio_memberships pm where pm.portfolio_id = p_portfolio_id
    and pm.user_id = p_user_id and pm.role = p_role and pm.revoked_at is null) then
    raise exception using errcode = '22023', message = 'The account must first have the matching active portfolio role.';
  end if;
  v_expected := coalesce(cardinality(p_branch_ids), 0);
  if v_expected = 0 or (select count(distinct x) from unnest(p_branch_ids) x) <> v_expected then
    raise exception using errcode = '22023', message = 'Choose one or more distinct branches.';
  end if;
  select count(*) into v_valid from public.branches b where b.portfolio_id = p_portfolio_id
    and b.company_id = p_company_id and b.id = any(p_branch_ids) and b.status = 'ACTIVE';
  if v_valid <> v_expected then
    raise exception using errcode = '22023', message = 'Every selected active branch must belong to the selected company.';
  end if;

  update public.branch_assignments ba set revoked_at = coalesce(ba.revoked_at, now())
  where ba.portfolio_id = p_portfolio_id and ba.company_id = p_company_id and ba.user_id = p_user_id
    and ba.role = p_role and ba.revoked_at is null and not (ba.branch_id = any(p_branch_ids));
  foreach v_branch in array p_branch_ids loop
    insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role, assigned_by, revoked_at)
    values (p_portfolio_id, p_company_id, v_branch, p_user_id, p_role, auth.uid(), null)
    on conflict (portfolio_id, branch_id, user_id, role)
    do update set company_id = excluded.company_id, assigned_by = auth.uid(), assigned_at = now(), revoked_at = null;
  end loop;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'BRANCH_ROLE_ASSIGNMENTS_REPLACED', 'users', p_user_id::text,
    jsonb_build_object('role', p_role, 'branch_ids', to_jsonb(p_branch_ids)));
end;
$$;

create or replace function public.authorize_member_invitation(
  p_portfolio_id uuid, p_role text, p_company_id uuid default null
)
returns void language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if p_role = 'COMPANY_ADMIN' then
    if p_company_id is null or not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
      raise exception using errcode = '42501', message = 'Company-scoped invitation is not authorized.';
    end if;
    return;
  end if;
  if p_role not in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    or not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio invitation is not authorized.';
  end if;
  if p_role = 'PORTFOLIO_ADMIN' and not app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN') then
    raise exception using errcode = '42501', message = 'Only a portfolio administrator can appoint another portfolio administrator.';
  end if;
end;
$$;

revoke all on function public.portfolio_membership_directory(uuid) from public, anon;
revoke all on function public.replace_branch_role_assignments(uuid, uuid, uuid, text, uuid[]) from public, anon;
revoke all on function public.authorize_member_invitation(uuid, text, uuid) from public, anon;
grant execute on function public.portfolio_membership_directory(uuid) to authenticated;
grant execute on function public.replace_branch_role_assignments(uuid, uuid, uuid, text, uuid[]) to authenticated;
grant execute on function public.authorize_member_invitation(uuid, text, uuid) to authenticated;

comment on function public.portfolio_membership_directory(uuid) is 'Returns only the caller-authorized portfolio membership directory; user emails are not exposed to branch users.';
comment on function public.replace_branch_role_assignments(uuid, uuid, uuid, text, uuid[]) is 'Atomically replaces branch assignments for one active branch-scoped portfolio role and audits the change.';
comment on function public.authorize_member_invitation(uuid, text, uuid) is 'Checks scope and anti-escalation rules before the trusted invitation service sends email.';
