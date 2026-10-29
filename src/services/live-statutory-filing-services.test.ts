import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveStatutoryFilingServices } from './live-statutory-filing-services'

describe('live statutory filing service', () => {
  it('calls branch-scoped list, finalized-run preparation and audited update RPCs', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { items: [], total: 0, page: 2, page_size: 10 }, error: null })
      .mockResolvedValueOnce({ data: 'synthetic-filing-id', error: null })
      .mockResolvedValueOnce({ data: 'synthetic-filing-id', error: null })
    const service = createLiveStatutoryFilingServices({ rpc } as unknown as SupabaseClient)
    await service.list('synthetic-company', 'synthetic-branch', 2, 10)
    await service.prepare('synthetic-finalized-run', 'NAPSA', '2026-11-10')
    await service.update('synthetic-filing-id', {
      filingStatus: 'SUBMITTED', submittedAt: '2026-11-05T12:00:00.000Z', submissionReference: 'SYN-FILE-1',
      remittanceStatus: 'PARTIAL', remittedAmount: 400, remittedAt: '2026-11-08T12:00:00.000Z',
      remittanceReference: 'SYN-REMIT-1', note: 'Synthetic test evidence',
    })
    expect(rpc).toHaveBeenNthCalledWith(1, 'statutory_filing_list', { p_company_id: 'synthetic-company', p_branch_id: 'synthetic-branch', p_page: 2, p_page_size: 10 })
    expect(rpc).toHaveBeenNthCalledWith(2, 'statutory_filing_prepare', { p_payroll_run_id: 'synthetic-finalized-run', p_authority: 'NAPSA', p_due_date: '2026-11-10' })
    expect(rpc).toHaveBeenNthCalledWith(3, 'statutory_filing_update', expect.objectContaining({ p_filing_status: 'SUBMITTED', p_remittance_status: 'PARTIAL', p_remitted_amount: 400 }))
  })

  it('surfaces authorization failures without fallback data', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('permission denied') })
    await expect(createLiveStatutoryFilingServices({ rpc } as unknown as SupabaseClient).list('company', 'branch')).rejects.toThrow('permission denied')
  })
})
