import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LivePayrollInputs } from './LivePayrollInputs'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  previewInputs: vi.fn(), list: vi.fn(), byId: vi.fn(), createDraft: vi.fn(), calculate: vi.fn(), listCalculationHistory: vi.fn(),
  submitForApproval: vi.fn(), reviewSubmission: vi.fn(), finalize: vi.fn(), preparePayoutInstructions: vi.fn(), record: null as Record<string, unknown> | null,
  createEarningInput: vi.fn(), createOvertimeInput: vi.fn(), reviewEarningInput: vi.fn(), setUnpaidLeaveMethod: vi.fn(),
}))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ payroll: mocks }) }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

const company = { ...mockCompanies[0], id: 'company-1', portfolioId: 'portfolio-1', name: 'Synthetic Demo Company', branches: [{ ...mockCompanies[0].branches[0], id: 'branch-1', name: 'Lusaka Demo Branch' }] }
const inputs = { portfolio_id: 'portfolio-1', company_id: 'company-1', branch_id: 'branch-1', period_start: '2026-10-01', period_end: '2026-10-31', attendance_period_id: 'attendance-1', attendance_approved_at: '2026-10-29T10:00:00Z', items: [{ employee_id: 'employee-1', employee_number: 'SYN-001', employee_name: 'Synthetic Employee', contract_type: 'PERMANENT', employment_type: 'PERMANENT', salary_frequency: 'MONTHLY', compensation_effective_from: '2026-01-01', basic_pay: 15092, housing_allowance: 3018.4, meal_allowance: 0, transport_allowance: 1509.2, other_allowances: 0, overtime_eligible: false, overtime_monthly_hours_divisor: 208 as const, allowance_tax_treatment: {}, attendance: { scheduled_working_days: 22, actual_days_worked: 20, paid_leave_days: 2, unpaid_leave_days: 0, other_payable_absence_days: 0 }, approved_leave_requests: [], due_approved_deductions: [], input_warnings: [] }] }
const calculation = { status: 'CALCULATED', payroll_run_id: 'run-1', payroll_run_version: 1, company_id: 'company-1', branch_id: 'branch-1', period_start: '2026-10-01', period_end: '2026-10-31', calculation_version: 'POSTGRES_NUMERIC_ZM_2026_V1', calculation_rule_version_id: 'rule-1', statutory_rule_version_ids: ['paye-1','napsa-1','nhima-1'], source_verification_status: 'VERIFIED_BY_OFFICIAL_PUBLICATION_REVIEW', rounding: 'PostgreSQL NUMERIC half away from zero', totals: { employee_count: 1, gross_earnings: 19619.6, paye: 4885.25, napsa_employee: 980.98, napsa_employer: 980.98, nhima_employee: 150.92, nhima_employer: 150.92, net_pay: 13602.45, total_employer_cost: 20751.5 }, items: [{ employee_id: 'employee-1', employee_number: 'SYN-001', employee_name: 'Synthetic Employee', calculation_status: 'CALCULATED', blockers: [], basic_salary: 15092, taxable_allowances: 4527.6, non_taxable_allowances: 0, overtime: 0, bonuses_and_other_earnings: 0, gross_earnings: 19619.6, paye_taxable_income: 19619.6, paye: 4885.25, napsa_employee: 980.98, napsa_employer: 980.98, nhima_employee: 150.92, nhima_employer: 150.92, other_approved_deductions: 0, net_pay: 13602.45, total_employer_cost: 20751.5 }] }
const payout = { export_id: 'export-1', payroll_run_id: 'run-1', payroll_version: 1, status: 'INSTRUCTIONS_PREPARED_NOT_TRANSMITTED', manifest_sha256: 'a'.repeat(64), instructions: [{ employee_id: 'employee-1', employee_number: 'SYN-001', employee_name: 'Synthetic Employee', net_pay: 13602.45, payment_method: 'BANK_TRANSFER', bank_name: 'Synthetic Bank', bank_account_name: 'Synthetic Employee', bank_account_number: '00001234', bank_branch_name: 'Lusaka', mobile_money_provider: null, mobile_money_number: null }] }
const makeRun = (status = 'DRAFT', withCalculation = false) => ({ id: 'run-1', company_id: company.id, branch_id: 'branch-1', payroll_period_id: 'period-1', status, version: 1, created_by: 'creator-1', created_at: '2026-10-29T10:00:00Z', calculations: withCalculation ? calculation : null })

