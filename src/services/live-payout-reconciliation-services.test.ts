import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLivePayoutReconciliationServices } from './live-payout-reconciliation-services'

describe('live payout reconciliation service', () => {
  it('uses the scoped batch, paged detail, and audited save RPC contracts', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: { total: 0, page: 1, page_size: 25, items: [] }, error: null })
      .mockResolvedValueOnce({ data: 'synthetic-row-id', error: null })
    const service = createLivePayoutReconciliationServices({ rpc } as unknown as SupabaseClient)
    await service.batches('synthetic-company', 'synthetic-branch')
    await service.detail('synthetic-export', 1, 25)
    await service.save({ exportId: 'synthetic-export', employeeId: 'synthetic-employee', status: 'PAID', paidAmount: 2000, paidAt: '2026-10-29', providerReference: 'SYN-REF', note: null })
    expect(rpc).toHaveBeenNthCalledWith(1, 'payroll_payout_reconciliation_batches', { p_company_id: 'synthetic-company', p_branch_id: 'synthetic-branch' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'payroll_payout_reconciliation_detail', { p_export_id: 'synthetic-export', p_page: 1, p_page_size: 25 })
    expect(rpc).toHaveBeenNthCalledWith(3, 'payroll_payout_reconciliation_save', expect.objectContaining({ p_status: 'PAID', p_paid_amount: 2000, p_provider_reference: 'SYN-REF' }))
  })

  it('surfaces RPC authorization failures', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('permission denied') })
    const service = createLivePayoutReconciliationServices({ rpc } as unknown as SupabaseClient)
    await expect(service.batches('synthetic-company', 'synthetic-branch')).rejects.toThrow('permission denied')
  })
})
