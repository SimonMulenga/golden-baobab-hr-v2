import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollApproverMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollPreparerMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollReviewerMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const portfolioMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), replaceBranchAssignments: vi.fn(), revoke: vi.fn() }))
const functionMocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({ functions: functionMocks }) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ companyAdmins: { ...mocks }, companyPayrollApprovers: { ...payrollApproverMocks }, companyPayrollPreparers: { ...payrollPreparerMocks }, companyPayrollReviewers: { ...payrollReviewerMocks }, portfolioUsers: { ...portfolioMocks } }) }))
vi.mock('../companies/WorkspaceContext', () => ({
  useWorkspace: () => ({ companies: [{ id: 'company-demo', portfolioId: 'portfolio-demo', name: 'Synthetic Company', branches: [{ id: 'branch-demo', name: 'Demo Branch', status: 'Active' }] }], preferences: null }),
  useCompanySelection: () => ({ companyId: 'company-demo', company: { id: 'company-demo', portfolioId: 'portfolio-demo', name: 'Synthetic Company', branches: [{ id: 'branch-demo', name: 'Demo Branch', status: 'Active' }] }, setCompanyId: vi.fn() }),
  formatWorkspaceDate: (value: string | number | Date) => new Date(value).toLocaleDateString('en-GB'),
}))

import { LiveUserAdmin } from './LiveUserAdmin'

describe('LIVE company administrator management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([{ user_id: '77777777-7777-4777-8777-777777777777', email: 'demo@example.invalid', display_name: 'Demo Admin', role: 'COMPANY_ADMIN', created_at: '2026-10-01T00:00:00Z', revoked_at: null }])
    mocks.assign.mockResolvedValue(undefined)
    mocks.revoke.mockResolvedValue(undefined)
    payrollApproverMocks.list.mockResolvedValue([])
    payrollApproverMocks.assign.mockResolvedValue(undefined)
    payrollApproverMocks.revoke.mockResolvedValue(undefined)
    payrollPreparerMocks.list.mockResolvedValue([])
    payrollPreparerMocks.assign.mockResolvedValue(undefined)
    payrollPreparerMocks.revoke.mockResolvedValue(undefined)
    payrollReviewerMocks.list.mockResolvedValue([])
    payrollReviewerMocks.assign.mockResolvedValue(undefined)
    payrollReviewerMocks.revoke.mockResolvedValue(undefined)
    portfolioMocks.list.mockResolvedValue([])
    portfolioMocks.assign.mockResolvedValue(undefined)
    portfolioMocks.replaceBranchAssignments.mockResolvedValue(undefined)
    portfolioMocks.revoke.mockResolvedValue(undefined)
    functionMocks.invoke.mockReset()
  })

  it('lists company-scoped users and assigns only through the authorized live service', async () => {
    render(<LiveUserAdmin />)
    expect(await screen.findByText('demo@example.invalid')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Company administrator account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign Company Administrator' }))
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '88888888-8888-4888-8888-888888888888'))
  })

  it('explains that invitation submits send email and requires a reason to revoke', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Synthetic access review')
    render(<LiveUserAdmin />)
    expect(await screen.findByText('demo@example.invalid')).toBeInTheDocument()
    expect(screen.getByText(/Invitations send an email/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Remove access/ }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '77777777-7777-4777-8777-777777777777', 'Synthetic access review'))
  })

  it('does not report an invitation as successful when scoped role assignment failed', async () => {
    functionMocks.invoke.mockResolvedValue({ data: { invited: true, accessAssigned: false }, error: null })
    render(<LiveUserAdmin />)
    fireEvent.change(screen.getByLabelText('Invite email address'), { target: { value: 'qa@example.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(functionMocks.invoke).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent(/email was sent, but role assignment did not complete/)
    expect(screen.queryByText(/Invitation sent to qa@example.invalid/)).not.toBeInTheDocument()
  })

  it('requires explicit backend confirmation before showing invitation success', async () => {
    functionMocks.invoke.mockResolvedValue({ data: { accessAssigned: true }, error: null })
    render(<LiveUserAdmin />)
    fireEvent.change(screen.getByLabelText('Invite email address'), { target: { value: 'qa@example.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(functionMocks.invoke).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not confirm that an invitation was created/)
    expect(screen.queryByText(/Invitation sent to qa@example.invalid/)).not.toBeInTheDocument()
  })

  it('assigns a branch-scoped manager role only to selected branches via the live adapter', async () => {
    render(<LiveUserAdmin />)
    expect(await screen.findByText('HR and branch roles')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('User account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(screen.getByLabelText('Demo Branch'))
    fireEvent.click(screen.getByRole('button', { name: 'Save role assignment' }))
    await waitFor(() => expect(portfolioMocks.assign).toHaveBeenCalledWith('portfolio-demo', '88888888-8888-4888-8888-888888888888', 'BRANCH_MANAGER', ['branch-demo']))
  })

  it('offers only the three client account roles for new invitations', async () => {
    render(<LiveUserAdmin />)
    const role = await screen.findByLabelText('Role')
    expect(Array.from((role as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      'Overall HR Manager', 'Branch Manager', 'Company Administrator',
    ])
    expect(screen.queryByRole('button', { name: /Assign Company Payroll (Approver|Reviewer)|Assign Company HR\/Payroll Preparer/ })).not.toBeInTheDocument()
  })

  it('shows the portfolio Company Administrator only HR and branch role controls', async () => {
    render(<LiveUserAdmin portfolioCompanyAdmin />)
    expect(await screen.findByText('Create Overall HR Manager and Branch Manager access.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Company administrator account UUID')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose a company' })).toBeInTheDocument()
    const invitationRole = screen.getByLabelText('Role') as HTMLSelectElement
    expect(Array.from(invitationRole.options).map((option) => option.value)).toEqual(['OVERALL_HR_MANAGER', 'BRANCH_MANAGER'])
    const assignmentRole = screen.getByLabelText('Account role') as HTMLSelectElement
    expect(Array.from(assignmentRole.options).map((option) => option.value)).toEqual(['OVERALL_HR_MANAGER', 'BRANCH_MANAGER'])
  })
})
