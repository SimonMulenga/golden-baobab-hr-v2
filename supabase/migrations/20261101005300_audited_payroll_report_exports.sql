-- Report export authorization and audit for immutable finalized payroll snapshots.
-- This RPC does not return report data, create files, or initiate payments.
create or replace function public.report_export_authorize(
  p_payroll_run_id uuid,
  p_report_type text,
  p_row_count integer,
  p_action text default 'EXPORT'
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_type text := upper(btrim(coalesce(p_report_type, '')));
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_line_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to export a report.';
  end if;
  if v_type not in ('PAYROLL_REGISTER', 'BANK_PAYROLL', 'CASH_PAYROLL', 'MOBILE_MONEY', 'LOANS_ADVANCES', 'MASTER', 'PAYE', 'NAPSA', 'NHIMA', 'LEAVE', 'LEAVE_DAYS')
    or v_action not in ('PREVIEW', 'EXPORT') or p_row_count is null or p_row_count < 0 then
    raise exception using errcode = '22023', message = 'Report export details are invalid.';
  end if;

  select * into v_run from public.payroll_runs where id = p_payroll_run_id for share;
  if not found or v_run.status <> 'FINALIZED' or v_run.approved_version is distinct from v_run.version then
    raise exception using errcode = '22023', message = 'Reports can only be exported from finalized payroll.';
  end if;
  select count(*)::integer into v_line_count from public.payroll_run_items
    where payroll_run_id = v_run.id and version = v_run.version;
  if p_row_count > v_line_count then
    raise exception using errcode = '22023', message = 'Report row count does not match the finalized payroll snapshot.';
  end if;
  if not app_private.has_permission('reports.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id)
    or not app_private.has_permission('payroll.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Report export is not authorized for this company and branch.';
  end if;
  if v_action = 'EXPORT' and not app_private.has_permission('reports.export', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Report export is not authorized for this company and branch.';
  end if;
  if v_type in ('BANK_PAYROLL', 'CASH_PAYROLL', 'MOBILE_MONEY', 'PAYE', 'NAPSA', 'NHIMA')
    and not app_private.has_permission('employee.private.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Private employee data is not authorized for this report.';
  end if;
  if v_type = 'LOANS_ADVANCES'
    and not app_private.has_permission('deduction.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Loan and advance data is not authorized for this report.';
  end if;
  if v_type = 'LEAVE_DAYS'
    and not app_private.has_permission('leave.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Leave data is not authorized for this report.';
  end if;

  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (
    v_run.portfolio_id, v_run.company_id, v_run.branch_id, auth.uid(),
    case when v_action = 'EXPORT' then 'REPORT_EXPORTED' else 'REPORT_PREVIEWED' end,
    'REPORTS', v_run.id::text,
    jsonb_build_object('report_type', v_type, 'payroll_version', v_run.version, 'row_count', p_row_count, 'action', v_action)
  );
  return true;
end;
$$;

revoke all on function public.report_export_authorize(uuid, text, integer, text) from public, anon;
grant execute on function public.report_export_authorize(uuid, text, integer, text) to authenticated;
comment on function public.report_export_authorize(uuid, text, integer, text) is
  'Audits permission-checked previews and exports of finalized payroll only; does not generate or transmit payment instructions.';
