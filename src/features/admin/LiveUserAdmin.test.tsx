import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollApproverMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const payrollPreparerMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), revoke: vi.fn() }))
const portfolioMocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn(), replaceBranchAssignments: vi.fn(), revoke: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ companyAdmins: { ...mocks }, companyPayrollApprovers: { ...payrollApproverMocks }, companyPayrollPreparers: { ...payrollPreparerMocks }, portfolioUsers: { ...portfolioMocks } }) }))
vi.mock('../companies/WorkspaceContext', () => ({
  useWorkspace: () => ({ companies: [{ id: 'company-demo', portfolioId: 'portfolio-demo', name: 'Synthetic Company', branches: [{ id: 'branch-demo', name: 'Demo Branch', status: 'Active' }] }] }),
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
    portfolioMocks.list.mockResolvedValue([])
    portfolioMocks.assign.mockResolvedValue(undefined)
    portfolioMocks.replaceBranchAssignments.mockResolvedValue(undefined)
    portfolioMocks.revoke.mockResolvedValue(undefined)
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
    expect(screen.getByText(/Submitting the invitation form sends a real email/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Remove access/ }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '77777777-7777-4777-8777-777777777777', 'Synthetic access review'))
  })

  it('assigns a branch-scoped manager role only to selected branches via the live adapter', async () => {
    render(<LiveUserAdmin />)
    expect(await screen.findByText('HR and branch roles')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Portfolio role account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(screen.getByLabelText('Demo Branch'))
    fireEvent.click(screen.getByRole('button', { name: 'Save role assignment' }))
    await waitFor(() => expect(portfolioMocks.assign).toHaveBeenCalledWith('portfolio-demo', '88888888-8888-4888-8888-888888888888', 'BRANCH_MANAGER', ['branch-demo']))
  })

  it('assigns company payroll approval through the company-scoped workflow', async () => {
    render(<LiveUserAdmin />)
    const roleButton = await screen.findByRole('button', { name: 'Assign Company Payroll Approver' })
    await waitFor(() => expect(roleButton).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Company payroll approver account UUID'), { target: { value: '88888888-8888-4888-8888-888888888888' } })
    fireEvent.click(roleButton)
    await waitFor(() => expect(payrollApproverMocks.assign).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '88888888-8888-4888-8888-888888888888'))
  })

  it('assigns HR and payroll preparation without approval through the company-scoped workflow', async () => {
    render(<LiveUserAdmin />)
    const roleButton = await screen.findByRole('button', { name: 'Assign Company HR/Payroll Preparer' })
    await waitFor(() => expect(roleButton).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Company HR/payroll preparer account UUID'), { target: { value: '99999999-9999-4999-8999-999999999999' } })
    fireEvent.click(roleButton)
    await waitFor(() => expect(payrollPreparerMocks.assign).toHaveBeenCalledWith('portfolio-demo', 'company-demo', '99999999-9999-4999-8999-999999999999'))
  })
})
