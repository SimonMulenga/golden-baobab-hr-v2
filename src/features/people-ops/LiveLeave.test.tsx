import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveLeave } from './LiveLeave'

const mocks = vi.hoisted(() => ({ requests: vi.fn(), employees: vi.fn(), periods: vi.fn(), entries: vi.fn(), policies: vi.fn(), balances: vi.fn(), calendar: vi.fn(), history: vi.fn(), createRequest: vi.fn(), transition: vi.fn(), savePolicy: vi.fn(), accrueMonth: vi.fn(), saveCalendarException: vi.fn(), removeCalendarException: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ employees: { list: mocks.employees }, attendance: { periods: mocks.periods, entries: mocks.entries } }) }))
vi.mock('../../services/live-hr-services', () => ({ createLiveHrServices: () => ({ leave: { requests: mocks.requests, policies: mocks.policies, balances: mocks.balances, calendar: mocks.calendar, history: mocks.history, createRequest: mocks.createRequest, transition: mocks.transition, savePolicy: mocks.savePolicy, accrueMonth: mocks.accrueMonth, saveCalendarException: mocks.saveCalendarException, removeCalendarException: mocks.removeCalendarException } }) }))

const company = { ...mockCompanies[0], id: 'synthetic-company', portfolioId: 'synthetic-portfolio', branches: [{ ...mockCompanies[0].branches[0], id: 'synthetic-branch', name: 'Synthetic Branch' }] }
const employee = { id: 'synthetic-employee', portfolio_id: company.portfolioId, company_id: company.id, workplace_branch_id: 'synthetic-branch', employee_number: 'SYN-100', first_name: 'Demo', middle_name: null, last_name: 'Worker', job_title: 'Clerk', department: 'Finance', employment_type: 'PERMANENT', contract_type: 'MONTHLY', contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65, retirement_status: 'NOT_RETIRED', approval_status: 'APPROVED', submitted_at: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z' }
const policy = { id: 'policy-1', portfolio_id: company.portfolioId, company_id: company.id, leave_type: 'Annual leave', pay_classification: 'PAID' as const, accrual_days_per_month: 1.25, maximum_balance_days: 30, effective_from: '2026-01-01', effective_to: null, enabled: true, day_count_method: 'WORKING_DAYS' as const, carry_forward_limit_days: 10 }
const pendingRequest = { id: 'leave-request-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch', employee_id: employee.id, leave_policy_id: policy.id, leave_type: 'Annual leave', pay_classification: 'PAID' as const, start_date: '2026-11-02', end_date: '2026-11-03', leave_days: 2, status: 'PENDING' as const, requested_by: 'synthetic-actor', reviewed_by: null, reviewed_at: null, reason: 'Synthetic request', review_reason: null }
function renderScreen() { render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveLeave /></WorkspaceContext.Provider>) }

describe('LIVE leave workflow', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'prompt').mockReturnValue('Synthetic test reason'); mocks.requests.mockResolvedValue({ items: [], total: 0 }); mocks.employees.mockResolvedValue({ items: [employee], total: 1 }); mocks.periods.mockResolvedValue({ items: [], total: 0 }); mocks.entries.mockResolvedValue([]); mocks.policies.mockResolvedValue([policy]); mocks.balances.mockResolvedValue([]); mocks.calendar.mockResolvedValue([]); mocks.history.mockResolvedValue([]); mocks.createRequest.mockResolvedValue('created'); mocks.transition.mockResolvedValue('updated'); mocks.savePolicy.mockResolvedValue('saved'); mocks.accrueMonth.mockResolvedValue(1); mocks.saveCalendarException.mockResolvedValue('saved'); mocks.removeCalendarException.mockResolvedValue('removed') })

  it('uses server-calculated policy-scoped dates for a leave request', async () => {
    renderScreen()
    fireEvent.change(await screen.findByLabelText('Leave branch'), { target: { value: 'synthetic-branch' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Record leave' }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-02' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save leave' }))
    await waitFor(() => expect(mocks.createRequest).toHaveBeenCalledWith(expect.objectContaining({ companyId: company.id, branchId: 'synthetic-branch', employeeId: employee.id, policyId: policy.id, startDate: '2026-11-02', endDate: '2026-11-03' })))
  })

  it('does not expose a separate approval action for legacy leave records', async () => {
    mocks.requests.mockResolvedValue({ items: [pendingRequest], total: 1 })
    renderScreen()
    await screen.findByText('PENDING')
    expect(screen.queryByRole('button', { name: 'Approve leave request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject leave request' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Return leave request' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()
  })

  it('reports attendance-entered paid and unpaid leave without exposing employee details', async () => {
    mocks.periods.mockResolvedValue({ items: [{ id: 'period-1', branch_id: 'synthetic-branch', status: 'DRAFT' }], total: 1 })
    mocks.entries.mockResolvedValue([{ paid_leave_days: 2, unpaid_leave_days: 1 }])
    renderScreen()
    expect(await screen.findByRole('table', { name: 'Attendance leave summary' })).toHaveTextContent('Synthetic Branch')
    expect(screen.getByRole('table', { name: 'Attendance leave summary' })).toHaveTextContent('2')
    expect(screen.getByRole('table', { name: 'Attendance leave summary' })).toHaveTextContent('1')
    expect(screen.getByRole('table', { name: 'Attendance leave summary' })).not.toHaveTextContent('Demo Worker')
  })

  it('loads the persisted review history for a selected request', async () => {
    mocks.requests.mockResolvedValue({ items: [pendingRequest], total: 1 })
    mocks.history.mockResolvedValue([{ id: 1, leave_request_id: pendingRequest.id, actor_id: 'synthetic-reviewer', action: 'SUBMITTED', previous_status: null, new_status: 'PENDING', reason: null, occurred_at: '2026-10-29T10:00:00Z' }])
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(await screen.findByRole('region', { name: 'Leave record history' })).toHaveTextContent('SUBMITTED')
    expect(mocks.history).toHaveBeenCalledWith(pendingRequest.id)
  })

  it('configures day counting and carry-forward policy fields', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Configure policy' }))
    fireEvent.change(screen.getByLabelText('Days per request'), { target: { value: 'CALENDAR_DAYS' } })
    fireEvent.change(screen.getByLabelText('Carry-forward limit'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await waitFor(() => expect(mocks.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ companyId: company.id, dayCountMethod: 'CALENDAR_DAYS', carryForwardLimit: 8 })))
  })
})
