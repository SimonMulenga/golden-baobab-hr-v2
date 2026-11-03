import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn(), manageAssignment: vi.fn() }))
const payrollApproverMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollPreparerMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollReviewerMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const portfolioMocks = vi.hoisted(() => ({ list: vi.fn(), listForCompany: vi.fn(), assign: vi.fn(), replaceBranchAssignments: vi.fn(), revokeBranchAssignments: vi.fn(), revoke: vi.fn() }))
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
    mocks.manageAssignment.mockResolvedValue(undefined)
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
    portfolioMocks.listForCompany.mockResolvedValue([])
    portfolioMocks.assign.mockResolvedValue(undefined)
    portfolioMocks.replaceBranchAssignments.mockResolvedValue(undefined)
    portfolioMocks.revokeBranchAssignments.mockResolvedValue(undefined)
    portfolioMocks.revoke.mockResolvedValue(undefined)
    functionMocks.invoke.mockReset()
  })

  it('lists company-scoped users and assigns only through the authorized live service', async () => {
    render(<LiveUserAdmin />)
    expect(await screen.findByText('demo@example.invalid')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Company Administrator account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign Company Administrator' }))
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '88888888-8888-4888-8888-888888888888'))
    expect(await screen.findByRole('status')).toHaveTextContent('Company Administrator access was assigned.')
  })

  it('keeps a company administrator branch-user directory and invitations within the selected company', async () => {
    portfolioMocks.listForCompany.mockResolvedValue([{
      user_id: '88888888-8888-4888-8888-888888888888', email: 'branch@example.invalid', display_name: 'Branch User',
      role: 'BRANCH_MANAGER', created_at: '2026-10-01T00:00:00Z', revoked_at: null, branch_ids: ['branch-demo'],
    }])
    functionMocks.invoke.mockResolvedValue({ data: { invited: true, accessAssigned: true }, error: null })
    render(<LiveUserAdmin companyScopedAdministrator />)
    expect(await screen.findByText('branch@example.invalid')).toBeInTheDocument()
    expect(portfolioMocks.listForCompany).toHaveBeenCalledWith('portfolio-demo', 'company-demo')
    expect(screen.queryByRole('option', { name: 'Overall HR Manager (portfolio-wide)' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Invite email address'), { target: { value: 'new-branch@example.invalid' } })
    fireEvent.click(screen.getAllByLabelText('Demo Branch')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(functionMocks.invoke).toHaveBeenCalledWith('invite-user', { body: expect.objectContaining({
      role: 'BRANCH_MANAGER', companyId: 'company-demo', branchIds: ['branch-demo'],
    }) }))
  })

  it('provides a separate role action menu and requires a reason to revoke', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'prompt').mockReturnValue('Synthetic access review')
    render(<LiveUserAdmin companyScopedAdministrator />)
    expect(await screen.findByText('demo@example.invalid')).toBeInTheDocument()
    expect(screen.getByText(/Invitations send an email/)).toBeInTheDocument()
    const actionToggle = screen.getAllByLabelText('demo@example.invalid actions')[0]
    actionToggle.closest('details')?.setAttribute('open', '')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke role' }))
    await waitFor(() => expect(mocks.manageAssignment).toHaveBeenCalledWith({
      portfolioId: 'portfolio-demo', companyId: 'company-demo', userId: '77777777-7777-4777-8777-777777777777',
      action: 'REVOKE', reason: 'Synthetic access review',
    }))
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

  it('invites a portfolio-scoped Company Administrator without assigning a single-company scope', async () => {
    functionMocks.invoke.mockResolvedValue({ data: { invited: true, accessAssigned: true }, error: null })
    render(<LiveUserAdmin portfolioCompanyAdmin />)
    fireEvent.change(screen.getByLabelText('Invite email address'), { target: { value: 'portfolio-admin@example.invalid' } })
    fireEvent.change(screen.getByLabelText('Invitation access level'), { target: { value: 'PORTFOLIO_COMPANY_ADMIN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() => expect(functionMocks.invoke).toHaveBeenCalledWith('invite-user', { body: expect.objectContaining({
      email: 'portfolio-admin@example.invalid', portfolioId: 'portfolio-demo', role: 'PORTFOLIO_COMPANY_ADMIN', companyId: null,
    }) }))
  })

  it('assigns a branch-scoped manager role only to selected branches via the live adapter', async () => {
    render(<LiveUserAdmin />)
    expect(await screen.findByText('HR and branch roles')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('User account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(screen.getByLabelText('Demo Branch'))
    fireEvent.click(screen.getByRole('button', { name: 'Save role assignment' }))
    await waitFor(() => expect(portfolioMocks.assign).toHaveBeenCalledWith('portfolio-demo', '88888888-8888-4888-8888-888888888888', 'BRANCH_MANAGER', ['branch-demo']))
  })

  it('offers only company-scoped roles to a company administrator', async () => {
    render(<LiveUserAdmin />)
    const role = await screen.findByLabelText('Invitation access level')
    expect(Array.from((role as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      'Branch Manager (selected branches)', 'Payroll Processor (selected branches)', 'Company Administrator (selected company)',
    ])
    expect(screen.queryByRole('button', { name: /Assign Company Payroll (Approver|Reviewer)|Assign Company HR\/Payroll Preparer/ })).not.toBeInTheDocument()
  })

  it('shows the same administrator user-management controls to the Portfolio Administrator', async () => {
    render(<LiveUserAdmin portfolioCompanyAdmin />)
    expect(await screen.findByText('Manage administrator, HR and branch access for your authorized workspace.')).toBeInTheDocument()
    expect(screen.getByLabelText('Company Administrator account UUID')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose a company' })).toBeInTheDocument()
    const invitationRole = screen.getByLabelText('Invitation access level') as HTMLSelectElement
    expect(Array.from(invitationRole.options).map((option) => option.value)).toEqual(['PORTFOLIO_ADMIN', 'PORTFOLIO_COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR', 'COMPANY_ADMIN'])
    const assignmentRole = screen.getByLabelText('Role access level') as HTMLSelectElement
    expect(Array.from(assignmentRole.options).map((option) => option.value)).toEqual(['PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR'])
    expect(screen.getByRole('heading', { name: 'HR and branch roles' })).toBeInTheDocument()
  })

  it('labels company and portfolio administrator memberships by their actual scope', async () => {
    portfolioMocks.listForCompany.mockResolvedValue([{
      user_id: '66666666-6666-4666-8666-666666666666',
      email: 'portfolio@example.invalid',
      display_name: 'Portfolio Admin',
      role: 'PORTFOLIO_ADMIN',
      created_at: '2026-10-01T00:00:00Z',
      revoked_at: null,
      branch_ids: [],
      scope_type: 'PORTFOLIO',
      assignment_status: 'ACTIVE',
    }])
    render(<LiveUserAdmin portfolioWideAdministrator />)
    expect(await screen.findByText('portfolio@example.invalid')).toBeInTheDocument()
    expect(screen.getAllByText('Company Administrator').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Portfolio Administrator').length).toBeGreaterThan(0)
  })
})
