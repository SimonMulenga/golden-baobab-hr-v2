import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDashboardMetrics } from './live-dashboard-services'

function makeClient(respond: (table: string, options: unknown, filters: Array<[string, ...unknown[]]>) => unknown) {
  const client = { from: vi.fn((table: string) => {
    let options: unknown
    const filters: Array<[string, ...unknown[]]> = []
    const query: Record<string, unknown> = {}
    query.select = vi.fn((_fields: string, opts?: unknown) => { options = opts; return query })
    for (const method of ['in', 'eq', 'range']) query[method] = vi.fn((...args: unknown[]) => { filters.push([method, ...args]); return query })
    query.then = (resolve: (result: unknown) => unknown) => Promise.resolve(respond(table, options, filters)).then(resolve)
    return query
  }) } as unknown as SupabaseClient
  return client
}

describe('live dashboard summaries', () => {
  it('does no queries for an empty authorized company scope', async () => {
    const client = makeClient(() => { throw new Error('must not query') })
    await expect(loadDashboardMetrics(client, [])).resolves.toMatchObject({ employees: 0, finalizedPayrollTotal: null })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('filters counts by permitted branches and keeps denied financial totals unavailable', async () => {
    const client = makeClient((table, _options, filters) => {
      expect(filters).toContainEqual(['in', table === 'employees' ? 'workplace_branch_id' : table === 'payroll_run_items' ? 'payroll_runs.branch_id' : 'branch_id', ['branch-a']])
      if (table === 'payroll_run_items') return { data: null, error: new Error('RLS denied') }
      const activeFilter = filters.some(([method, field, value]) => method === 'eq' && field === 'employment_status' && value === 'ACTIVE')
      const submittedFilter = filters.some(([method, field, value]) => method === 'eq' && field === 'approval_status' && value === 'SUBMITTED_FOR_HR_APPROVAL')
      return { count: table === 'employees' ? activeFilter ? 1 : submittedFilter ? 1 : 2 : 1, data: null, error: null }
    })
    const result = await loadDashboardMetrics(client, ['company-a'], ['branch-a'])
    expect(result).toMatchObject({ employees: 2, activeEmployees: 1, pendingLeave: 1, finalizedPayrollTotal: null })
    expect(result.pendingApprovals).toBe(4)
  })

  it('does not leak a company filter into the all-authorized-company scope', async () => {
    const client = makeClient((table, _options, filters) => {
      if (table !== 'payroll_run_items') expect(filters).toContainEqual(['in', table === 'employees' ? 'workplace_branch_id' : 'branch_id', ['branch-a', 'branch-b']])
      return { count: 0, data: table === 'payroll_run_items' ? [{ net_pay: 1000 }] : null, error: null }
    })
    const result = await loadDashboardMetrics(client, ['company-a', 'company-b'], ['branch-a', 'branch-b'])
    expect(result.finalizedPayrollTotal).toBe(1000)
    expect(client.from).toHaveBeenCalledWith('employees')
  })
})
