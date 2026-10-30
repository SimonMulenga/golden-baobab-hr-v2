export type WorkspaceRole = 'PORTFOLIO_ADMIN' | 'OVERALL_HR_MANAGER' | 'BRANCH_MANAGER' | 'COMPANY_ADMIN' | 'COMPANY_PAYROLL_APPROVER' | 'COMPANY_PAYROLL_REVIEWER' | 'COMPANY_PAYROLL_PREPARER' | 'PAYROLL_PROCESSOR'

export function visibleWorkspaceRoutes(roles: WorkspaceRole[]): Set<string> {
  const routes = new Set<string>(['/'])
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
  return [...routes].some((allowed) => path === allowed || (allowed !== '/' && path.startsWith(`${allowed}/`)))
}
