import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveBusinessServices } from './live-business-services'

describe('live report export authorization service', () => {
  it('requests server-side authorization and audit before a file is generated', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await createLiveBusinessServices({ rpc } as unknown as SupabaseClient).reports.authorizeAndAuditExport('run-syn-1', 'BANK_PAYROLL', 2)
    expect(rpc).toHaveBeenCalledWith('report_export_authorize', {
      p_payroll_run_id: 'run-syn-1', p_report_type: 'BANK_PAYROLL', p_row_count: 2, p_action: 'EXPORT',
    })
  })

  it('audits a scoped preview separately from an export', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await createLiveBusinessServices({ rpc } as unknown as SupabaseClient).reports.authorizeAndAuditExport('run-syn-1', 'CASH_PAYROLL', 3, 'PREVIEW')
    expect(rpc).toHaveBeenCalledWith('report_export_authorize', {
      p_payroll_run_id: 'run-syn-1', p_report_type: 'CASH_PAYROLL', p_row_count: 3, p_action: 'PREVIEW',
    })
  })

  it('does not allow file generation when authorization or audit confirmation fails', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    await expect(createLiveBusinessServices({ rpc } as unknown as SupabaseClient).reports.authorizeAndAuditExport('run-syn-1', 'BANK_PAYROLL', 2))
      .rejects.toThrow('Report export authorization was not confirmed.')
  })

  it('loads leave ledger rows only for the selected company, branch, employees and period', async () => {
    const row = { employee_id: 'employee-1', branch_id: 'branch-1', event_type: 'ACCRUAL', amount_delta: 2, period_start: '2026-10-01' }
    const query: Record<string, unknown[][]> = {}
    let builder: any
    const chain = (method: string) => vi.fn((...args: unknown[]) => { query[method] ??= []; query[method].push(args); return builder })
    builder = {
      select: chain('select'), eq: chain('eq'), in: chain('in'), lte: chain('lte'), order: chain('order'),
      range: vi.fn(async () => ({ data: [row], error: null })),
    }
    const from = vi.fn(() => builder)
    const service = createLiveBusinessServices({ from } as unknown as SupabaseClient)
    await expect(service.reports.leaveLedger('company-1', 'branch-1', ['employee-1', 'employee-1'], '2026-10-31')).resolves.toEqual([row])
    expect(from).toHaveBeenCalledWith('leave_balance_ledger')
    expect(query.eq).toContainEqual(['company_id', 'company-1'])
    expect(query.eq).toContainEqual(['branch_id', 'branch-1'])
    expect(query.in).toContainEqual(['employee_id', ['employee-1']])
    expect(query.lte).toContainEqual(['period_start', '2026-10-31'])
  })
})
