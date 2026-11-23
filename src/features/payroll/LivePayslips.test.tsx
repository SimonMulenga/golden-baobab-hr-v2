import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { mockCompanies } from '../companies/mockData'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { LivePayslips } from './LivePayslips'

const mocks = vi.hoisted(() => ({ finalizedRuns: vi.fn(), finalizedItems: vi.fn(), statementDetails: vi.fn(), byIds: vi.fn(), existingDocument: vi.fn(), issueDocument: vi.fn(), downloadDocument: vi.fn(), deliveryHistory: vi.fn(), eventHistory: vi.fn(), sendEmail: vi.fn(), distributionPreview: vi.fn(), retryEmail: vi.fn(), revokeAccess: vi.fn() }))
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
    mocks.existingDocument.mockResolvedValue(null)
    mocks.issueDocument.mockResolvedValue({ documentId: 'doc-1' })
    mocks.downloadDocument.mockResolvedValue({ signedUrl: 'https://private.example/signed?token=opaque' })
    mocks.deliveryHistory.mockResolvedValue([])
    mocks.eventHistory.mockResolvedValue([])
    mocks.revokeAccess.mockResolvedValue(undefined)
    mocks.sendEmail.mockResolvedValue({ deliveryId: 'delivery-1', status: 'QUEUED', deliveryConfigured: false, deliveryBlockReason: 'PROVIDER_CONFIGURATION_INCOMPLETE' })
    mocks.distributionPreview.mockResolvedValue({ items: [{ employee_id: employee.id, employee_number: employee.employee_number, first_name: employee.first_name, middle_name: null, last_name: employee.last_name, company_id: company.id, branch_id: 'branch-live', branch_name: 'Lusaka Demo Branch', department: 'Finance', job_title: 'Analyst', recipient_email: 'synthetic@example.test', document_id: 'doc-1', delivery_id: null, delivery_status: 'PENDING', delivery_attempts: 0, total_count: 1 }], total: 1 })
    vi.stubGlobal('print', vi.fn())
    vi.spyOn(window, 'open').mockReturnValue({ location: { replace: vi.fn() }, close: vi.fn(), opener: null } as unknown as Window)
  })

  it('loads the finalized run version and presents immutable persisted amounts', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'October 2026 payslip' }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByText('K19,619.60')).toBeInTheDocument()
    expect(screen.getByText('K12,602.45')).toBeInTheDocument()
    expect(screen.getByText('FINALIZED')).toBeInTheDocument()
    expect(mocks.finalizedItems).toHaveBeenCalledWith(run.id, run.version, 1)
  })

  it('does not remain on the loading state when no company is selected', () => {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: 'all' }}><LivePayslips /></WorkspaceContext.Provider>)
    expect(screen.queryByText('Loading finalized records…')).not.toBeInTheDocument()
    expect(screen.getByText('Select a company')).toBeInTheDocument()
    expect(mocks.finalizedRuns).not.toHaveBeenCalled()
  })

  it('times out an unresolved finalized-record request, offers retry, and recovers on a successful retry', async () => {
    vi.useFakeTimers()
    mocks.finalizedRuns.mockImplementationOnce(() => new Promise(() => undefined))
    const view = renderScreen()
    expect(screen.getByText('Loading finalized records…')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.queryByText('Loading finalized records…')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Finalized records are unavailable')
    vi.useRealTimers()
    mocks.finalizedRuns.mockResolvedValueOnce([run])
    fireEvent.click(screen.getByRole('button', { name: 'Retry finalized records' }))
    expect(await screen.findByRole('heading', { name: 'October 2026 payslip' })).toBeInTheDocument()
    view.unmount()
  })

  it('clears the loading state and exposes retry when employee lookup fails after finalized lines load', async () => {
    mocks.byIds.mockRejectedValueOnce(new Error('Synthetic employee lookup failure'))
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('Finalized records are unavailable')
    expect(screen.queryByText('Loading finalized records…')).not.toBeInTheDocument()
    mocks.byIds.mockResolvedValueOnce([employee])
    fireEvent.click(screen.getByRole('button', { name: 'Retry finalized records' }))
    expect(await screen.findByRole('heading', { name: 'October 2026 payslip' })).toBeInTheDocument()
    expect(mocks.finalizedRuns).toHaveBeenCalledTimes(1)
    expect(mocks.finalizedItems).toHaveBeenCalledTimes(2)
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
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Secured Payslip PDF' }))
    expect(await screen.findByText(/securely stored/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
    expect(screen.queryByText(/Download links expire after 60 seconds/)).not.toBeInTheDocument()
    expect(mocks.issueDocument).toHaveBeenCalledWith(run.id, item.employee_id)
    expect(await screen.findByRole('status')).toHaveTextContent('generated from the finalized payroll snapshot and stored privately')
  })

  it('rediscovers an existing document and obtains a fresh authorized URL for each download and view', async () => {
    mocks.existingDocument.mockResolvedValue('doc-existing')
    mocks.downloadDocument
      .mockResolvedValueOnce({ signedUrl: 'https://private.example/fresh-1' })
      .mockResolvedValueOnce({ signedUrl: 'https://private.example/fresh-2' })
    renderScreen()
    expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate Secured Payslip PDF' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await vi.waitFor(() => expect(mocks.downloadDocument).toHaveBeenNthCalledWith(1, 'doc-existing', 'download'))
    expect(await screen.findByText('Secure download started.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View Payslip' }))
    await vi.waitFor(() => expect(mocks.downloadDocument).toHaveBeenNthCalledWith(2, 'doc-existing', 'inline'))
    const firstTarget = vi.mocked(window.open).mock.results[0]?.value as Window
    const secondTarget = vi.mocked(window.open).mock.results[1]?.value as Window
    expect(firstTarget.location.replace).toHaveBeenCalledWith('https://private.example/fresh-1')
    expect(secondTarget.location.replace).toHaveBeenCalledWith('https://private.example/fresh-2')
  })

  it('does not expose a signed URL and reports authorization revocation on download', async () => {
    mocks.existingDocument.mockResolvedValue('doc-existing')
    mocks.downloadDocument.mockRejectedValueOnce(new Error('not authorized'))
    renderScreen()
    await vi.waitFor(() => expect(mocks.existingDocument).toHaveBeenCalledWith(run.id, item.employee_id))
    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('permissions may have changed')
    expect(screen.queryByRole('link', { name: 'Download PDF' })).not.toBeInTheDocument()
    expect(mocks.issueDocument).not.toHaveBeenCalled()
  })

  it('shows queued email state without claiming that a message was sent', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'October 2026 payslip' })
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Secured Payslip PDF' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Email Payslip' }))
    expect(await screen.findByText(/queued because provider or sender configuration is incomplete; no email was sent/)).toBeInTheDocument()
    expect(mocks.sendEmail).toHaveBeenCalledWith('doc-1')
  })

  it('identifies the first-send approval gate without blaming provider configuration', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ deliveryId: 'delivery-1', status: 'QUEUED', deliveryConfigured: true, deliveryBlockReason: 'FIRST_LIVE_SEND_APPROVAL_REQUIRED' })
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    await screen.findByText('synthetic@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm queue' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('1 queued')
    expect(status).toHaveTextContent('first live payslip send is awaiting owner approval; no email was sent')
    expect(status).not.toHaveTextContent('provider or sender configuration is incomplete')
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

  it('limits distribution selection to the finalized run and reports queued rather than sent', async () => {
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    expect(await screen.findByText('synthetic@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm queue' }))
    expect(await screen.findByRole('status')).toHaveTextContent('0 accepted by the email provider, 1 queued, 0 failed')
    expect(mocks.sendEmail).toHaveBeenCalledWith('doc-1')
    expect(mocks.distributionPreview).toHaveBeenCalledWith(run.id, 1, 100)
  })

  it('does not describe failed delivery attempts as queued or blame sender configuration', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('Synthetic transport failure'))
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    await screen.findByText('synthetic@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm queue' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('0 accepted by the email provider, 0 queued, 1 failed')
    expect(status).toHaveTextContent('1 email delivery request failed; provider acceptance is unconfirmed')
    expect(status).not.toHaveTextContent('Synthetic transport failure')
    expect(status).not.toHaveTextContent('Live email delivery remains disabled until the verified sender is configured.')
  })

  it('reports document issuance failures separately and sanitizes their detail', async () => {
    mocks.distributionPreview.mockResolvedValue({ items: [{ employee_id: employee.id, employee_number: employee.employee_number, first_name: employee.first_name, middle_name: null, last_name: employee.last_name, company_id: company.id, branch_id: 'branch-live', branch_name: 'Lusaka Demo Branch', department: 'Finance', job_title: 'Analyst', recipient_email: 'synthetic@example.test', document_id: null, delivery_id: null, delivery_status: 'PENDING', delivery_attempts: 0, total_count: 1 }], total: 1 })
    mocks.issueDocument.mockRejectedValueOnce(new Error('Sensitive internal detail and employee data'))
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    await screen.findByText('synthetic@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm queue' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('1 document issuance failed')
    expect(status).not.toHaveTextContent('Sensitive internal detail')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('identifies known authorization failures without exposing raw error details', async () => {
    mocks.sendEmail.mockRejectedValueOnce(new Error('Your account does not have payslip issuance access for this company and branch.'))
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    await screen.findByText('synthetic@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm queue' }))
    expect(await screen.findByRole('status')).toHaveTextContent('1 authorization check failed')
  })

  it('counts explicit delivery failures without claiming the provider rejected the message', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ deliveryId: 'delivery-1', status: 'FAILED', deliveryConfigured: true })
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Payslip distribution' }))
    await screen.findByText('synthetic@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SYN-001' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send selected (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm queue' }))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('0 accepted by the email provider, 0 queued, 1 failed')
    expect(status).toHaveTextContent('provider acceptance is unconfirmed')
    expect(status).not.toHaveTextContent('Resend rejected')
  })
})
