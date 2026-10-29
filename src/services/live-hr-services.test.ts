import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveHrServices } from './live-hr-services'

describe('live HR leave RPC integration', () => {
  it('uses server-calculated requests and the current transition workflow', async () => {
    const rpc = vi.fn(async () => ({ data: 'synthetic-leave-id', error: null }))
    const leave = createLiveHrServices({ rpc } as unknown as SupabaseClient).leave

    await expect(leave.createRequest({
      portfolioId: 'synthetic-portfolio', companyId: 'synthetic-company', branchId: 'synthetic-branch',
      employeeId: 'synthetic-employee', policyId: 'synthetic-policy', startDate: '2026-11-02',
      endDate: '2026-11-03', reason: 'Synthetic request', idempotencyKey: 'synthetic-leave-key',
    })).resolves.toBe('synthetic-leave-id')
    await expect(leave.transition('synthetic-leave-id', 'RETURN', 'Synthetic correction')).resolves.toBe('synthetic-leave-id')
    await expect(leave.transition('synthetic-leave-id', 'SUBMIT')).resolves.toBe('synthetic-leave-id')

    expect(rpc.mock.calls).toEqual([
      ['leave_create_request_calculated', {
        p_portfolio_id: 'synthetic-portfolio', p_company_id: 'synthetic-company', p_branch_id: 'synthetic-branch',
        p_employee_id: 'synthetic-employee', p_leave_policy_id: 'synthetic-policy',
        p_start_date: '2026-11-02', p_end_date: '2026-11-03', p_reason: 'Synthetic request',
        p_idempotency_key: 'synthetic-leave-key',
      }],
      ['leave_request_transition', { p_leave_request_id: 'synthetic-leave-id', p_decision: 'RETURN', p_reason: 'Synthetic correction' }],
      ['leave_request_transition', { p_leave_request_id: 'synthetic-leave-id', p_decision: 'SUBMIT', p_reason: null }],
    ])
  })
})
