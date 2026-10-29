import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { mockCompanies } from '../companies/mockData'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { LivePayrollReports } from './LivePayrollReports'

const mocks = vi.hoisted(() => ({ finalizedRuns: vi.fn(), finalizedItems: vi.fn(), byIds: vi.fn() }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ payslips: mocks, employees: { byIds: mocks.byIds } }) }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

const company = { ...mockCompanies[0], id: 'co-report', branches: [{ ...mockCompanies[0].branches[0], id: 'br-report', name: 'Demo branch' }] }
const run = { id: 'run-report', company_id: company.id, branch_id: 'br-report', payroll_period_id: 'period-1', status: 'FINALIZED' as const, version: 1, finalized_at: '2026-10-31T18:00:00Z', payroll_periods: { period_start: '2026-10-01', period_end: '2026-10-31' } }
const item = { id: 'line-report', payroll_run_id: run.id, employee_id: 'emp-report', version: 1, basic_pay: 10000, housing_allowance: 1000, meal_allowance: 0, transport_allowance: 500, other_allowances: 0, overtime: 0, bonuses_and_other_earnings: 0, attendance_deduction: 0, gross_pay: 11500, statutory_deductions: { PAYE: 2000, NAPSA_EMPLOYEE: 575, NHIMA_EMPLOYEE: 100 }, voluntary_deductions: 0, net_pay: 8825, paye_taxable_income: 11500, napsa_employee: 575, napsa_employer: 575, nhima_employee: 100, nhima_employer: 100, total_employer_cost: 12175, calculation_breakdown: {} }
const employee = { id: 'emp-report', portfolio_id: 'p1', company_id: company.id, workplace_branch_id: 'br-report', employee_number: 'SYN-REPORT-1', first_name: 'Synthetic', middle_name: null, last_name: 'Person', job_title: 'Analyst', department: 'Finance' }

describe('LIVE finalized payroll reports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.finalizedRuns.mockResolvedValue([run]); mocks.finalizedItems.mockResolvedValue({ items: [item], total: 1 }); mocks.byIds.mockResolvedValue([employee])
  })

  it('renders a persisted finalized payroll register and statutory disclosure', async () => {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollReports /></WorkspaceContext.Provider>)
    expect(await screen.findByText('K11,500.00')).toBeInTheDocument()
    expect(screen.getByText('K8,825.00')).toBeInTheDocument()
    expect(screen.getByText(/not filings with ZRA, NAPSA or NHIMA/i)).toBeInTheDocument()
    expect(mocks.finalizedItems).toHaveBeenCalledWith(run.id, run.version, 1)
  })

  it('shows statutory employer and employee contribution columns', async () => {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollReports mode="statutory" /></WorkspaceContext.Provider>)
    expect(await screen.findByRole('heading', { name: 'Statutory summaries' })).toBeInTheDocument()
    expect(screen.getByText('NAPSA EE')).toBeInTheDocument()
    expect(screen.getByText('NAPSA ER')).toBeInTheDocument()
    expect(screen.getByText('NHIMA EE')).toBeInTheDocument()
  })
})
