-- Overall HR Managers can approve a payroll run they prepared within a
-- portfolio where they hold the active OVERALL_HR_MANAGER role. Other roles
-- remain subject to separation of duties. Permission and scope checks,
-- version matching, row locking and audit writes remain mandatory.
create or replace function public.payroll_review_submission(
  p_payroll_run_id uuid, p_action text, p_expected_version integer, p_reason text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v public.payroll_runs%rowtype;
  v_status text;
  v_event text;
  v_hr_self_approval boolean := false;
begin
  if auth.uid() is null or p_action is null
    or p_action not in ('START_REVIEW', 'APPROVE', 'RETURN', 'REJECT')
    or (p_action in ('RETURN', 'REJECT') and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid payroll action and return or rejection reason are required.';
  end if;

  select * into v from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or p_expected_version is null or v.version <> p_expected_version then
    raise exception using errcode = '42501', message = 'Payroll review is not authorized for this version.';
  end if;

  v_hr_self_approval := v.created_by = auth.uid()
    and p_action = 'APPROVE'
    and app_private.has_portfolio_role(v.portfolio_id, 'OVERALL_HR_MANAGER');

  if v.created_by = auth.uid() and not v_hr_self_approval then
    raise exception using errcode = '42501', message = 'Payroll self-review is not authorized.';
  end if;

  if p_action = 'START_REVIEW' then
    if v.status <> 'SUBMITTED_FOR_APPROVAL'
      or not app_private.has_permission('payroll.review', v.portfolio_id, v.company_id, v.branch_id) then
      raise exception using errcode = '42501', message = 'Payroll review is not authorized.';
    end if;
    v_status := 'UNDER_REVIEW';
    v_event := 'REVIEW_STARTED';
  else
    if v.status not in ('SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW')
      or not app_private.has_permission('payroll.approve', v.portfolio_id, v.company_id, v.branch_id) then
      raise exception using errcode = '42501', message = 'Payroll decision is not authorized.';
    end if;
    v_status := case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED_FOR_CORRECTION' end;
    v_event := case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end;
  end if;

  update public.payroll_runs set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(),
    reviewed_version = v.version, approved_version = case when p_action = 'APPROVE' then v.version else null end,
    updated_at = now() where id = v.id;
  insert into public.payroll_approvals(portfolio_id, company_id, branch_id, payroll_run_id, payroll_version, actor_id, action, reason)
  values (v.portfolio_id, v.company_id, v.branch_id, v.id, v.version, auth.uid(), v_event, nullif(btrim(p_reason), ''));
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'PAYROLL_' || p_action, 'payroll', v.id::text,
    jsonb_build_object(
      'version', v.version,
      'reason', nullif(btrim(p_reason), ''),
      'overall_hr_self_approval', v_hr_self_approval
    ));
  return v.id;
end;
$$;

revoke all on function public.payroll_review_submission(uuid, text, integer, text) from public, anon;
grant execute on function public.payroll_review_submission(uuid, text, integer, text) to authenticated;
