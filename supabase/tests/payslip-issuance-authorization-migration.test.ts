import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261123006700_scoped_payslip_issuance_authorization.sql'), 'utf8')

describe('scoped payslip issuance authorization migration', () => {
  it('keeps company administration scoped and adds branch issuance only for branch managers', () => {
    expect(migration).toMatch(/from public\.company_memberships cm[\s\S]*?cm\.company_id = p_company_id[\s\S]*?cm\.revoked_at is null/i)
    expect(migration).toMatch(/\('BRANCH_MANAGER', 'payslip\.issue'\)/i)
    expect(migration).toMatch(/ba\.branch_id = p_branch_id[\s\S]*?ba\.revoked_at is null/i)
    expect(migration).not.toMatch(/\('PAYROLL_PROCESSOR', 'payslip\.issue'\)/i)
  })

  it('derives privileged snapshots from finalized payroll and the scoped human actor', () => {
    expect(migration).toMatch(/where r\.id = p_payroll_run_id and i\.employee_id = p_employee_id and r\.status = 'FINALIZED'/i)
    expect(migration).toMatch(/p_actor_id,\s*case when p_issuance then 'payslip\.issue' else 'payroll\.view' end/i)
    expect(migration).toMatch(/revoke all on function app_private\.payslip_snapshot_for_user\(uuid,uuid,uuid,boolean\) from public, anon, authenticated/i)
    expect(migration).toMatch(/revoke all on function app_private\.payslip_actor_has_permission\(uuid,text,uuid,uuid,uuid\) from public, anon, authenticated/i)
  })

  it('does not add email or payroll writes to the authorization correction', () => {
    expect(migration).not.toMatch(/insert into public\.(payroll_runs|payroll_run_items|payslip_email_deliveries)|update public\.(payroll_runs|payroll_run_items|payslip_email_deliveries)/i)
  })
})
