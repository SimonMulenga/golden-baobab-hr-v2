import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { mockCompanies } from '../companies/mockData'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { LivePayslips } from './LivePayslips'

const mocks = vi.hoisted(() => ({ finalizedRuns: vi.fn(), finalizedItems: vi.fn(), statementDetails: vi.fn(), byIds: vi.fn(), issueDocument: vi.fn(), deliveryHistory: vi.fn(), sendEmail: vi.fn() }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ payslips: mocks, employees: { byIds: mocks.byIds } }) }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

const company = { ...mockCompanies[0], id: 'co-live', branches: [{ ...mockCompanies[0].branches[0], id: 'branch-live', name: 'Lusaka Demo Branch' }] }
const run = { id: 'run-final', company_id: company.id, branch_id: 'branch-live', payroll_period_id: 'period-1', status: 'FINALIZED' as const, version: 2, finalized_at: '2026-10-31T18:00:00Z', payroll_periods: { period_start: '2026-10-01', period_end: '2026-10-31' } }
const item = { id: 'line-1', payroll_run_id: run.id, employee_id: 'emp-1', version: 2, basic_pay: 15092, housing_allowance: 3018.4, meal_allowance: 0, transport_allowance: 1509.2, other_allowances: 0, overtime: 0, bonuses_and_other_earnings: 0, attendance_deduction: 0, gross_pay: 19619.6, statutory_deductions: { PAYE: 4885.25, NAPSA_EMPLOYEE: 980.98, NHIMA_EMPLOYEE: 150.92 }, voluntary_deductions: 1000, net_pay: 12602.45, paye_taxable_income: 19619.6, napsa_employee: 980.98, napsa_employer: 980.98, nhima_employee: 150.92, nhima_employer: 150.92, total_employer_cost: 20751.5, calculation_breakdown: { due_deduction_items: [{ deduction_type: 'MEDICAL_ADVANCE', scheduled_amount: 1000, reason: 'Synthetic advance' }] } }
const employee = { id: 'emp-1', portfolio_id: 'p1', company_id: company.id, workplace_branch_id: 'branch-live', employee_number: 'SYN-001', first_name: 'Demo', middle_name: null, last_name: 'Employee', job_title: 'Analyst', department: 'Finance' }

function renderScreen() {
  return render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayslips /></WorkspaceContext.Provider>)
}

describe('LIVE finalized payslips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizedRuns.mockResolvedValue([run])
    mocks.finalizedItems.mockResolvedValue({ items: [item], total: 1 })
    mocks.statementDetails.mockResolvedValue({ leave: { monthly_entitlement_days: 2, balance_days: 3, policies: [{ leave_type: 'ANNUAL_LEAVE', monthly_entitlement_days: 2, balance_days: 3 }] }, deductions: [{ description: '100025 Advance recovery', deduction_type: 'SALARY_ADVANCE', total_amount: 3000, amount_recovered: 2000, balance: 1000 }] })
    mocks.byIds.mockResolvedValue([employee])
    mocks.issueDocument.mockResolvedValue({ documentId: 'doc-1', signedUrl: 'https://private.example/signed?token=opaque' })
    mocks.deliveryHistory.mockResolvedValue([])
    mocks.sendEmail.mockResolvedValue({ deliveryId: 'delivery-1', status: 'QUEUED', deliveryConfigured: false })
    vi.stubGlobal('print', vi.fn())
  })

  it('loads the finalized run version and presents immutable persisted amounts', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'October 2026 payslip' }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByText('K19,619.60')).toBeInTheDocument()
    expect(screen.getByText('K12,602.45')).toBeInTheDocument()
    expect(screen.getByText('FINALIZED')).toBeInTheDocument()
    expect(mocks.finalizedItems).toHaveBeenCalledWith(run.id, run.version, 1)
  })

  it('keeps a separate local print view without implying secure storage or delivery', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Print / save as PDF' }))
    expect(window.print).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent('local copy')
  })

  it('issues a private server PDF from the selected finalized run item', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'October 2026 payslip' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate secure PDF' }))
    expect(await screen.findByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', 'https://private.example/signed?token=opaque')
    expect(mocks.issueDocument).toHaveBeenCalledWith(run.id, item.employee_id)
    expect(await screen.findByText(/Generated from the finalized payroll snapshot/)).toBeInTheDocument()
  })

  it('shows queued email state without claiming that a message was sent', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'October 2026 payslip' })
    fireEvent.click(screen.getByRole('button', { name: 'Generate secure PDF' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Queue email' }))
    expect(await screen.findByText(/not emailed\. It is queued until the email provider and verified sender address are configured/)).toBeInTheDocument()
    expect(mocks.sendEmail).toHaveBeenCalledWith('doc-1')
  })

  it('renders the period-end leave balance and advance repayment balance on the payslip', async () => {
    renderScreen()
    expect(await screen.findByText('Annual Leave')).toBeInTheDocument()
    expect(screen.getByText('2.00 days')).toBeInTheDocument()
    expect(screen.getByText('3.00 days')).toBeInTheDocument()
    expect(screen.getByText('100025 Advance recovery')).toBeInTheDocument()
    expect(screen.getByText('K3,000.00')).toBeInTheDocument()
    expect(screen.getByText('K2,000.00')).toBeInTheDocument()
    expect(screen.getAllByText('K1,000.00')).toHaveLength(2)
  })
})
