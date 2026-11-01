import { describe, expect, it } from 'vitest'
import migration from '../migrations/20261031004900_unified_administrator_capabilities.sql?raw'

describe('unified administrator capability migration', () => {
  it('maps both administrator identifiers to the same permission set', () => {
    const portfolioPermissions = [...migration.matchAll(/\('PORTFOLIO_ADMIN', '([^']+)'\)/g)].map((match) => match[1])
    expect(new Set(portfolioPermissions).size).toBeGreaterThan(30)
    expect(migration).toMatch(/select 'COMPANY_ADMIN', permission from role_permissions where role = 'PORTFOLIO_ADMIN'/i)
    expect(migration).toMatch(/pm\.role in \('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'COMPANY_ADMIN'\)/i)
    expect(migration).toMatch(/leave\.policy\.manage/)
    expect(migration).toMatch(/payroll\.finalize/)
    expect(migration).toMatch(/users\.manage/)
  })

  it('keeps company memberships limited to their company and branch assignments limited to their company and branch', () => {
    expect(migration).toMatch(/c\.id = p_company_id and c\.portfolio_id = p_portfolio_id/i)
    expect(migration).toMatch(/b\.id = p_branch_id and b\.portfolio_id = p_portfolio_id/i)
    expect(migration).toMatch(/pm\.portfolio_id = p_portfolio_id and pm\.user_id = auth\.uid\(\) and pm\.revoked_at is null/i)
    expect(migration).toMatch(/cm\.company_id = p_company_id[\s\S]*?cm\.user_id = auth\.uid\(\) and cm\.revoked_at is null/i)
    expect(migration).toMatch(/p_company_id is not null and exists \([\s\S]*?from public\.company_memberships cm/i)
    expect(migration).toMatch(/ba\.company_id = p_company_id[\s\S]*?ba\.revoked_at is null and \(p_branch_id is null or ba\.branch_id = p_branch_id\)/i)
    expect(migration).not.toMatch(/row_security\s*=\s*off[\s\S]{0,30}bypass/i)
    expect(migration).not.toMatch(/grant\s+.*service_role/i)
  })

  it('removes old asymmetric role filters and protects the last active portfolio and company administrators', () => {
    expect(migration).toMatch(/drop trigger if exists company_admin_portfolio_membership_guard/i)
    expect(migration).toMatch(/drop trigger if exists company_admin_branch_assignment_guard/i)
    expect(migration).toMatch(/prevent_last_portfolio_administrator_removal/i)
    expect(migration).toMatch(/The last active portfolio administrator cannot be removed/i)
    expect(migration).toMatch(/prevent_last_company_administrator_removal/i)
    expect(migration).toMatch(/The last active company administrator cannot be removed/i)
    expect(migration).toMatch(/for update/i)
  })

  it('allows company administrators to manage only users and branch assignments in their company', () => {
    expect(migration).toMatch(/company_branch_role_directory\(p_portfolio_id uuid, p_company_id uuid\)/i)
    expect(migration).toMatch(/has_permission\('users\.manage', p_portfolio_id, p_company_id, null\)/i)
    expect(migration).toMatch(/ba\.company_id = p_company_id[\s\S]*?ba\.revoked_at is null/i)
    expect(migration).toMatch(/revoke_company_branch_role_assignments\(uuid, uuid, uuid, text, text\).*to authenticated/is)
    expect(migration).toMatch(/p_role in \('BRANCH_MANAGER', 'PAYROLL_PROCESSOR'\)/i)
    expect(migration).toMatch(/Overall HR Manager invitations require portfolio-wide administrator authority/i)
  })

  it('retains authenticated audited administration entry points and independent payroll controls', () => {
    expect(migration).toMatch(/has_permission\('users\.manage', p_portfolio_id, null, null\)/i)
    expect(migration).toMatch(/portfolio_membership_directory\(uuid\).*to authenticated/is)
    expect(migration).toMatch(/authorize_member_invitation\(uuid, text, uuid\).*to authenticated/is)
    expect(migration).toMatch(/leave_policy_save\(uuid, uuid, text, text, numeric, numeric, date, date\).*to authenticated/is)
    expect(migration).toMatch(/leave_accrue_month\(uuid, date\).*to authenticated/is)
    expect(migration).toMatch(/payroll\.finalize/)
    expect(migration).toMatch(/prevent_last_portfolio_administrator_removal/)
  })

  it('preserves January leave carry-forward and idempotent accrual behavior', () => {
    expect(migration).toMatch(/if extract\(month from p_period_start\) = 1 then\s+perform public\.leave_apply_carry_forward\(p_policy_id, extract\(year from p_period_start\)::integer\)/i)
    expect(migration).toMatch(/on conflict \(portfolio_id, company_id, employee_id, leave_policy_id, event_type, reference_id\) do nothing/i)
    expect(migration).toMatch(/leave_balance_ledger[\s\S]*?LEAVE_MONTH_ACCRUED/i)
  })
})
