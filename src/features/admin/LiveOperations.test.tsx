import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { LiveNotifications, LiveSettings } from './LiveOperations'

const mocks = vi.hoisted(() => ({ notifications: vi.fn(), setRead: vi.fn(), setManyRead: vi.fn(), getSettings: vi.fn(), saveSettings: vi.fn() }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('../../services/live-operations-services', () => ({ createLiveOperationsServices: () => ({ notifications: { list: mocks.notifications, setRead: mocks.setRead, setManyRead: mocks.setManyRead }, settings: { get: mocks.getSettings, save: mocks.saveSettings } }) }))

const company = { ...mockCompanies[0], id: 'synthetic-company', branches: [] }
const notification = { id: 'notification-1', portfolio_id: 'synthetic-portfolio', company_id: company.id, branch_id: null, recipient_id: 'synthetic-user', source_type: 'LEAVE' as const, source_id: 'synthetic-leave', transition: 'APPROVED', title: 'Leave workflow updated', message: 'Your leave record status changed to approved.', action_path: '/leave', created_at: '2026-10-29T08:00:00Z', read_at: null }
function withWorkspace(node: React.ReactNode) { return <WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}>{node}</WorkspaceContext.Provider> }

describe('LIVE operations settings and notifications', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.notifications.mockResolvedValue({ items: [notification], total: 1, unreadTotal: 1 }); mocks.setRead.mockResolvedValue(undefined); mocks.setManyRead.mockResolvedValue(undefined); mocks.getSettings.mockResolvedValue(null); mocks.saveSettings.mockResolvedValue(company.id) })

  it('loads only the signed-in inbox service and persists read state', async () => {
    render(<MemoryRouter>{withWorkspace(<LiveNotifications />)}</MemoryRouter>)
    expect(await screen.findByText('Your leave record status changed to approved.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }))
    await waitFor(() => expect(mocks.setRead).toHaveBeenCalledWith(notification.id, true))
    expect(await screen.findByRole('status')).toHaveTextContent('Notification marked as read')
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/leave')
  })

  it('loads defaults and saves company-scoped workspace settings through its RPC service', async () => {
    render(withWorkspace(<LiveSettings />))
    expect(await screen.findByLabelText('Planned payroll cut-off day')).toHaveValue(25)
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'UTC' } })
    fireEvent.change(screen.getByLabelText('Planned payroll cut-off day'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save company settings' }))
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ companyId: company.id, timezone: 'UTC', dateFormat: 'DD/MM/YYYY', currencyCode: 'ZMW', payrollCutoffDay: 20 })))
    expect(await screen.findByRole('status')).toHaveTextContent('Company settings saved')
  })
})
