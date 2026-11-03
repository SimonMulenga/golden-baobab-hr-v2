-- Allow a portfolio-scoped COMPANY_ADMIN invitation while retaining the
-- existing company-scoped COMPANY_ADMIN assignment path.
-- Scope is selected by p_company_id and checked by effective permissions.
create or replace function public.authorize_member_invitation(
  p_portfolio_id uuid, p_role text, p_company_id uuid default null
)
returns void language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if p_portfolio_id is null or auth.uid() is null then
    raise exception using errcode = '42501', message = 'An authenticated portfolio scope is required.';
  end if;

  if p_company_id is not null and not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.portfolio_id = p_portfolio_id
  ) then
    raise exception using errcode = '42501', message = 'Invitation company is outside the authorized portfolio.';
  end if;

  if p_role not in ('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR')
    or not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Invitation is not authorized for this resource scope.';
  end if;

  if p_role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER') and p_company_id is not null then
    raise exception using errcode = '22023', message = 'This role requires portfolio scope.';
  end if;

  if p_role = 'PORTFOLIO_ADMIN'
    and not app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN') then
    raise exception using errcode = '42501', message = 'Only an authorized portfolio administrator may appoint another portfolio administrator.';
  end if;

  if p_role = 'OVERALL_HR_MANAGER'
    and not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Overall HR Manager invitations require portfolio-wide administrator authority.';
  end if;

  if p_role = 'COMPANY_ADMIN' and p_company_id is null
    and not app_private.has_permission('users.manage', p_portfolio_id, null, null) then
    raise exception using errcode = '42501', message = 'Portfolio Company Administrator invitations require portfolio-wide administrator authority.';
  end if;
end;
$$;

revoke all on function public.authorize_member_invitation(uuid, text, uuid) from public, anon;
grant execute on function public.authorize_member_invitation(uuid, text, uuid) to authenticated;

comment on function public.authorize_member_invitation(uuid, text, uuid) is
  'Authorizes invitations at the explicitly supplied portfolio or company scope. COMPANY_ADMIN with a null company scope is a portfolio-scoped Company Administrator; non-null scope remains company-only.';
