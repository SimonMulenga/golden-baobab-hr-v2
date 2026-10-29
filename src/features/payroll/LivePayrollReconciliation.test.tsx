import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LivePayrollReconciliation } from './LivePayrollReconciliation'

const mocks = vi.hoisted(() => ({ batches: vi.fn(), detail: vi.fn(), save: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-payout-reconciliation-services', () => ({ createLivePayoutReconciliationServices: () => mocks }))

const company = { ...mockCompanies[0], id: 'synthetic-company-reconcile', branches: [{ ...mockCompanies[0].branches[0], id: 'synthetic-branch-reconcile' }] }
const batch = { export_id: 'synthetic-export', payroll_run_id: 'synthetic-run', payroll_version: 2, created_at: '2026-10-29T08:00:00Z', instruction_count: 1, manifest_sha256: 'a'.repeat(64), expected_total: 2000, reconciled_count: 0, paid_count: 0, partial_count: 0, failed_count: 0, returned_count: 0, no_payment_due_count: 0 }
const line = { employee_id: 'synthetic-employee', employee_number: 'SYN-EMP-1', employee_name: 'Synthetic Employee', expected_amount: 2000, status: 'PENDING' as const, paid_amount: 0, paid_at: null, provider_reference: null, note: null, reconciled_at: null }
function renderScreen() { render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollReconciliation /></WorkspaceContext.Provider>) }

describe('LIVE payout reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.batches.mockResolvedValue([batch])
    mocks.detail.mockResolvedValue({ total: 1, page: 1, page_size: 50, items: [line] })
    mocks.save.mockResolvedValue('synthetic-reconciliation-id')
  })

  it('loads a branch-scoped batch and records statement evidence without implying a transfer', async () => {
    renderScreen()
    expect(await screen.findByText('Synthetic Employee')).toBeInTheDocument()
    expect(mocks.batches).toHaveBeenCalledWith(company.id, company.branches[0].id)
    fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }))
    fireEvent.change(screen.getByLabelText('Statement outcome'), { target: { value: 'PAID' } })
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-29' } })
    fireEvent.change(screen.getByLabelText('Provider statement reference'), { target: { value: 'SYN-REF-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reconciliation' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      exportId: batch.export_id, employeeId: line.employee_id, status: 'PAID', paidAmount: 2000,
      providerReference: 'SYN-REF-001',
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('No transfer was initiated')
  })

  it('shows permission failures without synthetic fallback records', async () => {
    mocks.batches.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('Payout batches are unavailable')
    expect(screen.queryByText('Synthetic Employee')).not.toBeInTheDocument()
  })
})
