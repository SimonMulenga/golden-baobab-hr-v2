-- Reactivate a company department without deleting or rewriting employee history.
create or replace function public.department_activate(p_department_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_department public.departments%rowtype;
begin
  select * into v_department
  from public.departments
  where id = p_department_id
  for update;

  if not found or auth.uid() is null
      or not app_private.can_manage_company_hr_configuration(v_department.company_id) then
    raise exception using errcode = '42501', message = 'Department activation is unauthorized.';
  end if;

  if v_department.status = 'INACTIVE' then
    update public.departments
    set status = 'ACTIVE', updated_at = now()
    where id = v_department.id;

    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values(v_department.portfolio_id, v_department.company_id, auth.uid(), 'DEPARTMENT_ACTIVATED',
      'hr_configuration', v_department.id::text, jsonb_build_object('name', v_department.name));
  end if;

  return v_department.id;
end;
$$;

revoke all on function public.department_activate(uuid) from public, anon;
grant execute on function public.department_activate(uuid) to authenticated;
comment on function public.department_activate(uuid) is
  'Reactivates an inactive department only for an authorized company HR configuration manager and records an audit event.';
