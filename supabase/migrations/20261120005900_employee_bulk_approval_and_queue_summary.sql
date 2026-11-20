-- Add scoped bulk wrappers and a permission-filtered approval summary.
-- All employee status changes still pass through employee_review_submission.

create or replace function public.employee_review_submissions(
  p_employee_ids uuid[],
  p_decision text,
  p_reason text default null,
  p_company_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_id uuid;
  v_ids uuid[];
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_message text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in with an authorized HR account to review employee submissions.';
  end if;
  if p_decision not in ('APPROVE','REJECT') then
    raise exception using errcode = '22023', message = 'Choose approve or reject.';
  end if;
  if p_decision = 'REJECT' and nullif(btrim(p_reason),'') is null then
    raise exception using errcode = '22023', message = 'A reason is required when rejecting employee submissions.';
  end if;
  if p_employee_ids is null then
    select coalesce(array_agg(e.id order by e.submitted_at,e.id),array[]::uuid[]) into v_ids
    from public.employees e
    where e.approval_status='SUBMITTED_FOR_HR_APPROVAL'
      and (p_company_id is null or e.company_id=p_company_id)
      and app_private.has_permission(case when p_decision='APPROVE' then 'employee.approve' else 'employee.reject' end,e.portfolio_id,e.company_id,e.workplace_branch_id);
    if cardinality(v_ids) > 500 then raise exception using errcode = '22023', message = 'This scope has more than 500 pending employees. Select a company or process a smaller selection.'; end if;
  else
    v_ids := p_employee_ids;
    if cardinality(v_ids) < 1 or cardinality(v_ids) > 500 then
      raise exception using errcode = '22023', message = 'Select between 1 and 500 employee submissions.';
    end if;
  end if;
  if exists (select 1 from unnest(v_ids) as ids(id) group by id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'The employee selection contains duplicate records. Refresh the queue and try again.';
  end if;

  foreach v_id in array v_ids loop
    begin
      perform public.employee_review_submission(v_id, p_decision, nullif(btrim(p_reason),''));
      v_results := v_results || jsonb_build_array(jsonb_build_object('employee_id',v_id,'success',true,'status',case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end));
    exception when sqlstate '42501' or sqlstate '40001' or sqlstate '22023' then
      get stacked diagnostics v_message = message_text;
      v_status := case sqlstate when '42501' then 'UNAUTHORIZED_OR_UNAVAILABLE' when '40001' then 'NO_LONGER_PENDING' else 'INVALID' end;
      v_results := v_results || jsonb_build_array(jsonb_build_object('employee_id',v_id,'success',false,'status',v_status,'message',v_message));
    end;
  end loop;
  return v_results;
end;
$$;

revoke all on function public.employee_review_submissions(uuid[],text,text,uuid) from public, anon;
grant execute on function public.employee_review_submissions(uuid[],text,text,uuid) to authenticated;

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
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL'),
         count(*) filter (where e.approval_status='RETURNED_FOR_CORRECTION'),
         count(*) filter (where e.approval_status='APPROVED'),
         count(*) filter (where e.approval_status='REJECTED'),
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.approve',e.portfolio_id,e.company_id,e.workplace_branch_id)),
         count(*) filter (where e.approval_status='SUBMITTED_FOR_HR_APPROVAL' and app_private.has_permission('employee.reject',e.portfolio_id,e.company_id,e.workplace_branch_id))
    into v_pending,v_ready,v_needs,v_approved,v_rejected,v_approval_eligible,v_rejection_eligible
  from public.employees e
  where (p_company_id is null or e.company_id=p_company_id)
    and app_private.has_permission('employee.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
    and (e.approval_status not in ('SUBMITTED_FOR_HR_APPROVAL','RETURNED_FOR_CORRECTION') or
      app_private.has_permission(case when e.approval_status='SUBMITTED_FOR_HR_APPROVAL' then 'employee.approve' else 'employee.view' end,e.portfolio_id,e.company_id,e.workplace_branch_id));

  -- Add candidates that have not yet created a master employee record.
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

comment on function public.employee_review_submissions(uuid[],text,text,uuid) is
  'Bulk approval wrapper; each record is processed by employee_review_submission with its authoritative permissions, checks and audit events.';
comment on function public.employee_approval_queue_summary(uuid) is
  'Returns permission-scoped employee and unsubmitted import candidate counts without exposing employee details.';
