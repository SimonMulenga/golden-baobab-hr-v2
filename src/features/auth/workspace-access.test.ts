import { describe, expect, it } from 'vitest'
import { mergeWorkspaceRoles, roleCanOpenPath, visibleWorkspaceRoutes } from './workspace-access'

describe('role scoped navigation', () => {
  it('keeps portfolio and company-scoped Company Administrator roles distinct', () => {
    expect(mergeWorkspaceRoles(['COMPANY_ADMIN'], [])).toEqual(['PORTFOLIO_COMPANY_ADMIN'])
    expect(mergeWorkspaceRoles([], ['COMPANY_ADMIN'])).toEqual(['COMPANY_ADMIN'])
  })

  it('gives portfolio and portfolio Company Administrators the same routes', () => {
    const portfolioAdminRoutes = visibleWorkspaceRoutes(['PORTFOLIO_ADMIN'])
    const companyAdminRoutes = visibleWorkspaceRoutes(['PORTFOLIO_COMPANY_ADMIN'])
    expect([...companyAdminRoutes].sort()).toEqual([...portfolioAdminRoutes].sort())
    expect(roleCanOpenPath(companyAdminRoutes, '/companies/new')).toBe(true)
    expect(roleCanOpenPath(companyAdminRoutes, '/employees')).toBe(true)
    expect(roleCanOpenPath(companyAdminRoutes, '/payroll')).toBe(true)
    expect(roleCanOpenPath(companyAdminRoutes, '/audit')).toBe(true)
  })

  it('shows all administrator workflows to a company-scoped administrator but leaves company registration portfolio-scoped', () => {
    const routes = visibleWorkspaceRoutes(['COMPANY_ADMIN'])
    expect(roleCanOpenPath(routes, '/companies/new')).toBe(false)
    expect(roleCanOpenPath(routes, '/companies')).toBe(true)
    expect(roleCanOpenPath(routes, '/branches')).toBe(true)
    expect(roleCanOpenPath(routes, '/employees')).toBe(true)
    expect(roleCanOpenPath(routes, '/attendance')).toBe(true)
    expect(roleCanOpenPath(routes, '/leave')).toBe(true)
    expect(roleCanOpenPath(routes, '/payroll')).toBe(true)
    expect(roleCanOpenPath(routes, '/payslips')).toBe(true)
    expect(roleCanOpenPath(routes, '/reports')).toBe(true)
    expect(roleCanOpenPath(routes, '/users')).toBe(true)
    expect(roleCanOpenPath(routes, '/audit')).toBe(true)
  })

  it('keeps HR workflows but hides super administrator setup', () => {
    const routes = visibleWorkspaceRoutes(['OVERALL_HR_MANAGER'])
    expect(roleCanOpenPath(routes, '/employees/import')).toBe(true)
    expect(roleCanOpenPath(routes, '/employee-approvals')).toBe(true)
    expect(roleCanOpenPath(routes, '/companies/new')).toBe(false)
    expect(roleCanOpenPath(routes, '/users')).toBe(false)
  })

  it('limits branch managers to branch operations and payroll preparation', () => {
    const routes = visibleWorkspaceRoutes(['BRANCH_MANAGER'])
    expect(roleCanOpenPath(routes, '/employees/new')).toBe(true)
    expect(roleCanOpenPath(routes, '/attendance')).toBe(true)
    expect(roleCanOpenPath(routes, '/payroll')).toBe(true)
    expect(roleCanOpenPath(routes, '/employee-approvals')).toBe(false)
    expect(roleCanOpenPath(routes, '/companies')).toBe(false)
    expect(roleCanOpenPath(routes, '/users')).toBe(false)
  })
})
