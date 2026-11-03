import { describe, expect, it } from 'vitest'
import migration from '../migrations/20261103005400_allow_portfolio_company_admin_invitation.sql?raw'

describe('portfolio-scoped Company Administrator invitation migration', () => {
  it('allows Company Administrator invitation at portfolio scope only with portfolio users.manage', () => {
    expect(migration).toMatch(/p_role = 'COMPANY_ADMIN' and p_company_id is null[\s\S]*?has_permission\('users\.manage', p_portfolio_id, null, null\)/i)
    expect(migration).toMatch(/p_role not in \('PORTFOLIO_ADMIN', 'COMPANY_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR'\)/i)
  })

  it('keeps company-scoped invitations constrained to a company in the same portfolio', () => {
    expect(migration).toMatch(/c\.id = p_company_id and c\.portfolio_id = p_portfolio_id/i)
    expect(migration).toMatch(/has_permission\('users\.manage', p_portfolio_id, p_company_id, null\)/i)
  })

  it('retains authenticated-only execution and never grants anonymous access', () => {
    expect(migration).toMatch(/revoke all on function public\.authorize_member_invitation\(uuid, text, uuid\) from public, anon/i)
    expect(migration).toMatch(/grant execute on function public\.authorize_member_invitation\(uuid, text, uuid\) to authenticated/i)
    expect(migration).not.toMatch(/grant execute[\s\S]*to anon/i)
  })
})
