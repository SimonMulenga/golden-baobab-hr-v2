-- Tenant-scoped lifecycle movement report; no employee private details are returned.
create or replace function public.employee_lifecycle_movement_report(
  p_page integer default 1,
  p_page_size integer default 50,
  p_company_id uuid default null,
  p_branch_id uuid default null,
  p_department_id uuid default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table(
  request_id uuid,
  employee_id uuid,
  employee_number text,
  employee_name text,
  company_id uuid,
  branch_id uuid,
  department text,
  action text,
  effective_date date,
  status text,
  requested_by uuid,
  reviewed_by uuid,
  created_at timestamptz,
  reviewed_at timestamptz,
  reason text,
  final_settlement_status text,
  total_count bigint
)
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is null or p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100
    or (p_date_from is not null and p_date_to is not null and p_date_to < p_date_from) then
    raise exception using errcode='22023',message='Choose a valid lifecycle report page and date range.';
  end if;
  return query
  with scoped as (
    select r.id,r.employee_id,e.employee_number,concat_ws(' ',e.first_name,nullif(e.middle_name,''),e.last_name) as employee_name,
      r.company_id,r.branch_id,e.department,r.action,r.effective_date,r.status,r.requested_by,r.reviewed_by,
      r.created_at,r.reviewed_at,r.reason,r.final_settlement_status
    from public.employee_lifecycle_requests r join public.employees e on e.id=r.employee_id
    where app_private.has_permission('employee.view',r.portfolio_id,r.company_id,r.branch_id)
      and (app_private.has_permission('employee.status.manage',r.portfolio_id,r.company_id,r.branch_id)
        or app_private.has_permission('employee.approve',r.portfolio_id,r.company_id,r.branch_id)
        or app_private.has_permission('employee.reject',r.portfolio_id,r.company_id,r.branch_id))
      and (p_company_id is null or r.company_id=p_company_id)
      and (p_branch_id is null or r.branch_id=p_branch_id)
      and (p_department_id is null or e.department_id=p_department_id)
      and (p_date_from is null or r.effective_date>=p_date_from)
      and (p_date_to is null or r.effective_date<=p_date_to)
  )
  select s.id,s.employee_id,s.employee_number,s.employee_name,s.company_id,s.branch_id,s.department,
    s.action,s.effective_date,s.status,s.requested_by,s.reviewed_by,s.created_at,s.reviewed_at,s.reason,
    s.final_settlement_status,count(*) over()
  from scoped s order by s.effective_date desc,s.created_at desc,s.employee_number
  offset (p_page-1)*p_page_size limit p_page_size;
end;
$$;
revoke all on function public.employee_lifecycle_movement_report(integer,integer,uuid,uuid,uuid,date,date) from public,anon;
grant execute on function public.employee_lifecycle_movement_report(integer,integer,uuid,uuid,uuid,date,date) to authenticated;
comment on function public.employee_lifecycle_movement_report(integer,integer,uuid,uuid,uuid,date,date) is
  'Returns lifecycle movement metadata only for employees visible to the caller and within the caller’s authorized tenant scope.';
