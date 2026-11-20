import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261120005500_secure_employee_import_staging.sql?raw'

describe('secure employee import staging migration contract', () => {
  it('is additive and retains the existing portfolio/company/branch and employee approval model', () => {
    expect(migration).toMatch(/create table public\.employee_import_batches/i)
    expect(migration).toMatch(/create table public\.employee_import_staging_records/i)
    expect(migration).toMatch(/valid_records integer not null/i)
    expect(migration).toMatch(/reviewed_records integer not null/i)
    expect(migration).toMatch(/ready_records integer not null/i)
    expect(migration).toMatch(/approved_records integer not null/i)
    expect(migration).toMatch(/foreign key \(portfolio_id, company_id, branch_id\) references public\.branches/i)
    expect(migration).toMatch(/public\.employee_import_atomic\(/i)
    expect(migration).toMatch(/employee_import_submit_staged/i)
    expect(migration).toMatch(/SUBMITTED_FOR_APPROVAL/i)
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table|schema|function)\b/i)
  })

  it('enforces RLS, denies direct client writes, and checks private-detail permission for staged data', () => {
    expect(migration).toMatch(/alter table public\.employee_import_staging_records enable row level security/i)
    expect(migration).toMatch(/employee\.private\.view/i)
    expect(migration).toMatch(/revoke all on public\.employee_import_batches, public\.employee_import_staging_records/i)
    expect(migration).toMatch(/grant select on public\.employee_import_batches, public\.employee_import_staging_records/i)
    expect(migration).toMatch(/grant execute on function public\.employee_import_stage_batch[\s\S]*?to authenticated/i)
  })

  it('pins security-definer procedures to pg_catalog and row-security-off checks', () => {
    const functions = ['employee_import_stage_batch','employee_import_stage_review','employee_import_submit_staged','employee_import_sync_approval_status']
    for (const name of functions) {
      const body = migration.slice(migration.indexOf(`function public.${name}`))
      expect(body.slice(0, body.indexOf('as $$'))).toMatch(/security definer[\s\S]*?set search_path = pg_catalog set row_security = off/i)
    }
    expect(migration).toMatch(/app_private\.has_permission\('employee\.create'/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.import'/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.submit'/i)
  })

  it('keeps employee updates and compensation approval in the existing workflow', () => {
    expect(migration).toMatch(/'operation','CREATE'/i)
    expect(migration).toMatch(/review_status='SUBMITTED_FOR_APPROVAL'/i)
    expect(migration).toMatch(/employee_review_submission/i) // status synchronization is driven by that existing employee approval transition
    expect(migration).toMatch(/after update of approval_status on public\.employees/i)
    expect(migration).not.toMatch(/update public\.employee_compensation/i)
  })
})
