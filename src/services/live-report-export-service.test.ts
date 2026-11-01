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
})
