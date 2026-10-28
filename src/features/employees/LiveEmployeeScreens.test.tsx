import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'

const serviceMocks = vi.hoisted(() => ({ list: vi.fn(), byId: vi.fn(), history: vi.fn(), employmentHistory: vi.fn(), setEmploymentStatus: vi.fn(), reviewSubmission: vi.fn(), createDraft: vi.fn(), correctionDetails: vi.fn(), updateDraft: vi.fn(), submitForHrApproval: vi.fn() }))
const workspaceMocks = vi.hoisted(() => ({ companies: [] as unknown[] }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({
  createLiveBusinessServices: () => ({ employees: serviceMocks }),
}))
vi.mock('../companies/WorkspaceContext', () => ({ useWorkspace: () => ({ companies: workspaceMocks.companies }) }))

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
  return render(<MemoryRouter>{element}</MemoryRouter>)
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
    serviceMocks.setEmploymentStatus.mockResolvedValue(undefined)
    serviceMocks.reviewSubmission.mockResolvedValue('employee-synthetic-1')
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
    expect(serviceMocks.list).toHaveBeenCalledWith({ page: 1, pageSize: 25, search: '' })
  })

  it('requires a reason and submits employment status changes through the trusted service', async () => {
    serviceMocks.byId.mockResolvedValue({ ...employee, approval_status: 'APPROVED' })
    renderProfileRoute()
    expect(await screen.findByRole('heading', { name: 'Employment status' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a reason')
    fireEvent.change(screen.getByPlaceholderText('Document the reason for this change'), { target: { value: 'Synthetic policy review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    await waitFor(() => expect(serviceMocks.setEmploymentStatus).toHaveBeenCalledWith(employee.id, 'SUSPENDED', 'Synthetic policy review'))
  })

  it('requests the submitted review queue and invokes the trusted approval action', async () => {
    renderRoute(<LiveEmployeeApprovals />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Demo Employee' }))
    await waitFor(() => expect(serviceMocks.reviewSubmission).toHaveBeenCalledWith('employee-synthetic-1', 'APPROVE', undefined))
    await waitFor(() => expect(serviceMocks.list).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: '', approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Demo Employee: approve action saved.')
  })

  it('requires a reason for return and shows backend rejection without a success state', async () => {
    serviceMocks.reviewSubmission.mockRejectedValue(new Error('permission denied'))
    renderRoute(<LiveEmployeeApprovals />)
    fireEvent.click(await screen.findByRole('button', { name: /Return/ }))
    fireEvent.submit(screen.getByRole('dialog'))
    expect(await screen.findByText('Enter a short review reason before returning or rejecting this record.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Please verify contract dates' } })
    fireEvent.submit(screen.getByRole('dialog'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The review was not saved.')
    expect(screen.queryByText(/updated successfully/)).not.toBeInTheDocument()
  })

  it('creates a company and branch bound employee draft and submits it to HR', async () => {
    renderRoute(<LiveEmployeeForm />)
    const values: Record<string, string> = {
      'Employee number *': 'SYN-2001', 'First name *': 'Synthetic', 'Last name *': 'Person',
      'Date of birth *': '1992-04-03', 'Nationality *': 'Zambian', 'Identity document number *': 'SYN-NRC-2001',
      'Residential address *': 'Synthetic address', 'Phone number *': '+260000000000', Email: 'synthetic@example.invalid',
      'Emergency contact *': 'Synthetic Contact', 'Relationship *': 'Colleague', 'Emergency phone *': '+260000000001',
      'Job title *': 'Analyst', 'Department *': 'Finance', 'Contract type *': 'PERMANENT', 'Employment start *': '2026-10-01',
      'Basic pay (ZMW) *': '6000', 'Bank name *': 'Synthetic Bank', 'Account name *': 'Synthetic Person', 'Account number *': 'SYN-ACCT-2001',
    }
    for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.change(screen.getByLabelText('Company *'), { target: { value: 'company-synthetic' } })
    fireEvent.change(screen.getByLabelText('Workplace branch *'), { target: { value: 'branch-synthetic' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save and submit for review' }).closest('form')!)
    await waitFor(() => expect(serviceMocks.createDraft).toHaveBeenCalledTimes(1))
    const input = serviceMocks.createDraft.mock.calls[0][0]
    expect(input.companyId).toBe('company-synthetic')
    expect(input.branchId).toBe('branch-synthetic')
    expect(input.employee.employee_number).toBe('SYN-2001')
    expect(input.privateDetails.identity_document_type).toBe('NRC')
    expect(input.privateDetails.bank_account_number).toBe('SYN-ACCT-2001')
    expect(input.compensation.basic_pay).toBe(6000)
    expect(serviceMocks.submitForHrApproval).toHaveBeenCalledWith('employee-created-synthetic')
    expect(await screen.findByRole('status')).toHaveTextContent('submitted for HR approval')
  })

  it('loads creator-authorized correction details, saves edits and resubmits through trusted RPCs', async () => {
    renderCorrectionRoute()
    expect(await screen.findByRole('heading', { name: 'Correct employee record' })).toBeInTheDocument()
    expect(screen.getByLabelText('Account number *')).toHaveValue('SYN-ACCT-1001')
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
    expect(screen.queryByLabelText('Account number *')).not.toBeInTheDocument()
  })

  it('loads the authorized profile and approval timeline without rendering private or compensation fields', async () => {
    renderProfileRoute()
    expect(await screen.findByRole('heading', { name: 'Demo Employee' })).toBeInTheDocument()
    expect(screen.getByText('SUBMITTED')).toBeInTheDocument()
    expect(screen.getByText(/Private identifiers, banking details and compensation are intentionally excluded/)).toBeInTheDocument()
    expect(screen.queryByText(/SYN-ACCT/)).not.toBeInTheDocument()
    expect(serviceMocks.byId).toHaveBeenCalledWith('employee-synthetic-1')
    expect(serviceMocks.history).toHaveBeenCalledWith('employee-synthetic-1')
  })
})


