import type { SupabaseClient } from '@supabase/supabase-js'
import type { Branch, Company, CompanyStatus } from '../features/companies/types'

type BranchRow = {
  id: string; name: string; code: string; province: string; town: string
  physical_address: string; manager_name: string | null; contact_phone: string | null; status: string
}
type CompanyRow = {
  id: string; portfolio_id: string; name: string; registration_number: string; tpin: string
  industry: string; business_email: string; phone: string; province: string; town: string
  physical_address: string; contact_person: string; status: string; created_at: string
  branches: BranchRow[]
}

const toUiStatus = (value: string): CompanyStatus => value.toLowerCase() === 'inactive' ? 'Inactive' : value.toLowerCase() === 'pending' ? 'Pending' : 'Active'
const toDbStatus = (value: CompanyStatus) => value.toUpperCase()
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'GB'

function mapBranch(row: BranchRow): Branch {
  return {
    id: row.id, name: row.name, code: row.code, province: row.province, town: row.town,
    address: row.physical_address, manager: row.manager_name ?? '', phone: row.contact_phone ?? '',
    status: toUiStatus(row.status), employeeCount: 0,
  }
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id, portfolioId: row.portfolio_id, name: row.name,
    registrationNumber: row.registration_number, tpin: row.tpin, industry: row.industry,
    email: row.business_email, phone: row.phone, address: row.physical_address,
    province: row.province, town: row.town, logo: initials(row.name), contactPerson: row.contact_person,
    status: toUiStatus(row.status), employeeCount: 0, createdAt: row.created_at.slice(0, 10),
    branches: (row.branches ?? []).map(mapBranch),
  }
}

async function withEmployeeCounts(client: SupabaseClient, row: CompanyRow): Promise<Company> {
  const count = async (branchId?: string) => {
    let query = client.from('employees').select('id', { count: 'exact', head: true })
      .eq('company_id', row.id).eq('approval_status', 'APPROVED').eq('employment_status', 'ACTIVE')
    if (branchId) query = query.eq('workplace_branch_id', branchId)
    const result = await query
    if (result.error) throw result.error
    return result.count ?? 0
  }
  const mapped = mapCompany(row)
  const [companyCount, ...branchCounts] = await Promise.all([
    count(), ...mapped.branches.map((branch) => count(branch.id)),
  ])
  return {
    ...mapped,
    employeeCount: companyCount,
    branches: mapped.branches.map((branch, index) => ({ ...branch, employeeCount: branchCounts[index] ?? 0 })),
  }
}

export function createLiveCompanyServices(client: SupabaseClient, userId: string) {
  const fields = 'id,portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person,status,created_at,branches(id,name,code,province,town,physical_address,manager_name,contact_phone,status)'

  return {
    async list(): Promise<Company[]> {
      const { data, error } = await client.from('companies').select(fields).order('name')
      if (error) throw error
      return Promise.all(((data ?? []) as unknown as CompanyRow[]).map((row) => withEmployeeCounts(client, row)))
    },

    async save(company: Company, previous?: Company): Promise<Company> {
      let portfolioId = company.portfolioId ?? previous?.portfolioId
      if (!portfolioId) {
        const { data: memberships, error } = await client.from('portfolio_memberships')
          .select('portfolio_id').eq('user_id', userId).is('revoked_at', null).in('role', ['PORTFOLIO_ADMIN', 'COMPANY_ADMIN'])
        if (error) throw error
        const ids = [...new Set((memberships ?? []).map((row) => (row as { portfolio_id: string }).portfolio_id))]
        if (ids.length !== 1) throw new Error(ids.length ? 'Select a portfolio before creating a company.' : 'Your account has no active company setup access.')
        portfolioId = ids[0]
      }

      const values = {
        portfolio_id: portfolioId, name: company.name, registration_number: company.registrationNumber,
        tpin: company.tpin, industry: company.industry, business_email: company.email, phone: company.phone,
        province: company.province, town: company.town, physical_address: company.address,
        contact_person: company.contactPerson, status: toDbStatus(company.status),
      }
      const oldBranches = previous?.branches ?? []
      const currentIds = new Set(company.branches.map((branch) => branch.id))
      const branches = company.branches.map((branch) => ({
        id: oldBranches.some((old) => old.id === branch.id) ? branch.id : null,
        name: branch.name, code: branch.code, province: branch.province, town: branch.town,
        physical_address: branch.address, manager_name: branch.manager || null,
        contact_phone: branch.phone || null, status: toDbStatus(branch.status),
      }))
      const deactivatedIds = oldBranches.filter((branch) => !currentIds.has(branch.id)).map((branch) => branch.id)
      const saved = await client.rpc('company_workspace_save', {
        p_portfolio_id: portfolioId,
        p_company_id: previous ? company.id : null,
        p_company: values,
        p_branches: branches,
        p_deactivate_branch_ids: deactivatedIds,
      })
      if (saved.error) throw saved.error
      if (typeof saved.data !== 'string') throw new Error('The atomic company save returned no company ID.')
      const companyId = saved.data
      const { data, error } = await client.from('companies').select(fields).eq('id', companyId).single()
      if (error) throw error
      return withEmployeeCounts(client, data as unknown as CompanyRow)
    },

    async deactivate(companyId: string): Promise<void> {
      const { error } = await client.rpc('company_set_status', { p_company_id: companyId, p_status: 'INACTIVE' })
      if (error) throw error
    },
  }
}

