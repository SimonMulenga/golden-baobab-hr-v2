import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../lib/supabase/client', () => ({ getSupabaseClient: () => ({ functions: { invoke: mocks.invoke } }) }))

import { invokeResendDiagnostic, loadEmailManagementStatus } from './email-management-service'

describe('email management authenticated client adapter', () => {
  it('requests read-only status with GET and rejects unauthorized status', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { authorized: false }, error: null })
    await expect(loadEmailManagementStatus()).rejects.toThrow('Email management is unavailable to this account.')
    expect(mocks.invoke).toHaveBeenCalledWith('payslip-email-admin-status', { method: 'GET' })
  })

  it('invokes the fixed diagnostic with an empty body and returns only safe provider acceptance fields', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { accepted: true, result: 'ACCEPTED', diagnosticId: 're_123', statusPersisted: true }, error: null })
    await expect(invokeResendDiagnostic()).resolves.toEqual({ accepted: true, diagnosticId: 're_123', statusPersisted: true })
    expect(mocks.invoke).toHaveBeenCalledWith('payslip-resend-diagnostic', { body: {} })
  })

  it('does not treat transport or function errors as provider rejection', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('private implementation detail') })
    await expect(invokeResendDiagnostic()).rejects.toThrow('The diagnostic result could not be confirmed. Do not retry; refresh the status first.')
  })

  it('does not report acceptance without explicit provider acceptance evidence', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { accepted: false, result: 'FAILED' }, error: null })
    await expect(invokeResendDiagnostic()).rejects.toThrow('The provider did not confirm acceptance. The attempt may be consumed; do not retry.')
  })
})
