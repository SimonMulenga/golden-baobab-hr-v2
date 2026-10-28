import { createContext, useContext } from 'react'
import type { Company } from './types'

export type WorkspaceData = {
  companies: Company[]
  saveCompany: (company: Company) => void | Company | Promise<void | Company>
  deleteCompany: (id: string) => void | Promise<void>
  loading?: boolean
  error?: string
  live?: boolean
  setActiveCompany: (id: string) => void
  activeCompanyId: string
}

export const WorkspaceContext = createContext<WorkspaceData | null>(null)
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace provider is missing')
  return context
}

