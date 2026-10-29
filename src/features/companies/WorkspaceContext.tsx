import { createContext, useContext } from 'react'
import type { Company } from './types'

export type WorkspacePreferences = {
  timezone: string
  date_format: 'DD/MM/YYYY' | 'YYYY-MM-DD'
  currency_code: 'ZMW'
  payroll_cutoff_day: number
}

export const defaultWorkspacePreferences: WorkspacePreferences = {
  timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25,
}

export function formatWorkspaceDate(value: string | number | Date, preferences?: WorkspacePreferences | null, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const locale = preferences?.date_format === 'YYYY-MM-DD' ? 'en-CA' : 'en-GB'
  return date.toLocaleDateString(locale, { ...options, ...(preferences ? { timeZone: preferences.timezone } : {}) })
}

export function formatWorkspaceDateTime(value: string | number | Date, preferences?: WorkspacePreferences | null, options: Intl.DateTimeFormatOptions = {}): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const locale = preferences?.date_format === 'YYYY-MM-DD' ? 'en-CA' : 'en-GB'
  return date.toLocaleString(locale, { ...options, ...(preferences ? { timeZone: preferences.timezone } : {}) })
}

export type WorkspaceData = {
  companies: Company[]
  saveCompany: (company: Company) => void | Company | Promise<void | Company>
  deleteCompany: (id: string) => void | Promise<void>
  loading?: boolean
  error?: string
  live?: boolean
  setActiveCompany: (id: string) => void
  activeCompanyId: string
  preferences?: WorkspacePreferences | null
  setPreferences?: (companyId: string, preferences: WorkspacePreferences) => void
}

export const WorkspaceContext = createContext<WorkspaceData | null>(null)
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('Workspace provider is missing')
  return context
}

export function useCompanySelection() {
  const { companies, activeCompanyId, setActiveCompany } = useWorkspace()
  const companyId = activeCompanyId === 'all' ? '' : activeCompanyId
  const company = companies.find((item) => item.id === companyId)
  const setCompanyId = (nextId: string) => setActiveCompany(nextId || 'all')
  return { companyId, company, setCompanyId }
}

