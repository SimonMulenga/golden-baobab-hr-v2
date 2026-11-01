import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261101005300_audited_payroll_report_exports.sql?raw'

describe('audited payroll report export migration', () => {
  it('restricts exports to authenticated authorized viewers and finalized payroll', () => {
    expect(migration).toContain("app_private.has_permission('reports.export'")
    expect(migration).toContain("app_private.has_permission('payroll.view'")
    expect(migration).toContain("v_run.status <> 'FINALIZED'")
    expect(migration).toContain("app_private.has_permission('employee.private.view'")
    expect(migration).toContain("app_private.has_permission('deduction.view'")
    expect(migration).toContain("app_private.has_permission('leave.view'")
    expect(migration).toContain("'MOBILE_MONEY'")
  })

  it('audits metadata only and exposes no anonymous or public execution', () => {
    expect(migration).toContain("then 'REPORT_EXPORTED' else 'REPORT_PREVIEWED' end")
    expect(migration).toContain("'report_type', v_type, 'payroll_version', v_run.version, 'row_count', p_row_count, 'action', v_action")
    expect(migration).toContain('revoke all on function public.report_export_authorize(uuid, text, integer, text) from public, anon')
    expect(migration).toContain('grant execute on function public.report_export_authorize(uuid, text, integer, text) to authenticated')
    expect(migration).not.toMatch(/p_employee|account_number|tax_id|service_role/i)
  })

  it('derives the company and branch scope from the finalized run instead of caller-supplied tenant IDs', () => {
    expect(migration).toContain('select * into v_run from public.payroll_runs where id = p_payroll_run_id for share')
    expect(migration).toContain("app_private.has_permission('payroll.view', v_run.portfolio_id, v_run.company_id, v_run.branch_id)")
    expect(migration).toContain("app_private.has_permission('reports.export', v_run.portfolio_id, v_run.company_id, v_run.branch_id)")
    expect(migration).not.toContain('p_company_id')
    expect(migration).not.toContain('p_branch_id')
  })
})
