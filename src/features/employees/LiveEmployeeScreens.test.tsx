import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'

const serviceMocks = vi.hoisted(() => ({ list: vi.fn(), reviewSubmission: vi.fn(), createDraft: vi.fn(), submitForHrApproval: vi.fn() }))
const workspaceMocks = vi.hoisted(() => ({ companies: [] as unknown[] }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({
  createLiveBusinessServices: () => ({ employees: serviceMocks }),
}))
vi.mock('../companies/WorkspaceContext', () => ({ useWorkspace: () => ({ companies: workspaceMocks.companies }) }))

import { LiveEmployeeApprovals, LiveEmployeeDirectory, LiveEmployeeForm } from './LiveEmployeeScreens'

const employee = {
  id: 'employee-synthetic-1', portfolio_id: 'portfolio-synthetic', company_id: 'company-synthetic',
  workplace_branch_id: 'branch-synthetic', employee_number: 'SYN-1001', first_name: 'Demo',
  middle_name: null, last_name: 'Employee', date_of_birth: '1990-01-01', nationality: 'Zambian',
  job_title: 'Analyst', department: 'Finance', employment_type: 'FULL_TIME', contract_type: 'PERMANENT',
  contract_start_date: '2026-01-01', contract_end_date: null, retirement_age: 65,
  retirement_status: 'NOT_RETIRED' as const, approval_status: 'SUBMITTED_FOR_HR_APPROVAL' as const,
  submitted_at: '2026-10-28T08:00:00Z', reviewed_at: null, created_at: '2026-10-28T07:00:00Z',
}

function renderRoute(element: React.ReactNode) {
  return render(<MemoryRouter>{element}</MemoryRouter>)
}

describe('LIVE employee screens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceMocks.companies = [{ id: 'company-synthetic', portfolioId: 'portfolio-synthetic', name: 'Synthetic Company', status: 'Active', branches: [{ id: 'branch-synthetic', name: 'Demo Branch', status: 'Active' }] }]
    serviceMocks.list.mockResolvedValue({ items: [employee], total: 1 })
    serviceMocks.reviewSubmission.mockResolvedValue('employee-synthetic-1')
    serviceMocks.createDraft.mockResolvedValue('employee-created-synthetic')
    serviceMocks.submitForHrApproval.mockResolvedValue('employee-created-synthetic')
  })

  it('loads only the authorized employee directory page from the live service', async () => {
    renderRoute(<LiveEmployeeDirectory />)
    expect(await screen.findByText('Demo Employee')).toBeInTheDocument()
    expect(screen.getByText('SYN-1001')).toBeInTheDocument()
    expect(serviceMocks.list).toHaveBeenCalledWith({ page: 1, pageSize: 25, search: '' })
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
})
