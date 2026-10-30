import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveAttendance } from './LiveAttendance'

const mocks = vi.hoisted(() => ({ listEmployees: vi.fn(), periods: vi.fn(), entries: vi.fn(), saveEntry: vi.fn(), approvedCorrectionCapability: vi.fn(), requestApprovedCorrection: vi.fn(), submitPeriod: vi.fn(), reviewPeriod: vi.fn() }))
const historyMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({
  employees: { list: mocks.listEmployees }, attendance: { periods: mocks.periods, entries: mocks.entries,
    saveEntry: mocks.saveEntry, approvedCorrectionCapability: mocks.approvedCorrectionCapability,
    requestApprovedCorrection: mocks.requestApprovedCorrection, submitPeriod: mocks.submitPeriod, reviewPeriod: mocks.reviewPeriod },
}) }))
vi.mock('../../services/live-hr-services', () => ({ createLiveHrServices: () => ({ attendance: { history: historyMock } }) }))

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
    mocks.approvedCorrectionCapability.mockResolvedValue(false)
    mocks.requestApprovedCorrection.mockResolvedValue('synthetic-period')
    mocks.submitPeriod.mockResolvedValue('synthetic-period')
    mocks.reviewPeriod.mockResolvedValue('synthetic-period')
    historyMock.mockResolvedValue([])
  })

  it('persists an employee monthly summary through the authorized RPC adapter', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Record entry' }))
    fireEvent.change(screen.getByLabelText('Scheduled working days'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('Actual days worked'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Paid leave days taken'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(mocks.saveEntry).toHaveBeenCalledTimes(1))
    expect(mocks.saveEntry.mock.calls[0][0]).toMatchObject({ companyId: company.id, branchId: 'synthetic-branch', employeeId: employee.id, scheduledDays: 22, workedDays: 20, paidLeaveDays: 2, contractType: 'MONTHLY' })
    expect(await screen.findByRole('status')).toHaveTextContent('Monthly attendance entry saved')
  })

  it('lists branch employees in Update and defaults a new record to 22 scheduled days', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const picker = await screen.findByRole('dialog', { name: 'Update attendance' })
    fireEvent.click(within(picker).getByRole('button', { name: /Demo Worker/ }))
    expect(await screen.findByRole('dialog', { name: 'Monthly attendance entry' })).toBeInTheDocument()
    expect(screen.getByLabelText('Scheduled working days')).toHaveValue(22)
  })

  it('blocks an attendance summary when work and leave exceed scheduled days', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Record entry' }))
    fireEvent.change(screen.getByLabelText('Actual days worked'), { target: { value: '21' } })
    fireEvent.change(screen.getByLabelText('Paid leave days taken'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot exceed scheduled working days/i)
    expect(mocks.saveEntry).not.toHaveBeenCalled()
  })

  it('exposes the attendance table as a named, keyboard-reachable data region', async () => {
    renderScreen()
    const records = await screen.findByRole('region', { name: 'Monthly attendance records' })
    expect(records).toHaveAttribute('tabindex', '0')
    expect(within(records).getByRole('table', { name: 'Employee attendance' })).toBeInTheDocument()
    expect(within(records).getByRole('columnheader', { name: 'Entry status' })).toBeInTheDocument()
    expect(within(records).getByRole('columnheader', { name: 'Action' })).toBeInTheDocument()
    expect(await within(records).findByText('Missing')).toBeInTheDocument()
    expect(within(records).getByRole('button', { name: 'Record entry' })).toBeEnabled()
    expect(screen.getByRole('region', { name: 'Attendance filters' })).toBeInTheDocument()
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
    expect(await screen.findByText('Attendance period approved.')).toHaveAttribute('role', 'status')
  })

  it('clearly locks submitted attendance entries until a reviewer returns the period', async () => {
    const period = { id: 'period-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch',
      period_start: '2026-10-01', period_end: '2026-10-31', status: 'SUBMITTED', created_by: 'branch-manager', reviewed_by: null, reviewed_at: null, review_reason: null }
    mocks.periods.mockResolvedValue({ items: [period], total: 1 })
    mocks.entries.mockResolvedValue([{ id: 'entry-1', attendance_period_id: period.id, employee_id: employee.id, scheduled_working_days: 22,
      actual_days_worked: 22, paid_leave_days: 0, unpaid_leave_days: 0, other_payable_absence_days: 0, contract_type: 'MONTHLY', correction_note: null }])
    renderScreen()
    expect(await screen.findByText(/previous workflow and is locked while under review/i)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Locked' })).toBeDisabled()
  })

  it('explains that approved attendance cannot be silently edited without reapproval', async () => {
    const period = { id: 'period-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch',
      period_start: '2026-10-01', period_end: '2026-10-31', status: 'APPROVED', created_by: 'branch-manager', reviewed_by: 'reviewer', reviewed_at: '2026-10-30T08:00:00Z', review_reason: null }
    mocks.periods.mockResolvedValue({ items: [period], total: 1 })
    mocks.entries.mockResolvedValue([{ id: 'entry-1', attendance_period_id: period.id, employee_id: employee.id, scheduled_working_days: 22,
      actual_days_worked: 22, paid_leave_days: 0, unpaid_leave_days: 0, other_payable_absence_days: 0, contract_type: 'MONTHLY', correction_note: null }])
    renderScreen()
    expect(await screen.findByText(/request an audited correction to reopen it/i)).toHaveAttribute('role', 'status')
    expect(await screen.findByRole('button', { name: 'Correction unavailable' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Locked' })).toBeDisabled()
    expect(mocks.saveEntry).not.toHaveBeenCalled()
  })

  it('opens an approved-period correction with a reason and requires reapproval', async () => {
    const period = { id: 'period-1', portfolio_id: company.portfolioId, company_id: company.id, branch_id: 'synthetic-branch',
      period_start: '2026-10-01', period_end: '2026-10-31', status: 'APPROVED', created_by: 'branch-manager', reviewed_by: 'reviewer', reviewed_at: '2026-10-30T08:00:00Z', review_reason: null }
    mocks.periods.mockResolvedValue({ items: [period], total: 1 })
    mocks.entries.mockResolvedValue([{ id: 'entry-1', attendance_period_id: period.id, employee_id: employee.id, scheduled_working_days: 22,
      actual_days_worked: 22, paid_leave_days: 0, unpaid_leave_days: 0, other_payable_absence_days: 0, contract_type: 'MONTHLY', correction_note: null }])
    mocks.approvedCorrectionCapability.mockResolvedValue(true)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Request correction' }))
    fireEvent.change(screen.getByLabelText('Reason for correction'), { target: { value: 'Correct an approved attendance entry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open correction' }))
    await waitFor(() => expect(mocks.requestApprovedCorrection).toHaveBeenCalledWith(period.id, 'Correct an approved attendance entry'))
    expect(await screen.findByText(/^Correction opened\./)).toBeInTheDocument()
  })

  it('does not display success when attendance persistence is denied', async () => {
    mocks.saveEntry.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Record entry' }))
    fireEvent.change(screen.getByLabelText('Scheduled working days'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('Actual days worked'), { target: { value: '22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance was not saved')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

