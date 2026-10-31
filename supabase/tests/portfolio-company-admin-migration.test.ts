import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261031004600_portfolio_company_administrator.sql'), 'utf8')

describe('portfolio Company Administrator migration contract', () => {
  it('adds only the company and branch setup permissions to the portfolio role', () => {
    expect(migration).toContain("('COMPANY_ADMIN', 'company.create')")
    expect(migration).toContain("'company.view', 'company.create', 'company.edit', 'branch.view', 'branch.create', 'branch.edit', 'users.view', 'users.manage'")
    expect(migration).not.toContain("pm.role <> 'COMPANY_ADMIN' or p_company_id is null")
    const scopedAllowlist = migration.match(/pm\.role <> 'COMPANY_ADMIN' or p_permission in \(\s*([^)]*)\)/s)?.[1] ?? ''
    expect(scopedAllowlist).toContain("'users.manage'")
    expect(scopedAllowlist).not.toMatch(/employee|compensation|payroll|attendance|leave|reports/i)
  })

  it('limits user assignment and invitation to HR managers and branch managers', () => {
    expect(migration).toContain("new.role not in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER')")
    expect(migration).toContain("new.role <> 'BRANCH_MANAGER'")
    expect(migration).toContain("p_role not in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER')")
    expect(migration).toContain("pm.role in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER')")
    expect(migration).toContain("or role in ('OVERALL_HR_MANAGER', 'BRANCH_MANAGER')")
    expect(migration).toContain('Invitation company is outside the authorized portfolio.')
  })

  it('preserves company-scoped legacy permissions while denying portfolio payroll administration', () => {
    expect(migration).toContain("join role_permissions rp on rp.role = cm.role and rp.permission = p_permission")
    expect(migration).toContain("'COMPANY_ADMIN', 'employee.create'")
    expect(migration).toContain("'COMPANY_ADMIN', 'users.manage'")
    expect(migration).toContain("app_private.has_portfolio_role(p_portfolio_id, 'COMPANY_ADMIN')")
  })

  it('bootstraps only an empty portfolio using a confirmed existing account and records a system audit event', () => {
    expect(migration).toContain('bootstrap_first_company_administrator')
    expect(migration).toContain('email_confirmed_at')
    expect(migration).toContain('actor_id, actor_kind, action')
    expect(migration).toContain("null, 'SYSTEM', 'COMPANY_ADMIN_BOOTSTRAPPED'")
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('exists (select 1 from public.companies where portfolio_id = p_portfolio_id)')
    expect(migration).toContain('exists (select 1 from public.portfolio_memberships where portfolio_id = p_portfolio_id)')
  })
})
