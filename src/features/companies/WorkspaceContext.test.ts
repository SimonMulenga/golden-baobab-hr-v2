import { createElement, useState, type PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { formatWorkspaceDate, formatWorkspaceDateTime, useCompanySelection, WorkspaceContext } from './WorkspaceContext'
import type { Company } from './types'

const testCompany = (id: string, name: string): Company => ({
  id, name, registrationNumber: '', tpin: '', industry: '', email: '', phone: '', address: '', province: '', town: '', logo: '',
  contactPerson: '', status: 'Active', employeeCount: 0, createdAt: '', branches: [],
})
const companyA = testCompany('company-a', 'QA Company A')
const companyB = testCompany('company-b', 'QA Company B')

function CompanySelectionWrapper({ children }: PropsWithChildren) {
  const [activeCompanyId, setActiveCompany] = useState('all')
  return createElement(WorkspaceContext.Provider, {
    value: { companies: [companyA, companyB], activeCompanyId, setActiveCompany, saveCompany: () => undefined, deleteCompany: () => undefined },
  }, children)
}

describe('company workspace date preferences', () => {
  it('uses the configured day-first date order and company time zone', () => {
    expect(formatWorkspaceDate('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25,
    })).toBe('30/10/2026')
  })

  it('uses ISO date order when selected', () => {
    expect(formatWorkspaceDate('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'YYYY-MM-DD', currency_code: 'ZMW', payroll_cutoff_day: 25,
    })).toBe('2026-10-30')
  })

  it('formats audit timestamps in the configured time zone', () => {
    const text = formatWorkspaceDateTime('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25,
    }, { dateStyle: 'short', timeStyle: 'short' })
    expect(text).toContain('30/10/2026')
    expect(text).toContain('01:30')
  })
})

describe('global company selection', () => {
  it('shares company changes between the dashboard and module selectors', () => {
    const { result } = renderHook(() => useCompanySelection(), { wrapper: CompanySelectionWrapper })
    expect(result.current.companyId).toBe('')
    expect(result.current.company).toBeUndefined()
    act(() => result.current.setCompanyId(companyA.id))
    expect(result.current.companyId).toBe(companyA.id)
    expect(result.current.company?.name).toBe(companyA.name)
    act(() => result.current.setCompanyId(companyB.id))
    expect(result.current.company?.name).toBe(companyB.name)
    act(() => result.current.setCompanyId(''))
    expect(result.current.companyId).toBe('')
    expect(result.current.company).toBeUndefined()
  })
})
