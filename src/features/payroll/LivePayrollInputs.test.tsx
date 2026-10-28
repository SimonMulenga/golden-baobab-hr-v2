import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LivePayrollInputs } from './LivePayrollInputs'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ previewInputs: vi.fn(), createDraft: vi.fn(), calculateTrial: vi.fn() }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ payroll: { previewInputs: mocks.previewInputs, createDraft: mocks.createDraft, calculateTrial: mocks.calculateTrial } }) }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

const company = { ...mockCompanies[0], id: 'company-1', portfolioId: 'portfolio-1', name: 'Synthetic Demo Company', branches: [{ ...mockCompanies[0].branches[0], id: 'branch-1', name: 'Lusaka Demo Branch' }] }
const snapshot = { portfolio_id: 'portfolio-1', company_id: 'company-1', branch_id: 'branch-1', period_start: '2026-10-01', period_end: '2026-10-31', attendance_period_id: 'attendance-1', attendance_approved_at: '2026-10-29T10:00:00Z', items: [{ employee_id: 'employee-1', employee_number: 'DEMO-001', employee_name: 'Synthetic Employee', contract_type: 'PERMANENT', employment_type: 'PERMANENT', salary_frequency: 'MONTHLY', compensation_effective_from: '2026-01-01', basic_pay: 6000, housing_allowance: 0, meal_allowance: 0, transport_allowance: 0, other_allowances: 0, overtime_eligible: false, allowance_tax_treatment: {}, attendance: { scheduled_working_days: 22, actual_days_worked: 20, paid_leave_days: 2, unpaid_leave_days: 0, other_payable_absence_days: 0 }, approved_leave_requests: [], due_approved_deductions: [{ deduction_id: 'deduction-1', installment_id: 'installment-1', deduction_type: 'MEDICAL_ADVANCE', reason: 'Synthetic only', scheduled_amount: 1000, due_period: '2026-10-01', outstanding_balance: 6000 }], input_warnings: [] }] }
const trial = { status: 'TRIAL_ONLY', payroll_run_id: 'demo-run-id', payroll_run_version: 1, company_id: 'company-1', branch_id: 'branch-1', period_start: '2026-10-01', period_end: '2026-10-31', attendance_approved_at: '2026-10-29T10:00:00Z', is_authoritative: false, can_submit: false, can_approve: false, can_finalize: false, rules: {}, blockers: ['NAPSA_2026_CONFIGURATION_UNVERIFIED', 'NHIMA_CONTRIBUTION_BASE_UNRESOLVED'], totals: { employee_count: 1, gross_pay_candidate: 6000, paye_candidate: 180, napsa_employee_candidate: 300, napsa_employer_candidate: 300, nhima_employee_candidate: 60, nhima_employer_candidate: 60, approved_other_deductions: 1000, candidate_net_pay: 4460, employer_cost_candidate: 6360 }, items: [{ employee_id: 'employee-1', employee_number: 'DEMO-001', employee_name: 'Synthetic Employee', salary_frequency: 'MONTHLY', calculable: true, blockers: [], basic_pay: 6000, housing_allowance: 0, meal_allowance: 0, transport_allowance: 0, other_allowances: 0, overtime: 0, gross_pay: 6000, paye_taxable_income_candidate: 6000, paye_candidate: 180, napsa_pensionable_base_candidate: 6000, napsa_employee_candidate: 300, napsa_employer_candidate: 300, nhima_employee_base_candidate: 6000, nhima_employer_base_candidate: 6000, nhima_employee_candidate: 60, nhima_employer_candidate: 60, approved_other_deductions: 1000, candidate_net_pay: 4460, employer_cost_candidate: 6360, due_deduction_items: [] }] }

describe('LIVE payroll input preview', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.previewInputs.mockResolvedValue(snapshot); mocks.createDraft.mockResolvedValue('demo-run-id'); mocks.calculateTrial.mockResolvedValue(trial) })

  it('loads approved inputs, creates a persistent draft and displays the non-payable trial snapshot', async () => {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollInputs /></WorkspaceContext.Provider>)
    fireEvent.change(screen.getByLabelText('Payroll month'), { target: { value: '2026-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    expect(await screen.findByText('Synthetic Employee')).toBeInTheDocument()
    expect(screen.getByText('K6,000.00')).toBeInTheDocument()
    expect(screen.getByText('K1,000.00')).toBeInTheDocument()
    expect(screen.getByText(/candidate NAPSA\/NHIMA values are unverified estimates/i)).toBeInTheDocument()
    await waitFor(() => expect(mocks.previewInputs).toHaveBeenCalledWith({ companyId: company.id, branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create draft payroll' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Draft payroll run saved in Supabase')
    expect(screen.getAllByText(/demo-run-id/)).toHaveLength(2)
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({ companyId: company.id, branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31', frequency: 'MONTHLY' }))
    fireEvent.click(screen.getByRole('button', { name: 'Calculate trial payroll' }))
    expect(await screen.findByText('Not approved for payment')).toBeInTheDocument()
    expect(screen.getAllByText('K4,460.00')).toHaveLength(2)
    expect(screen.getByText(/status remains DRAFT/)).toBeInTheDocument()
    expect(mocks.calculateTrial).toHaveBeenCalledWith('demo-run-id', expect.any(String))
  })

  it('does not fabricate results when the database rejects payroll scope', async () => {
    mocks.previewInputs.mockRejectedValue(new Error('RLS denied'))
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollInputs /></WorkspaceContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Inputs could not be loaded')
    expect(screen.queryByText('Synthetic Employee')).not.toBeInTheDocument()
  })

  it('shows a safe error when the trusted trial calculator rejects the request', async () => {
    mocks.calculateTrial.mockRejectedValue(new Error('permission denied'))
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LivePayrollInputs /></WorkspaceContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Load approved inputs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create draft payroll' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Calculate trial payroll' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Trial calculation could not be saved')
    expect(screen.queryByText('Not approved for payment')).not.toBeInTheDocument()
  })
})
