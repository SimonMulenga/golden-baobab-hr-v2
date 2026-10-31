import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveCompanyServices } from './live-company-services'
import { mockCompanies } from '../features/companies/mockData'

function queryClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient
  return { client, query }
}

describe('live company data services', () => {
  it('maps only RLS-visible company and branch rows from Supabase', async () => {
    const { client, query } = queryClient({
      error: null,
      data: [{
        id: 'company-uuid', portfolio_id: 'portfolio-uuid', name: 'Synthetic Zambia Services',
        registration_number: 'DEMO-REG-1', tpin: 'DEMO-TPIN-1', industry: 'Services',
        business_email: 'demo@example.invalid', phone: '+260000000001', province: 'Lusaka', town: 'Lusaka',
        physical_address: 'Synthetic address', contact_person: 'Demo contact', status: 'ACTIVE',
        created_at: '2026-10-28T00:00:00Z', branches: [{ id: 'branch-uuid', name: 'Lusaka Demo', code: 'DEMO-1',
          province: 'Lusaka', town: 'Lusaka', physical_address: 'Synthetic address', manager_name: null,
          contact_phone: null, status: 'ACTIVE' }],
      }],
    })

    const companies = await createLiveCompanyServices(client, 'session-user-id').list()

    expect(client.from).toHaveBeenCalledWith('companies')
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('branches('))
    expect(companies).toHaveLength(1)
    expect(companies[0]).toMatchObject({ id: 'company-uuid', portfolioId: 'portfolio-uuid', status: 'Active' })
    expect(companies[0].branches[0]).toMatchObject({ id: 'branch-uuid', manager: '', status: 'Active' })
  })

  it('propagates RLS failures rather than falling back to browser demo records', async () => {
    const { client } = queryClient({ data: null, error: new Error('RLS denied') })
    await expect(createLiveCompanyServices(client, 'session-user-id').list()).rejects.toThrow('RLS denied')
  })

  it('sends company and branch changes through the permission-checked atomic RPC', async () => {
    const branch = { ...mockCompanies[0].branches[0], id: 'branch-uuid', name: 'QA Branch' }
    const company = {
      ...mockCompanies[0], id: 'company-uuid', portfolioId: 'portfolio-uuid', branches: [branch],
    }
    const updatedBranch = { ...branch, name: 'Updated QA Branch' }
    const denied = new Error('Branch update is unauthorized.')
    const rpc = vi.fn().mockResolvedValue({ data: null, error: denied })
    const client = { rpc } as unknown as SupabaseClient

    await expect(createLiveCompanyServices(client, 'session-user-id').save(
      { ...company, branches: [updatedBranch] }, company,
    )).rejects.toThrow('Branch update is unauthorized.')

    expect(rpc).toHaveBeenCalledWith('company_workspace_save', expect.objectContaining({
      p_portfolio_id: 'portfolio-uuid',
      p_company_id: 'company-uuid',
      p_branches: [expect.objectContaining({ id: 'branch-uuid', name: 'Updated QA Branch' })],
      p_deactivate_branch_ids: [],
    }))
  })

  it('derives the first company portfolio from the scoped Company Administrator role', async () => {
    const companyRow = {
      id: 'new-company-uuid', portfolio_id: 'portfolio-uuid', name: 'First Client Company',
      registration_number: 'REG-1', tpin: 'TPIN-1', industry: 'Services', business_email: 'client@example.invalid',
      phone: '+260000000001', province: 'Lusaka', town: 'Lusaka', physical_address: 'Synthetic address',
      contact_person: 'Client contact', status: 'ACTIVE', created_at: '2026-10-31T00:00:00Z', branches: [],
    }
    const makeQuery = (result: unknown) => {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'in', 'order']) query[method] = vi.fn(() => query)
      query.single = vi.fn(() => Promise.resolve(result))
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return query
    }
    const membershipQuery = makeQuery({ data: [{ portfolio_id: 'portfolio-uuid' }], error: null })
    const companyQuery = makeQuery({ data: companyRow, error: null })
    const employeeQuery = makeQuery({ data: null, error: null, count: 0 })
    const rpc = vi.fn().mockResolvedValue({ data: 'new-company-uuid', error: null })
    const client = {
      from: vi.fn((table: string) => table === 'portfolio_memberships' ? membershipQuery : table === 'companies' ? companyQuery : employeeQuery),
      rpc,
    } as unknown as SupabaseClient

    const result = await createLiveCompanyServices(client, 'company-admin-user').save({
      ...mockCompanies[0], id: '', portfolioId: '', name: 'First Client Company', branches: [],
    })

    expect((membershipQuery.in as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('role', ['PORTFOLIO_ADMIN', 'COMPANY_ADMIN'])
    expect(rpc).toHaveBeenCalledWith('company_workspace_save', expect.objectContaining({ p_portfolio_id: 'portfolio-uuid', p_company_id: null }))
    expect(result.id).toBe('new-company-uuid')
  })

  it('uploads logos to a company-scoped private path and updates the pointer through the audited RPC', async () => {
    const path = 'portfolio-uuid/company-uuid/logo-uuid.webp'
    const companyRows = [
      { data: { id: 'company-uuid', portfolio_id: 'portfolio-uuid', logo_storage_path: null }, error: null },
      { data: {
        id: 'company-uuid', portfolio_id: 'portfolio-uuid', name: 'Synthetic Company', registration_number: 'REG-1',
        tpin: 'TPIN-1', industry: 'Services', business_email: 'company@example.invalid', phone: '+260000000001',
        province: 'Lusaka', town: 'Lusaka', physical_address: 'Synthetic address', contact_person: 'QA Contact',
        status: 'ACTIVE', created_at: '2026-10-31T00:00:00Z', logo_storage_path: path, branches: [],
      }, error: null },
    ]
    const makeQuery = (result: unknown) => {
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order']) query[method] = vi.fn(() => query)
      query.single = vi.fn(() => Promise.resolve(result))
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return query
    }
    const employeeQuery = makeQuery({ count: 0, error: null })
    const from = vi.fn((table: string) => table === 'employees' ? employeeQuery : makeQuery(companyRows.shift()))
    const upload = vi.fn().mockResolvedValue({ data: { path }, error: null })
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://signed.example.invalid/logo' }, error: null })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const client = {
      from, rpc, storage: { from: vi.fn(() => ({ upload, createSignedUrl, remove })) },
    } as unknown as SupabaseClient
    vi.stubGlobal('crypto', { randomUUID: () => 'logo-uuid' })

    const file = new File(['webp'], 'company-logo.webp', { type: 'image/webp' })
    const saved = await createLiveCompanyServices(client, 'authorized-user').saveLogo('company-uuid', file)

    expect(upload).toHaveBeenCalledWith(path, file, expect.objectContaining({ contentType: 'image/webp', upsert: false }))
    expect(rpc).toHaveBeenCalledWith('company_logo_set', { p_company_id: 'company-uuid', p_storage_path: path })
    expect(saved.logoStoragePath).toBe(path)
    expect(saved.logoUrl).toContain('https://signed.example.invalid/logo')
    vi.unstubAllGlobals()
  })

  it('removes a newly uploaded logo when the permission-checked pointer update is denied', async () => {
    const record = { id: 'company-uuid', portfolio_id: 'portfolio-uuid', logo_storage_path: null }
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq']) query[method] = vi.fn(() => query)
    query.single = vi.fn().mockResolvedValue({ data: record, error: null })
    const from = vi.fn(() => query)
    const path = 'portfolio-uuid/company-uuid/logo-uuid.webp'
    const upload = vi.fn().mockResolvedValue({ data: { path }, error: null })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('Company logo update is unauthorized.') })
    const client = { from, rpc, storage: { from: vi.fn(() => ({ upload, remove })) } } as unknown as SupabaseClient
    vi.stubGlobal('crypto', { randomUUID: () => 'logo-uuid' })

    await expect(createLiveCompanyServices(client, 'unauthorized-user').saveLogo(
      'company-uuid', new File(['webp'], 'company-logo.webp', { type: 'image/webp' }),
    )).rejects.toThrow('Company logo update is unauthorized.')

    expect(remove).toHaveBeenCalledWith([path])
    expect(from).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})

