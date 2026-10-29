import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { mockCompanies } from '../companies/mockData'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { LiveAuditLogs } from './LiveAuditLogs'

const mocks = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../services/live-business-services', () => ({ createLiveBusinessServices: () => ({ audit: { list: mocks.list } }) }))
vi.mock('../../lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))

const company = { ...mockCompanies[0], id: 'audit-co', branches: [{ ...mockCompanies[0].branches[0], id: 'audit-br', name: 'Synthetic Branch' }] }
const event = { id: 10, portfolio_id: 'p1', company_id: company.id, branch_id: 'audit-br', actor_id: 'synthetic-user-id', action: 'PAYROLL_FINALIZED', module: 'payroll', record_id: 'run-123', details: { payroll_version: 2 }, occurred_at: '2026-10-28T08:00:00.000Z' }

describe('LIVE audit log viewer', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items: [event], total: 1 }) })

  it('reads persisted authorized events and displays event details read-only', async () => {
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveAuditLogs /></WorkspaceContext.Provider>)
    expect(await screen.findByText('PAYROLL FINALIZED')).toBeInTheDocument()
    expect(screen.getAllByText('Synthetic Branch').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('synthetic-user-id')
    expect(screen.getByText(/payroll_version/)).toBeInTheDocument()
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }))
  })

  it('shows an authorization error instead of synthetic events when the service denies access', async () => {
    mocks.list.mockRejectedValue(new Error('permission denied'))
    render(<WorkspaceContext.Provider value={{ companies: [company], saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: company.id }}><LiveAuditLogs /></WorkspaceContext.Provider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Audit records are unavailable')
    expect(screen.queryByText('PAYROLL FINALIZED')).not.toBeInTheDocument()
  })
})
