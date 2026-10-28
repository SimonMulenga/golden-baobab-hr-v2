import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WorkspaceContext } from './WorkspaceContext'
import type { WorkspaceData } from './WorkspaceContext'
import { mockCompanies } from './mockData'
import { CompanyDirectory, CompanyForm, CompanyProfile } from './CompanyScreens'
import type { Company } from './types'

function renderWorkspace(path: string, overrides: Partial<WorkspaceData> = {}) {
  const companies = overrides.companies ?? mockCompanies.slice(0, 2)
  const workspace: WorkspaceData = {
    companies,
    saveCompany: vi.fn(),
    deleteCompany: vi.fn(),
    setActiveCompany: vi.fn(),
    activeCompanyId: 'all',
    ...overrides,
  }

  return {
    workspace,
    ...render(
      <WorkspaceContext.Provider value={workspace}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/companies" element={<CompanyDirectory />} />
            <Route path="/companies/new" element={<CompanyForm mode="create" />} />
            <Route path="/companies/:companyId" element={<CompanyProfile />} />
            <Route path="*" element={<div>Mock workspace route</div>} />
          </Routes>
        </MemoryRouter>
      </WorkspaceContext.Provider>,
    ),
  }
}

function fillCompanyForm() {
  fireEvent.change(screen.getByPlaceholderText('e.g. Copperbelt Mining Co.'), { target: { value: 'Demo Top Level Ltd' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. 120180004327'), { target: { value: '120180004327' } })
  fireEvent.change(screen.getByPlaceholderText('10-digit tax payer number'), { target: { value: '1008234567' } })
  fireEvent.change(screen.getByLabelText('Industry*'), { target: { value: 'Mining' } })
  fireEvent.change(screen.getByPlaceholderText('people@company.co.zm'), { target: { value: 'hr@demo.example' } })
  fireEvent.change(screen.getByPlaceholderText('+260 97 123 4567'), { target: { value: '+260 97 123 4567' } })
  fireEvent.change(screen.getByPlaceholderText('Plot, street, and area'), { target: { value: 'Plot 1, Demo Road' } })
  fireEvent.change(screen.getByLabelText('Province*'), { target: { value: 'Lusaka' } })
  fireEvent.change(screen.getByPlaceholderText('e.g. Lusaka'), { target: { value: 'Lusaka' } })
  fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Demo Contact' } })
}

describe('company-first company screens', () => {
  it('creates a company without an organization field or parent dependency', async () => {
    const { workspace } = renderWorkspace('/companies/new')

    expect(screen.queryByLabelText(/organization/i)).not.toBeInTheDocument()
    fillCompanyForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create company' }))

    await waitFor(() => expect(workspace.saveCompany).toHaveBeenCalledOnce())
    const created = vi.mocked(workspace.saveCompany).mock.calls[0][0] as Company
    expect(created.name).toBe('Demo Top Level Ltd')
    expect('organizationId' in created).toBe(false)
    expect(created.branches).toEqual([])
  })

  it('switches the visible company in the directory according to active mock selection', () => {
    const companies = mockCompanies.slice(0, 2)
    renderWorkspace('/companies', { companies, activeCompanyId: companies[1].id })

    expect(screen.getByText(companies[1].name, { selector: '.company-table-name strong' })).toBeInTheDocument()
    expect(screen.queryByText(companies[0].name, { selector: '.company-table-name strong' })).not.toBeInTheDocument()
  })

  it('keeps branch records associated with the company that owns the profile', async () => {
    const company = mockCompanies[0]
    const saveCompany = vi.fn()
    renderWorkspace(`/companies/${company.id}`, { companies: [company], saveCompany })

    fireEvent.click(screen.getAllByRole('button', { name: /branches/i })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' })[0])
    fireEvent.change(screen.getByPlaceholderText('e.g. Lusaka Headquarters'), { target: { value: 'Demo Branch' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. LSK-01'), { target: { value: 'DMB-01' } })
    fireEvent.change(screen.getByLabelText('Province*'), { target: { value: 'Lusaka' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. Lusaka'), { target: { value: 'Lusaka' } })
    fireEvent.change(screen.getByPlaceholderText('Plot, street, area'), { target: { value: 'Demo Street' } })
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'Demo Manager' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add branch' }).at(-1)!)

    await waitFor(() => expect(saveCompany).toHaveBeenCalledOnce())
    const updated = vi.mocked(saveCompany).mock.calls[0][0] as Company
    expect(updated.id).toBe(company.id)
    expect(updated.branches.at(-1)?.name).toBe('Demo Branch')
  })

  it('has no organization route or organization form selector', () => {
    renderWorkspace('/organizations')

    expect(screen.getByText('Mock workspace route')).toBeInTheDocument()
    expect(screen.queryByLabelText(/organization/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument()
  })

  it('supports more companies than the original demo set without a configured cap', () => {
    const companies = Array.from({ length: 25 }, (_, index) => ({
      ...mockCompanies[0],
      id: `company-${index}`,
      name: `Demo Company ${index + 1}`,
      branches: [],
    }))
    renderWorkspace('/companies', { companies })

    expect(screen.getByText((_, element) => element?.textContent === '25 companies')).toBeInTheDocument()
    expect(document.querySelector('.directory-footer')).toHaveTextContent('25')
    expect(screen.getByText((_, element) => element?.classList.contains('directory-total') === true)).toHaveTextContent('7,100 employees')
  })
})
