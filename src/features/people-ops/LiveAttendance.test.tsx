import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveAttendance } from './LiveAttendance'

const mocks = vi.hoisted(() => ({ listEmployees: vi.fn(), periods: vi.fn(), entries: vi.fn(), saveEntry: vi.fn(), submitPeriod: vi.fn(), reviewPeriod: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({
  employees: { list: mocks.listEmployees }, attendance: { periods: mocks.periods, entries: mocks.entries,
    saveEntry: mocks.saveEntry, submitPeriod: mocks.submitPeriod, reviewPeriod: mocks.reviewPeriod },
}) }))

const company = { ...mockCompanies[0], id: 'synthetic-company', portfolioId: 'synthetic-portfolio', branches: [{ ...mockCompanies[0].branches[0], id: 'synthetic-branch', name: 'Synthetic Branch' }] }
const employee = { id: 'synthetic-employee', portfolio_id: company.portfolioId, company_id: company.id,
  workplace_branch_id: 'synthetic-branch', employee_number: 'SYN-100', first_name: 'Demo', middle_name: null,
  last_name: 'Worker', job_title: 'Clerk', department: 'Finance', employment_type: 'PERMANENT', contract_type: 'MONTHLY',
  contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65, retirement_status: 'NOT_RETIRED',
  approval_status: 'APPROVED', submitted_at: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z' }

function renderScreen() {
  render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveAttendance /></WorkspaceContext.Provider>)
}

describe('LIVE attendance workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listEmployees.mockResolvedValue({ items: [employee], total: 1 })
    mocks.periods.mockResolvedValue({ items: [], total: 0 })
    mocks.entries.mockResolvedValue([])
    mocks.saveEntry.mockResolvedValue('synthetic-entry')
    mocks.submitPeriod.mockResolvedValue('synthetic-period')
    mocks.reviewPeriod.mockResolvedValue('synthetic-period')
  })

  it('persists an employee monthly summary through the authorized RPC adapter', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }))
    fireEvent.change(screen.getByLabelText('Scheduled working days'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('Actual days worked'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Paid leave days'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(mocks.saveEntry).toHaveBeenCalledTimes(1))
    expect(mocks.saveEntry.mock.calls[0][0]).toMatchObject({ companyId: company.id, branchId: 'synthetic-branch', employeeId: employee.id, scheduledDays: 22, workedDays: 20, paidLeaveDays: 2, contractType: 'MONTHLY' })
    expect(await screen.findByRole('status')).toHaveTextContent('saved to Supabase')
  })

  it('submits a recorded period and lets a separate reviewer approve it', async () => {
    const period = { id: 'period-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch',
      period_start: '2026-10-01', period_end: '2026-10-31', status: 'SUBMITTED', created_by: 'branch-manager', reviewed_by: null, reviewed_at: null, review_reason: null }
    mocks.periods.mockResolvedValue({ items: [period], total: 1 })
    mocks.entries.mockResolvedValue([{ id: 'entry-1', attendance_period_id: period.id, employee_id: employee.id, scheduled_working_days: 22,
      actual_days_worked: 22, paid_leave_days: 0, unpaid_leave_days: 0, other_payable_absence_days: 0, contract_type: 'MONTHLY', correction_note: null }])
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve period' }))
    await waitFor(() => expect(mocks.reviewPeriod).toHaveBeenCalledWith(period.id, 'APPROVE', undefined))
    expect(await screen.findByRole('status')).toHaveTextContent('Attendance period approved')
  })

  it('does not display success when attendance persistence is denied', async () => {
    mocks.saveEntry.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }))
    fireEvent.change(screen.getByLabelText('Scheduled working days'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('Actual days worked'), { target: { value: '22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance was not saved')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

