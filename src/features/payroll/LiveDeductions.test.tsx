import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveDeductions } from './LiveDeductions'

const mocks = vi.hoisted(() => ({ createRequest: vi.fn(), reviewRequest: vi.fn(), listDeductions: vi.fn(), listEmployees: vi.fn(), byEmployeeIds: vi.fn(), installments: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({
  createLiveBusinessServices: () => ({
    deductions: { list: mocks.listDeductions, createRequest: mocks.createRequest, reviewRequest: mocks.reviewRequest, installments: mocks.installments },
    employees: { list: mocks.listEmployees, byIds: mocks.byEmployeeIds },
  }),
}))

const company = { ...mockCompanies[0], portfolioId: 'synthetic-portfolio-id' }
const branch = company.branches[0]
const employee = {
  id: 'synthetic-employee-id', portfolio_id: company.portfolioId, company_id: company.id,
  workplace_branch_id: branch.id, employee_number: 'SYN-001', first_name: 'Demo', middle_name: null,
  last_name: 'Employee', job_title: 'Analyst', department: 'Operations', employment_type: 'FULL_TIME',
  contract_type: 'PERMANENT', contract_start_date: '2026-01-01', contract_end_date: null,
  retirement_age: 65, retirement_status: 'NOT_RETIRED', approval_status: 'APPROVED',
  submitted_at: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z',
}

describe('LIVE deductions screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listDeductions.mockResolvedValue({ items: [], total: 0 })
    mocks.listEmployees.mockResolvedValue({ items: [employee], total: 1 })
    mocks.byEmployeeIds.mockResolvedValue([employee])
    mocks.installments.mockResolvedValue([])
    mocks.createRequest.mockResolvedValue('synthetic-deduction-id')
    mocks.reviewRequest.mockResolvedValue('synthetic-deduction-id')
  })

  function renderScreen() {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveDeductions /></WorkspaceContext.Provider>)
  }

  it('creates the K6,000 medical advance schedule through the trusted live service', async () => {
    renderScreen()
    await screen.findByRole('option', { name: /Demo Employee/ })
    fireEvent.change(screen.getByLabelText('Approved employee'), { target: { value: employee.id } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic six month medical advance' } })
    expect(screen.getByText('Installment 6')).toBeInTheDocument()
    expect(screen.getAllByText('ZMW 1,000.00')).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'Submit for HR approval' }))
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledTimes(1))
    const payload = mocks.createRequest.mock.calls[0][0]
    expect(payload).toMatchObject({ portfolioId: company.portfolioId, companyId: company.id, branchId: branch.id, employeeId: employee.id })
    expect(payload.details).toMatchObject({ deduction_type: 'MEDICAL_ADVANCE', principal_amount: '6000.00', repayment_method: 'EQUAL_INSTALLMENTS', requested_installments: 6 })
    expect(payload.schedule).toEqual([])
    expect(mocks.listDeductions).toHaveBeenCalled()
  })

  it('routes a submitted request review to the trusted backend and displays its installment history', async () => {
    const pending = { id: 'synthetic-deduction-id', portfolio_id: company.portfolioId, company_id: company.id, branch_id: branch.id,
      employee_id: employee.id, deduction_type: 'MEDICAL_ADVANCE', principal_amount: 6000, amount_deducted: 0,
      status: 'SUBMITTED', start_period: '2026-11-01', reason: 'Synthetic test', initiated_by: 'synthetic-user' }
    mocks.listDeductions.mockResolvedValue({ items: [pending], total: 1 })
    mocks.installments.mockResolvedValue([{ id: 'installment-1', deduction_id: pending.id, sequence_number: 1, due_period: '2026-11-01', scheduled_amount: 1000 }])
    renderScreen()
    expect(await screen.findByText('1 installments')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve deduction' }))
    await waitFor(() => expect(mocks.reviewRequest).toHaveBeenCalledWith(pending.id, 'APPROVE', undefined))
  })

  it('does not show false success when live persistence fails', async () => {
    mocks.createRequest.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    await screen.findByRole('option', { name: /Demo Employee/ })
    fireEvent.change(screen.getByLabelText('Approved employee'), { target: { value: employee.id } })
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for HR approval' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The deduction request was not saved')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

