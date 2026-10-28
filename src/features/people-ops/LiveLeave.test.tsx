import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveLeave } from './LiveLeave'

const mocks = vi.hoisted(() => ({ requests: vi.fn(), employees: vi.fn(), policies: vi.fn(), balances: vi.fn(), createRequest: vi.fn(), reviewRequest: vi.fn(), savePolicy: vi.fn(), accrueMonth: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({
  employees: { list: mocks.employees }, leave: { requests: mocks.requests, policies: mocks.policies, balances: mocks.balances,
    createRequest: mocks.createRequest, reviewRequest: mocks.reviewRequest, savePolicy: mocks.savePolicy, accrueMonth: mocks.accrueMonth },
}) }))

const company = { ...mockCompanies[0], id: 'synthetic-company', portfolioId: 'synthetic-portfolio', branches: [{ ...mockCompanies[0].branches[0], id: 'synthetic-branch', name: 'Synthetic Branch' }] }
const employee = { id: 'synthetic-employee', portfolio_id: company.portfolioId, company_id: company.id,
  workplace_branch_id: 'synthetic-branch', employee_number: 'SYN-100', first_name: 'Demo', middle_name: null,
  last_name: 'Worker', job_title: 'Clerk', department: 'Finance', employment_type: 'PERMANENT', contract_type: 'MONTHLY',
  contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65, retirement_status: 'NOT_RETIRED',
  approval_status: 'APPROVED', submitted_at: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z' }
const pendingRequest = { id: 'leave-request-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch',
  employee_id: employee.id, leave_type: 'Annual leave', pay_classification: 'PAID', start_date: '2026-11-02', end_date: '2026-11-03',
  leave_days: 2, status: 'PENDING', requested_by: 'branch-manager', reviewed_by: null, reviewed_at: null, reason: 'Synthetic request' }

function renderScreen() {
  render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveLeave /></WorkspaceContext.Provider>)
}

describe('LIVE leave workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requests.mockResolvedValue({ items: [], total: 0 })
    mocks.employees.mockResolvedValue({ items: [employee], total: 1 })
    mocks.policies.mockResolvedValue([]); mocks.balances.mockResolvedValue([])
    mocks.createRequest.mockResolvedValue('leave-request-created'); mocks.reviewRequest.mockResolvedValue('leave-request-1')
    mocks.savePolicy.mockResolvedValue('leave-policy-created'); mocks.accrueMonth.mockResolvedValue(1)
  })

  it('saves a leave request with explicit classification and employee scope', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Request leave' }))
    fireEvent.change(screen.getByLabelText('Leave employee'), { target: { value: employee.id } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-02' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-03' } })
    fireEvent.change(screen.getByLabelText('Leave days'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledTimes(1))
    expect(mocks.createRequest.mock.calls[0][0]).toMatchObject({ portfolioId: company.portfolioId, companyId: company.id,
      branchId: 'synthetic-branch', employeeId: employee.id, leaveType: 'Annual leave', payClassification: 'PAID',
      startDate: '2026-11-02', endDate: '2026-11-03', days: 2 })
    expect(await screen.findByRole('status')).toHaveTextContent('saved to Supabase')
  })

  it('routes approval through the trusted service and refreshes persisted queue data', async () => {
    mocks.requests.mockResolvedValue({ items: [pendingRequest], total: 1 })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve leave for Demo' }))
    await waitFor(() => expect(mocks.reviewRequest).toHaveBeenCalledWith(pendingRequest.id, 'APPROVE', undefined))
    expect(await screen.findByRole('status')).toHaveTextContent('Leave request approved')
  })

  it('keeps configurable accrual and policy values explicit rather than hard-coded as legal rules', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Configure policy' }))
    fireEvent.change(screen.getByLabelText('Accrual days per month'), { target: { value: '1.25' } })
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await waitFor(() => expect(mocks.savePolicy).toHaveBeenCalledWith(expect.objectContaining({
      companyId: company.id, leave_type: 'Annual leave', pay_classification: 'PAID', accrual_days_per_month: 1.25, effective_from: '2026-01-01',
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('not a statement of legal entitlement')
  })
})

