import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261123006800_employee_dob_only_payslip_verification.sql'), 'utf8')

describe('DOB-only payslip verification migration', () => {
  it('replaces the old signature and restricts the new RPC to service-role calls', () => {
    expect(migration).toContain('drop function if exists public.payslip_email_access_redeem(text, text, date)')
    expect(migration).toContain('create function public.payslip_email_access_redeem(\n  p_token_hash text,\n  p_date_of_birth date')
    expect(migration).toContain("auth.role() <> 'service_role'")
    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/p_employee_number|employee_number/iu)
  })

  it('preserves token expiry, revocation, attempt limits, and tenant-bound document lookup', () => {
    expect(migration).toContain('v_access.revoked_at is not null')
    expect(migration).toContain('v_access.expires_at <= now()')
    expect(migration).toContain('v_access.verification_attempts >= 5')
    expect(migration).toContain('where a.token_hash = p_token_hash')
    expect(migration).toContain('q.id = v_access.delivery_id')
    expect(migration).toContain('e.company_id = v_doc.company_id')
    expect(migration).toContain('e.portfolio_id = v_doc.portfolio_id')
    expect(migration).toContain('p_date_of_birth is distinct from v_employee.date_of_birth')
  })
})
