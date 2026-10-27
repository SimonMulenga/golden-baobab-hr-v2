import { createContext, useContext } from 'react'
import type { Company, Organization } from './types'

export type WorkspaceData = {
  companies: Company[]
  organizations: Organization[]
  saveCompany: (company: Company) => void
  saveOrganization: (organization: Organization) => void
  deleteCompany: (id: string) => void
  setActiveCompany: (id: string) => void
  activeCompanyId: string
}

export const WorkspaceContext = createContext<WorkspaceData | null>(null)
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace provider is missing')
  return context
}
