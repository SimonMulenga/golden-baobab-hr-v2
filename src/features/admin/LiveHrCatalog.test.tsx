import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  departments: vi.fn(), jobRoles: vi.fn(), saveDepartment: vi.fn(), activateDepartment: vi.fn(), deactivateDepartment: vi.fn(),
  saveJobRole: vi.fn(), deactivateJobRole: vi.fn(),
}))

vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-hr-services', () => ({ createLiveHrServices: () => ({ catalog: mocks }) }))
vi.mock('../companies/WorkspaceContext', () => ({
  useWorkspace: () => ({ companies: [{ id: 'company-qa', name: 'Synthetic QA Ltd', status: 'Active', branches: [] }], activeCompanyId: 'company-qa' }),
  useCompanySelection: () => ({ companyId: 'company-qa', company: { id: 'company-qa', name: 'Synthetic QA Ltd', status: 'Active', branches: [] }, setCompanyId: vi.fn() }),
}))

import { LiveHrCatalog } from './LiveHrCatalog'

const inactiveDepartment = {
  id: 'department-qa', portfolio_id: 'portfolio-qa', company_id: 'company-qa', name: 'Synthetic Operations',
  code: 'OPS', description: 'Synthetic test department', status: 'INACTIVE', created_at: '2026-10-01', updated_at: '2026-10-01',
}

describe('LIVE company department setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.departments.mockResolvedValue([inactiveDepartment])
    mocks.jobRoles.mockResolvedValue([])
    mocks.activateDepartment.mockResolvedValue('department-qa')
    mocks.deactivateDepartment.mockResolvedValue('department-qa')
    mocks.saveDepartment.mockResolvedValue('department-new')
  })

  it('reactivates an inactive department through the scoped service and refreshes the list', async () => {
    render(<MemoryRouter><LiveHrCatalog type="departments" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(mocks.activateDepartment).toHaveBeenCalledWith('department-qa'))
    expect(await screen.findByRole('status')).toHaveTextContent('Department activated. It is available for new employee assignments.')
  })

  it('creates a department for the selected company only through the authorized catalog service', async () => {
    mocks.departments.mockResolvedValue([])
    render(<MemoryRouter><LiveHrCatalog type="departments" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Add department' }))
    fireEvent.change(screen.getByLabelText('Department name'), { target: { value: 'Synthetic Finance' } })
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'FIN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.saveDepartment).toHaveBeenCalledWith({
      companyId: 'company-qa', id: undefined, name: 'Synthetic Finance', code: 'FIN', description: '',
    }))
  })
})
