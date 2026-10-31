export type WorkspaceRole = 'PORTFOLIO_ADMIN' | 'PORTFOLIO_COMPANY_ADMIN' | 'OVERALL_HR_MANAGER' | 'BRANCH_MANAGER' | 'COMPANY_ADMIN' | 'COMPANY_PAYROLL_APPROVER' | 'COMPANY_PAYROLL_REVIEWER' | 'COMPANY_PAYROLL_PREPARER' | 'PAYROLL_PROCESSOR'

export function mergeWorkspaceRoles(portfolioRoles: string[], companyRoles: string[]): WorkspaceRole[] {
  const mappedPortfolioRoles = portfolioRoles.map((role) => role === 'COMPANY_ADMIN' ? 'PORTFOLIO_COMPANY_ADMIN' : role as WorkspaceRole)
  return [...new Set([...mappedPortfolioRoles, ...companyRoles as WorkspaceRole[]])]
}

export function visibleWorkspaceRoutes(roles: WorkspaceRole[]): Set<string> {
  const routes = new Set<string>(['/'])
  if (roles.includes('PORTFOLIO_COMPANY_ADMIN')) {
    ['/companies', '/branches', '/users'].forEach((path) => routes.add(path))
    routes.add('/companies/new')
  }
  if (roles.includes('PORTFOLIO_ADMIN') || roles.includes('COMPANY_ADMIN')) {
    ['/companies', '/branches', '/users', '/audit', '/settings', '/notifications'].forEach((path) => routes.add(path))
    if (roles.includes('PORTFOLIO_ADMIN')) routes.add('/companies/new')
  }
  if (roles.includes('OVERALL_HR_MANAGER')) {
    ['/employees', '/employee-approvals', '/departments', '/job-roles', '/attendance', '/leave', '/payroll', '/payslips', '/reconciliation', '/deductions', '/statutory', '/reports', '/audit', '/notifications'].forEach((path) => routes.add(path))
  }
  if (roles.includes('BRANCH_MANAGER')) ['/employees', '/attendance', '/leave', '/payroll', '/deductions', '/payslips', '/reports'].forEach((path) => routes.add(path))
  if (roles.some((role) => ['COMPANY_PAYROLL_APPROVER', 'COMPANY_PAYROLL_REVIEWER', 'COMPANY_PAYROLL_PREPARER', 'PAYROLL_PROCESSOR'].includes(role))) {
    ['/employees', '/payroll', '/payslips', '/reports'].forEach((path) => routes.add(path))
  }
  return routes
}

export function roleCanOpenPath(routes: Set<string>, path: string): boolean {
  if ((path === '/companies/new' || path.startsWith('/companies/new/')) && !routes.has('/companies/new')) return false
  return [...routes].some((allowed) => path === allowed || (allowed !== '/' && path.startsWith(`${allowed}/`)))
}