function renderScreen() {
  return render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollInputs /></WorkspaceContext.Provider>)
}
async function loadAndCreate() {
  fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
  await screen.findByText('Synthetic Employee')
  fireEvent.click(screen.getByRole('button', { name: 'Create or open draft payroll' }))
  await screen.findByRole('status')
}

describe('LIVE persistent payroll workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.record = makeRun()
    mocks.previewInputs.mockResolvedValue(inputs)
    mocks.list.mockResolvedValue({ items: [makeRun()], total: 1 })
    mocks.byId.mockImplementation(async () => mocks.record)
    mocks.createDraft.mockResolvedValue('run-1')
    mocks.calculate.mockImplementation(async () => { mocks.record = makeRun('CALCULATED', true); return calculation })
    mocks.listCalculationHistory.mockResolvedValue([{ id: 'history-1', payroll_version: 1, calculation_version: calculation.calculation_version, calculation_rule_version_id: 'rule-1', created_at: '2026-10-29T10:00:00Z' }])
    mocks.submitForApproval.mockImplementation(async () => { mocks.record = makeRun('SUBMITTED_FOR_APPROVAL', true); return 'run-1' })
    mocks.reviewSubmission.mockImplementation(async (_id: string, action: string) => { mocks.record = makeRun(action === 'START_REVIEW' ? 'UNDER_REVIEW' : action === 'APPROVE' ? 'APPROVED' : action === 'RETURN' ? 'RETURNED_FOR_CORRECTION' : 'REJECTED', true); return 'run-1' })
    mocks.finalize.mockImplementation(async () => { mocks.record = makeRun('FINALIZED', true); return 'run-1' })
    mocks.preparePayoutInstructions.mockResolvedValue(payout)
    mocks.createEarningInput.mockResolvedValue('earning-1')
    mocks.createOvertimeInput.mockResolvedValue('overtime-1')
    mocks.reviewEarningInput.mockResolvedValue('earning-1')
    mocks.setUnpaidLeaveMethod.mockResolvedValue('compensation-2')
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('loads authorized inputs, persists a draft, calculates and shows the database breakdown', async () => {
    renderScreen()
    await loadAndCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate payroll' }))
    expect(await screen.findByText('Calculation version 1 is persisted and ready for submission.')).toBeInTheDocument()
    expect(screen.getAllByText('K19,619.60').length).toBeGreaterThan(0)
    expect(screen.getAllByText('K4,885.25').length).toBeGreaterThan(0)
    expect(screen.getAllByText('K13,602.45').length).toBeGreaterThan(0)
    expect(mocks.calculate).toHaveBeenCalledWith('run-1', expect.any(String))
    expect(mocks.listCalculationHistory).toHaveBeenCalledWith('run-1')
  })

  it('drives submit, review, approval, finalization and payout-instruction preparation', async () => {
    renderScreen()
    await loadAndCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate payroll' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve version 1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize approved version' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare payout instructions' }))
    expect(await screen.findByText(/has not been sent to a bank or mobile-money provider/i)).toBeInTheDocument()
    expect(mocks.submitForApproval).toHaveBeenCalledWith('run-1')
    expect(mocks.reviewSubmission).toHaveBeenCalledWith('run-1', 'START_REVIEW', 1, undefined)
    expect(mocks.reviewSubmission).toHaveBeenCalledWith('run-1', 'APPROVE', 1, undefined)
    expect(mocks.finalize).toHaveBeenCalledWith('run-1')
    expect(mocks.preparePayoutInstructions).toHaveBeenCalledWith('run-1')
  })

  it('does not invent a calculation when Supabase denies the request', async () => {
    mocks.calculate.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    await loadAndCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate payroll' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Calculation was blocked or failed')
    expect(screen.queryByText('K13,602.45')).not.toBeInTheDocument()
  })

  it('explains the missing approved attendance prerequisite for the selected period', async () => {
    mocks.previewInputs.mockRejectedValue({ code: '22023', message: 'An approved attendance period matching the payroll dates is required.' })
    renderScreen()
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/create the attendance period for these exact dates/i)
  })

  it('explains a valid empty result without fabricating employees', async () => {
    mocks.previewInputs.mockResolvedValue({ ...inputs, items: [] })
    renderScreen()
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    expect(await screen.findByText(/No payroll inputs are available/i)).toBeInTheDocument()
    expect(screen.queryByText('Synthetic Employee')).not.toBeInTheDocument()
  })

  it('requires explicit reason for returned or rejected payroll', async () => {
    renderScreen()
    await loadAndCreate()
    fireEvent.click(screen.getByRole('button', { name: 'Calculate payroll' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit for approval' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start review' }))
    vi.stubGlobal('prompt', vi.fn(() => 'Please correct the allowance evidence'))
    fireEvent.click(await screen.findByRole('button', { name: 'Return for correction' }))
    expect(mocks.reviewSubmission).toHaveBeenCalledWith('run-1', 'RETURN', 1, 'Please correct the allowance evidence')
  })

  it('submits a period bonus through the persistent approval service', async () => {
    renderScreen()
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    await screen.findByText('Synthetic Employee')
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'employee-1' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'BONUS' } })
    fireEvent.change(screen.getByLabelText('Approved amount (ZMW)'), { target: { value: '500.00' } })
    fireEvent.change(screen.getByLabelText('Source reference'), { target: { value: 'BONUS-APPROVAL-1' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Synthetic bonus' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for HR approval' }))
    expect(mocks.createEarningInput).toHaveBeenCalled()
    expect(await screen.findByText(/submitted for separate HR approval/i)).toBeInTheDocument()
    expect(mocks.createEarningInput).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'employee-1', periodStart: '2026-10-01', periodEnd: '2026-10-31',
      earningType: 'BONUS', amount: 500, taxableForPaye: true, sourceReference: 'BONUS-APPROVAL-1',
    }))
  })

  it('submits overtime hours and rate inputs for trusted server calculation, never a manual amount', async () => {
    const eligibleInputs = { ...inputs, items: [{ ...inputs.items[0], overtime_eligible: true }] }
    mocks.previewInputs.mockResolvedValue(eligibleInputs)
    renderScreen()
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    await screen.findByText('Synthetic Employee')
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'employee-1' } })
    fireEvent.change(screen.getByLabelText('Work date'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('Week starting'), { target: { value: '2026-10-19' } })
    fireEvent.change(screen.getByLabelText('Overtime hours'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Total hours worked this week'), { target: { value: '52' } })
    fireEvent.change(screen.getByLabelText('Source reference'), { target: { value: 'TIMESHEET-APPROVED-1' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Four ordinary overtime hours' } })
    expect(screen.getByText(/Estimate: K435.35/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for HR approval' }))
    expect(mocks.createOvertimeInput).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: 'employee-1', workDate: '2026-10-20', weekStart: '2026-10-19', hours: 4,
      dayType: 'ORDINARY', weeklyHours: 52,
    }))
    expect(mocks.createEarningInput).not.toHaveBeenCalled()
  })

  it('saves an explicit unpaid-leave formula as an effective compensation rule', async () => {
    const withUnpaidLeave = { ...inputs, items: [{ ...inputs.items[0], attendance: { ...inputs.items[0].attendance, unpaid_leave_days: 1 } }] }
    mocks.previewInputs.mockResolvedValue(withUnpaidLeave)
    renderScreen()
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    await screen.findByText('Synthetic Employee')
    fireEvent.change(screen.getByLabelText('Unpaid leave rule for SYN-001'), { target: { value: 'BASIC_PER_SCHEDULED_WORKDAY' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))
    expect(mocks.setUnpaidLeaveMethod).toHaveBeenCalled()
    expect(await screen.findByText(/saved as a new effective compensation version/i)).toBeInTheDocument()
    expect(mocks.setUnpaidLeaveMethod).toHaveBeenCalledWith('employee-1', '2026-10-01', 'BASIC_PER_SCHEDULED_WORKDAY')
  })
})
