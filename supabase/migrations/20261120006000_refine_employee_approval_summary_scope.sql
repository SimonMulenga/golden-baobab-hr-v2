-- Refine approval totals so pending/rejection counts include only records the
-- caller may act on, and Ready for Approval reports approve-eligible records.
-- This forward-only RPC replacement does not modify employee or payroll rows.

create or replace function public.employee_approval_queue_summary(p_company_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_pending integer := 0;
  v_ready integer := 0;
  v_needs integer := 0;
  v_approved integer := 0;
  v_rejected integer := 0;
  v_approval_eligible integer := 0;
  v_rejection_eligible integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to view employee approval totals.';
  end if;

  select count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL'),
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.approve',e.portfolio_id,e.company_id,e.workplace_branch_id)),
         count(*) filter (where e.approval_status='RETURNED_FOR_CORRECTION'),
         count(*) filter (where e.approval_status='APPROVED'),
         count(*) filter (where e.approval_status='REJECTED'),
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.approve',e.portfolio_id,e.company_id,e.workplace_branch_id)),
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.reject',e.portfolio_id,e.company_id,e.workplace_branch_id))
    into v_pending,v_ready,v_needs,v_approved,v_rejected,v_approval_eligible,v_rejection_eligible
  from public.employees e
  where (p_company_id is null or e.company_id=p_company_id)
    and app_private.has_permission('employee.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
    and ((e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and
        (app_private.has_permission('employee.approve',e.portfolio_id,e.company_id,e.workplace_branch_id)
          or app_private.has_permission('employee.reject',e.portfolio_id,e.company_id,e.workplace_branch_id)))
      or (e.approval_status<>'SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.view',e.portfolio_id,e.company_id,e.workplace_branch_id)));

  select v_pending + count(*) filter (where r.review_status in ('PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL')),
         v_ready,
         v_needs + count(*) filter (where r.review_status in ('NEEDS_INFORMATION','DUPLICATE_REVIEW'))
    into v_pending,v_ready,v_needs
  from public.employee_import_staging_records r
  where r.resulting_employee_id is null
    and (p_company_id is null or r.company_id=p_company_id)
    and app_private.has_permission('employee.import',r.portfolio_id,r.company_id,r.branch_id)
    and app_private.has_permission('employee.private.view',r.portfolio_id,r.company_id,r.branch_id);

  return jsonb_build_object('total_pending',v_pending,'ready_for_approval',v_ready,'needs_correction',v_needs,'approved',v_approved,'rejected',v_rejected,'approval_eligible',v_approval_eligible,'rejection_eligible',v_rejection_eligible);
end;
$$;

revoke all on function public.employee_approval_queue_summary(uuid) from public, anon;
grant execute on function public.employee_approval_queue_summary(uuid) to authenticated;
