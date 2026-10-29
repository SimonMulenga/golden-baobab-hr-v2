import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveStatutoryFilings } from './LiveStatutoryFilings'

const mocks = vi.hoisted(() => ({ list: vi.fn(), prepare: vi.fn(), update: vi.fn(), finalizedRuns: vi.fn(), finalizedItems: vi.fn(), byIds: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-statutory-filing-services', () => ({ createLiveStatutoryFilingServices: () => mocks }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ payslips: mocks, employees: { byIds: mocks.byIds } }) }))

const company = { ...mockCompanies[0], id: 'synthetic-filing-company', branches: [{ ...mockCompanies[0].branches[0], id: 'synthetic-filing-branch', name: 'Synthetic branch' }] }
const otherCompany = { ...company, id: 'synthetic-other-company', name: 'Other synthetic company', branches: [{ ...company.branches[0], id: 'synthetic-other-branch', name: 'Other synthetic branch' }] }
const run = { id: 'synthetic-finalized-run', company_id: company.id, branch_id: company.branches[0].id, payroll_period_id: 'synthetic-period', status: 'FINALIZED' as const, version: 2, finalized_at: '2026-10-31T12:00:00Z', payroll_periods: { period_start: '2026-10-01', period_end: '2026-10-31' } }
const filing = { id: 'synthetic-filing-row', payroll_run_id: run.id, payroll_version: 2, authority: 'PAYE' as const, period_start: '2026-10-01', period_end: '2026-10-31', due_date: '2026-11-10', liability_amount: 2000, filing_status: 'NOT_STARTED' as const, submitted_at: null, submission_reference: null, remittance_status: 'UNPAID' as const, remitted_amount: 0, remitted_at: null, remittance_reference: null, note: null, updated_at: '2026-10-31T12:00:00Z' }
const page = { items: [filing], total: 1, page: 1, page_size: 25 }
const setActiveCompany = vi.fn()
const renderScreen = (activeCompanyId = company.id, companies = [company]) => render(<WorkspaceContext.Provider value={{ companies, saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany, activeCompanyId }}><LiveStatutoryFilings /></WorkspaceContext.Provider>)

describe('LIVE statutory filing tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks(); setActiveCompany.mockClear()
    mocks.list.mockResolvedValue(page); mocks.prepare.mockResolvedValue('synthetic-filing-row'); mocks.update.mockResolvedValue('synthetic-filing-row')
    mocks.finalizedRuns.mockResolvedValue([run]); mocks.finalizedItems.mockResolvedValue({ items: [], total: 0 }); mocks.byIds.mockResolvedValue([])
  })

  it('prepares a filing record from an authorized finalized run and explicit due date', async () => {
    renderScreen()
    expect(await screen.findByText('Filing register')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Finalized run'), { target: { value: run.id } })
    fireEvent.change(screen.getByLabelText('Due date from approved calendar'), { target: { value: '2026-11-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare filing record' }))
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith(run.id, 'PAYE', '2026-11-10'))
    expect(await screen.findByRole('status')).toHaveTextContent('No return was submitted')
  })

  it('shows only live permitted rows and handles permission denial without mock fallback', async () => {
    mocks.list.mockRejectedValue(new Error('permission denied'))
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('filing records are unavailable')
    expect(screen.queryByText('K2,000.00')).not.toBeInTheDocument()
  })

  it('follows the global company selection and updates it from the filing selector', async () => {
    const view = renderScreen(company.id, [company, otherCompany])
    const companySelect = await screen.findByLabelText('Filing company')
    expect(companySelect).toHaveValue(company.id)

    view.rerender(<WorkspaceContext.Provider value={{ companies: [company, otherCompany], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany, activeCompanyId: otherCompany.id }}><LiveStatutoryFilings /></WorkspaceContext.Provider>)
    await waitFor(() => expect(companySelect).toHaveValue(otherCompany.id))
    fireEvent.change(companySelect, { target: { value: company.id } })
    expect(setActiveCompany).toHaveBeenCalledWith(company.id)
  })
})
