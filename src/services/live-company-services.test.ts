import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveCompanyServices } from './live-company-services'
import { mockCompanies } from '../features/companies/mockData'

function queryClient(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
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
})

