import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'

const serviceMocks = vi.hoisted(() => ({ list: vi.fn(), byId: vi.fn(), history: vi.fn(), employmentHistory: vi.fn(), lifecycleCapabilities: vi.fn(), lifecycleRequests: vi.fn(), createLifecycleRequest: vi.fn(), reviewLifecycleRequest: vi.fn(), lifecycleSummary: vi.fn(), reviewSubmission: vi.fn(), reviewSubmissions: vi.fn(), approvalQueueSummary: vi.fn(), changeCapabilities: vi.fn(), requestApprovedChange: vi.fn(), pendingChangeRequests: vi.fn(), reviewChangeRequest: vi.fn(), createDraft: vi.fn(), correctionDetails: vi.fn(), updateDraft: vi.fn(), submitForHrApproval: vi.fn() }))
const workspaceMocks = vi.hoisted(() => ({ companies: [] as unknown[], activeCompanyId: 'company-synthetic', setActiveCompany: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({
  createLiveBusinessServices: () => ({ employees: serviceMocks }),
}))
vi.mock('../../services/live-hr-services', () => ({ createLiveHrServices: () => ({ catalog: {
  departments: vi.fn().mockResolvedValue([{ id: 'department-1', name: 'Finance', status: 'ACTIVE' }]),
  jobRoles: vi.fn().mockResolvedValue([{ id: 'job-role-1', department_id: 'department-1', title: 'Analyst', status: 'ACTIVE' }]),
} }) }))
vi.mock('./employee-import-staging-service', () => ({ createEmployeeImportStagingService: () => ({ listPendingReviewRecords: vi.fn().mockResolvedValue([]) }) }))
vi.mock('../companies/WorkspaceContext', () => ({
  useWorkspace: () => ({ companies: workspaceMocks.companies, activeCompanyId: workspaceMocks.activeCompanyId, setActiveCompany: workspaceMocks.setActiveCompany, preferences: {} }),
  useCompanySelection: () => ({ companyId: workspaceMocks.activeCompanyId, company: (workspaceMocks.companies as { id: string }[]).find((item) => item.id === workspaceMocks.activeCompanyId), setCompanyId: vi.fn() }),
  formatWorkspaceDate: (value: string | number | Date) => new Date(value).toLocaleDateString('en-GB'),
  formatWorkspaceDateTime: (value: string | number | Date) => new Date(value).toLocaleString('en-GB'),
}))

import { LiveEmployeeApprovals, LiveEmployeeDirectory, LiveEmployeeForm, LiveEmployeeProfile } from './LiveEmployeeScreens'

const employee = {
  id: 'employee-synthetic-1', portfolio_id: 'portfolio-synthetic', company_id: 'company-synthetic',
  workplace_branch_id: 'branch-synthetic', employee_number: 'SYN-1001', first_name: 'Demo',
  middle_name: null, last_name: 'Employee', date_of_birth: '1990-01-01', nationality: 'Zambian',
  job_title: 'Analyst', department: 'Finance', employment_type: 'FULL_TIME', contract_type: 'PERMANENT',
  contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65,
  employment_status: 'ACTIVE' as const,
  retirement_status: 'NOT_RETIRED' as const, approval_status: 'SUBMITTED_FOR_HR_APPROVAL' as const,
  submitted_at: '2026-10-28T08:00:00Z', reviewed_at: null, created_at: '2026-10-28T07:00:00Z',
}

function renderRoute(element: React.ReactNode) {
  return render(<MemoryRouter><Routes><Route path="*" element={<>{element}</>} /></Routes></MemoryRouter>)
}

function renderCorrectionRoute() {
  return render(<MemoryRouter initialEntries={['/employees/employee-synthetic-1/correct']}><Routes><Route path="/employees/:employeeId/correct" element={<LiveEmployeeForm />} /></Routes></MemoryRouter>)
}

function renderProfileRoute() {
  return render(<MemoryRouter initialEntries={['/employees/employee-synthetic-1']}><Routes><Route path="/employees/:employeeId" element={<LiveEmployeeProfile />} /></Routes></MemoryRouter>)
}

describe('LIVE employee screens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceMocks.companies = [{ id: 'company-synthetic', portfolioId: 'portfolio-synthetic', name: 'Synthetic Company', status: 'Active', branches: [{ id: 'branch-synthetic', name: 'Demo Branch', status: 'Active' }] }]
    serviceMocks.list.mockResolvedValue({ items: [employee], total: 1 })
    serviceMocks.byId.mockResolvedValue(employee)
    serviceMocks.history.mockResolvedValue([{ id: 1, action: 'SUBMITTED', reason: null, occurred_at: '2026-10-28T07:00:00Z', actor_id: 'synthetic-actor-1' }])
    serviceMocks.employmentHistory.mockResolvedValue([])
    serviceMocks.lifecycleCapabilities.mockResolvedValue({ can_request: false, can_approve: false, can_reject: false, status: 'ACTIVE', contract_expired: false, contract_end_date: null, current_user_id: 'reviewer-synthetic' })
    serviceMocks.lifecycleRequests.mockResolvedValue([])
    serviceMocks.createLifecycleRequest.mockResolvedValue('lifecycle-synthetic-1')
    serviceMocks.reviewLifecycleRequest.mockResolvedValue(undefined)
    serviceMocks.lifecycleSummary.mockResolvedValue({ active: 0, suspended: 0, separated: 0, terminated: 0, contract_expired: 0, upcoming_expiry: 0, final_settlement_review: 0 })
    serviceMocks.reviewSubmission.mockResolvedValue('employee-synthetic-1')
    serviceMocks.reviewSubmissions.mockResolvedValue([])
    serviceMocks.approvalQueueSummary.mockResolvedValue({ total_pending: 1, ready_for_approval: 1, needs_correction: 0, approved: 0, rejected: 0, approval_eligible: 1, rejection_eligible: 1 })
    serviceMocks.changeCapabilities.mockResolvedValue({ can_request_employee: false, can_request_compensation: false, can_review: false, has_pending_request: false })
    serviceMocks.requestApprovedChange.mockResolvedValue('change-synthetic-1')
    serviceMocks.pendingChangeRequests.mockResolvedValue([])
    serviceMocks.reviewChangeRequest.mockResolvedValue('change-synthetic-1')
    serviceMocks.createDraft.mockResolvedValue('employee-created-synthetic')
    serviceMocks.updateDraft.mockResolvedValue('employee-synthetic-1')
    serviceMocks.submitForHrApproval.mockResolvedValue('employee-created-synthetic')
    serviceMocks.correctionDetails.mockResolvedValue({
      employee: { employee_number: 'SYN-1001', first_name: 'Demo', middle_name: null, last_name: 'Employee', date_of_birth: '1990-01-01', gender: null, nationality: 'Zambian', job_title: 'Analyst', department: 'Finance', employment_type: 'PERMANENT', contract_type: 'PERMANENT', contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65 },
      private_details: { identity_document_type: 'NRC', identity_document_number: 'SYN-NRC-1001', residential_address: 'Synthetic address', phone: '+260000000000', email: 'demo@example.invalid', email_unavailable_reason: null, emergency_contact_name: 'Demo Contact', emergency_contact_relationship: 'Colleague', emergency_contact_phone: '+260000000001', tpin: null, napsa_number: null, nhima_number: null, payment_method: 'BANK_TRANSFER', bank_name: 'Synthetic Bank', bank_account_name: 'Demo Employee', bank_account_number: 'SYN-ACCT-1001', bank_branch_name: null, mobile_money_provider: null, mobile_money_number: null },
      compensation: { effective_from: '2026-01-01', effective_to: null, salary_frequency: 'MONTHLY', basic_pay: 6000, housing_allowance: 0, meal_allowance: 0, transport_allowance: 0, other_allowances: 0, overtime_eligible: false, payment_method: 'BANK_TRANSFER' },
      company_id: 'company-synthetic', branch_id: 'branch-synthetic', portfolio_id: 'portfolio-synthetic', approval_status: 'RETURNED_FOR_CORRECTION',
    })
  })

  it('loads only the authorized employee directory page from the live service', async () => {
    renderRoute(<LiveEmployeeDirectory />)
    expect(await screen.findByText('Demo Employee')).toBeInTheDocument()
    expect(screen.getByText('SYN-1001')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bulk Upload Employees' })).toHaveAttribute('href', '/employees/import')
    expect(serviceMocks.list).toHaveBeenCalledWith({ page: 1, pageSize: 25, search: '' })
  })

  it('submits effective-dated lifecycle changes for independent review, not immediate status mutation', async () => {
    serviceMocks.byId.mockResolvedValue({ ...employee, approval_status: 'APPROVED' })
    serviceMocks.lifecycleCapabilities.mockResolvedValue({ can_request: true, can_approve: false, can_reject: false, status: 'ACTIVE', contract_expired: false, contract_end_date: null, current_user_id: 'requester-synthetic' })
    renderProfileRoute()
    expect(await screen.findByRole('heading', { name: 'Status, contracts and history' })).toBeInTheDocument()
    await screen.findByLabelText('Lifecycle action')
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic policy review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(serviceMocks.createLifecycleRequest).toHaveBeenCalledWith(employee.id, expect.objectContaining({ action: 'SUSPENSION', reason: 'Synthetic policy review', pay_classification: 'UNPAID' })))
  })

  it('shows approved-record employment and compensation actions only when existing capabilities allow them', async () => {
    serviceMocks.byId.mockResolvedValue({ ...employee, approval_status: 'APPROVED' })
    serviceMocks.changeCapabilities.mockResolvedValue({ can_request_employee: true, can_request_compensation: true, can_review: false, has_pending_request: false })
    renderProfileRoute()
    expect(await screen.findByRole('heading', { name: 'Edit employee or request a salary change' })).toBeInTheDocument()
    expect(screen.getByLabelText('First name')).toBeInTheDocument()
    expect(screen.getByLabelText('Gender')).toBeInTheDocument()
    expect(screen.getByLabelText('New job title')).toBeInTheDocument()
    expect(screen.getByLabelText('Basic pay (ZMW)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Updated' } })
    fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'FEMALE' } })
    fireEvent.change(screen.getByLabelText('Residential address'), { target: { value: 'Synthetic updated address' } })
    fireEvent.change(screen.getByLabelText('New job title'), { target: { value: 'Senior Analyst' } })
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Synthetic promotion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for independent review' }))
    await waitFor(() => expect(serviceMocks.requestApprovedChange).toHaveBeenCalledWith(employee.id, {
      first_name: 'Updated', gender: 'FEMALE', private_details: { residential_address: 'Synthetic updated address' }, job_title: 'Senior Analyst',
    }, {}, 'Synthetic promotion'))
    expect(await screen.findByText(/has not been changed yet/)).toBeInTheDocument()
  })

  it('does not render approved-record edit controls when database capabilities deny access', async () => {
    serviceMocks.byId.mockResolvedValue({ ...employee, approval_status: 'APPROVED' })
    renderProfileRoute()
    await screen.findByRole('heading', { name: 'Status, contracts and history' })
    expect(screen.queryByRole('heading', { name: 'Edit employee or request a salary change' })).not.toBeInTheDocument()
    expect(serviceMocks.requestApprovedChange).not.toHaveBeenCalled()
  })

  it('submits salary changes with an effective date and explicit allowance proration choice', async () => {
    serviceMocks.byId.mockResolvedValue({ ...employee, approval_status: 'APPROVED' })
    serviceMocks.changeCapabilities.mockResolvedValue({ can_request_employee: true, can_request_compensation: true, can_review: false, has_pending_request: false })
    renderProfileRoute()
    expect(await screen.findByText('Request salary change')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText('Basic pay (ZMW)'), { target: { value: '7200' } })
    fireEvent.change(screen.getByLabelText('Transport allowance (ZMW)'), { target: { value: '600' } })
    fireEvent.click(screen.getByLabelText('Prorate transport allowance by scheduled days'))
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'Synthetic annual review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for independent review' }))
    await waitFor(() => expect(serviceMocks.requestApprovedChange).toHaveBeenCalledWith(employee.id, {}, {
      effective_from: '2026-11-01', basic_pay: 7200, transport_allowance: 600,
      allowance_proration_rules: { transport_allowance: 'SCHEDULED_DAYS' },
    }, 'Synthetic annual review'))
  })

  it('requests the submitted review queue and invokes the trusted approval action', async () => {
    serviceMocks.list.mockResolvedValueOnce({ items: [employee], total: 1 }).mockResolvedValue({ items: [], total: 0 })
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(serviceMocks.reviewSubmission).toHaveBeenCalledWith('employee-synthetic-1', 'APPROVE', undefined))
    await waitFor(() => expect(serviceMocks.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: '', approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Demo Employee: approve action saved.')
    expect(screen.queryByText('Demo Employee')).not.toBeInTheDocument()
  })

  it('confirms approve-selected and sends only the selected employee to the scoped bulk RPC', async () => {
    serviceMocks.reviewSubmissions.mockResolvedValue([{ employee_id: employee.id, success: true, status: 'APPROVED' }])
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    await screen.findByText('Demo Employee')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Demo Employee' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('only to 1 selected employee submission')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve' }))
    await waitFor(() => expect(serviceMocks.reviewSubmissions).toHaveBeenCalledWith([employee.id], 'APPROVE', undefined, 'company-synthetic'))
    expect(await screen.findByRole('status')).toHaveTextContent('1 employee approved')
  })

  it('requires a rejection reason before the bulk rejection RPC can run', async () => {
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    await screen.findByText('Demo Employee')
    fireEvent.click(screen.getByRole('button', { name: /Reject All/ }))
    const confirm = screen.getByRole('button', { name: 'Confirm Reject' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Duplicate record' } })
    expect(confirm).toBeEnabled()
    expect(serviceMocks.reviewSubmissions).not.toHaveBeenCalled()
  })

  it('requires a reason for return and shows backend rejection without a success state', async () => {
    serviceMocks.reviewSubmission.mockRejectedValue(new Error('permission denied'))
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    fireEvent.submit(screen.getByRole('dialog'))
    expect(await screen.findByText('Enter a short review reason before returning or rejecting this record.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Please verify contract dates' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The review could not be saved.')
    expect(screen.queryByText(/updated successfully/)).not.toBeInTheDocument()
  })

  it('shows a specific authorization error returned by the trusted review RPC', async () => {
    serviceMocks.reviewSubmission.mockRejectedValue({ code: '42501', message: 'internal detail is not displayed' })
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const notification = await screen.findByRole('alert')
    expect(notification).toHaveClass('employee-review-toast', 'is-error')
    expect(notification).toHaveTextContent('Your account does not have employee review permission for this company and branch.')
    expect(screen.queryByText(/internal detail/)).not.toBeInTheDocument()
    fireEvent.click(within(notification).getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lets the reviewer refresh the approval queue from the error notification', async () => {
    serviceMocks.reviewSubmission.mockRejectedValueOnce({ code: '40001' })
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    const notification = await screen.findByRole('alert')
    expect(notification).toHaveTextContent('Another reviewer changed this submission.')
    fireEvent.click(within(notification).getByRole('button', { name: 'Refresh queue' }))
    await waitFor(() => expect(serviceMocks.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('explains a concurrent employee review and allows refreshing the queue', async () => {
    serviceMocks.reviewSubmission.mockRejectedValue({ code: '40001' })
    renderRoute(<LiveEmployeeApprovals roles={['OVERALL_HR_MANAGER']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Another reviewer changed this submission.')
  })

  it('offers the supported gender values and keeps optional job title editable text', () => {
    renderRoute(<LiveEmployeeForm />)
    const gender = screen.getByLabelText('Gender')
    expect(within(gender).getAllByRole('option').map((option) => option.textContent)).toEqual(['Select if applicable', 'Male', 'Female', 'Non-binary', 'Undisclosed'])
    const jobTitle = screen.getByLabelText('Job title')
    expect(jobTitle.tagName).toBe('INPUT')
    expect(jobTitle).toHaveAttribute('type', 'text')
  })

  it('creates an incomplete but valid company and branch bound employee draft and submits it to HR', async () => {
    renderRoute(<LiveEmployeeForm />)
    await screen.findByRole('option', { name: 'Finance' })
    fireEvent.change(screen.getByLabelText('Company *'), { target: { value: 'company-synthetic' } })
    fireEvent.change(screen.getByLabelText('Workplace branch *'), { target: { value: 'branch-synthetic' } })
    const values: Record<string, string> = {
      'First name *': 'Synthetic', 'Last name *': 'Person','Department *': 'Finance','Basic pay (ZMW) *': '6000',
    }
    for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByLabelText('Prorate housing allowance by scheduled days'))
    fireEvent.submit(screen.getByRole('button', { name: 'Save and submit for review' }).closest('form')!)
    await waitFor(() => expect(serviceMocks.createDraft).toHaveBeenCalledTimes(1))
    const input = serviceMocks.createDraft.mock.calls[0][0]
    expect(input.companyId).toBe('company-synthetic')
    expect(input.branchId).toBe('branch-synthetic')
    expect(input.employee.employee_number).toBe('')
    expect(input.employee.date_of_birth).toBe('')
    expect(input.privateDetails.email).toBe('')
    expect(input.privateDetails.payment_method).toBeNull()
    expect(input.privateDetails.bank_account_number).toBe('')
    expect(input.compensation.basic_pay).toBe(6000)
    expect(input.compensation.allowance_proration_rules).toEqual({ housing_allowance: 'SCHEDULED_DAYS' })
    expect(serviceMocks.submitForHrApproval).toHaveBeenCalledWith('employee-created-synthetic')
    expect(await screen.findByRole('status')).toHaveTextContent('submitted for HR approval')
  })

  it('loads creator-authorized correction details, saves edits and resubmits through trusted RPCs', async () => {
    renderCorrectionRoute()
    expect(await screen.findByRole('heading', { name: 'Correct employee record' })).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Finance' })
    expect(screen.getByLabelText('Account number')).toHaveValue('SYN-ACCT-1001')
    fireEvent.change(screen.getByLabelText('Basic pay (ZMW) *'), { target: { value: '6500' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save corrections and resubmit' }).closest('form')!)
    await waitFor(() => expect(serviceMocks.updateDraft).toHaveBeenCalledTimes(1))
    const input = serviceMocks.updateDraft.mock.calls[0][1]
    expect(serviceMocks.updateDraft).toHaveBeenCalledWith('employee-synthetic-1', expect.any(Object))
    expect(input.employee.employee_number).toBe('SYN-1001')
    expect(input.privateDetails.bank_account_number).toBe('SYN-ACCT-1001')
    expect(input.compensation.basic_pay).toBe(6500)
    expect(serviceMocks.submitForHrApproval).toHaveBeenCalledWith('employee-synthetic-1')
    expect(await screen.findByRole('status')).toHaveTextContent('Corrections saved and resubmitted for HR approval.')
  })

  it('does not expose a correction form when backend authorization denies access', async () => {
    serviceMocks.correctionDetails.mockRejectedValue(new Error('permission denied'))
    renderCorrectionRoute()
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable for correction under your current access')
    expect(screen.queryByLabelText('Account number')).not.toBeInTheDocument()
  })

  it('loads the authorized profile and approval timeline without rendering private or compensation fields', async () => {
    renderProfileRoute()
    expect(await screen.findByRole('heading', { name: 'Demo Employee' })).toBeInTheDocument()
    expect(screen.getByText('SUBMITTED')).toBeInTheDocument()
    expect(screen.getByText(/Private identifiers, banking details and compensation are available only in their designated secure workflows/)).toBeInTheDocument()
    expect(screen.queryByText(/SYN-ACCT/)).not.toBeInTheDocument()
    expect(serviceMocks.byId).toHaveBeenCalledWith('employee-synthetic-1')
    expect(serviceMocks.history).toHaveBeenCalledWith('employee-synthetic-1')
  })
})

