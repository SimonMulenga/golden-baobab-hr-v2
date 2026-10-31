import { describe, expect, it } from 'vitest'
import { mergeWorkspaceRoles, roleCanOpenPath, visibleWorkspaceRoutes } from './workspace-access'

describe('role scoped navigation', () => {
  it('keeps portfolio and company-scoped Company Administrator roles distinct', () => {
    expect(mergeWorkspaceRoles(['COMPANY_ADMIN'], [])).toEqual(['PORTFOLIO_COMPANY_ADMIN'])
    expect(mergeWorkspaceRoles([], ['COMPANY_ADMIN'])).toEqual(['COMPANY_ADMIN'])
  })

  it('keeps company setup with the company administrator', () => {
    const routes = visibleWorkspaceRoutes(['PORTFOLIO_ADMIN'])
    expect(roleCanOpenPath(routes, '/companies/new')).toBe(true)
    expect(roleCanOpenPath(routes, '/users')).toBe(true)
    expect(roleCanOpenPath(routes, '/employees')).toBe(false)
    expect(roleCanOpenPath(routes, '/payroll')).toBe(false)
  })

  it('limits the portfolio Company Administrator to company, branch, and HR/branch-user setup', () => {
    const routes = visibleWorkspaceRoutes(['PORTFOLIO_COMPANY_ADMIN'])
    expect(roleCanOpenPath(routes, '/companies/new')).toBe(true)
    expect(roleCanOpenPath(routes, '/companies')).toBe(true)
    expect(roleCanOpenPath(routes, '/branches')).toBe(true)
    expect(roleCanOpenPath(routes, '/users')).toBe(true)
    expect(roleCanOpenPath(routes, '/employees')).toBe(false)
    expect(roleCanOpenPath(routes, '/payroll')).toBe(false)
    expect(roleCanOpenPath(routes, '/audit')).toBe(false)
    expect(roleCanOpenPath(routes, '/settings')).toBe(false)
  })

  it('does not let a company-scoped Company Administrator create portfolio companies', () => {
    const routes = visibleWorkspaceRoutes(['COMPANY_ADMIN'])
    expect(roleCanOpenPath(routes, '/companies/new')).toBe(false)
    expect(roleCanOpenPath(routes, '/companies')).toBe(true)
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
