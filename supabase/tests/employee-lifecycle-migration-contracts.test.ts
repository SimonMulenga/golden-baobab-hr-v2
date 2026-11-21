import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261121006200_employee_lifecycle_management.sql'), 'utf8')

describe('employee lifecycle migration contract', () => {
  it('stores lifecycle requests and contract history under tenant-scoped foreign keys and RLS', () => {
    expect(migration).toContain('create table public.employee_lifecycle_requests')
    expect(migration).toContain('create table public.employee_contract_history')
    expect(migration).toContain('foreign key (portfolio_id, company_id, branch_id, employee_id)')
    expect(migration).toContain('alter table public.employee_lifecycle_requests enable row level security')
    expect(migration).toContain('alter table public.employee_contract_history enable row level security')
    expect(migration).toContain("app_private.has_permission('employee.status.manage'")
    expect(migration).toContain("app_private.has_permission('employee.approve'")
    expect(migration).toContain('v_request.requested_by=auth.uid()')
  })

  it('keeps status changes effective-dated, audited and separately reviewed', () => {
    expect(migration).toContain('employee_lifecycle_request_create')
    expect(migration).toContain('employee_lifecycle_request_review')
    expect(migration).toContain('effective_date')
    expect(migration).toContain("'EMPLOYEE_LIFECYCLE_APPROVED'")
    expect(migration).toContain("'EMPLOYEE_LIFECYCLE_REJECTED'")
    expect(migration).toContain('employee_set_employment_status(uuid,text,text) from public,anon,authenticated')
  })

  it('uses effective payroll dates and never rewrites finalized payroll output', () => {
    expect(migration).toContain('employee_payroll_date_eligibility')
    expect(migration).toContain("v_pay_classification = 'UNPAID'")
    expect(migration).toContain('PAID_SUSPENSION_POLICY_REQUIRES_REVIEW')
    expect(migration).toContain("case when r.status='FINALIZED' then 'ADJUSTMENT_REQUIRED' else 'OPEN' end")
    expect(migration).toContain('payroll_run_block_open_lifecycle_impact')
    expect(migration).not.toMatch(/delete\s+from\s+public\.payroll_run_items|truncate\s+table|drop\s+table/i)
  })

  it('flags contract expiry for review and preserves separation detail', () => {
    expect(migration).toContain("'CONTRACT_EXPIRED'")
    expect(migration).toContain("'CONTRACT_COMPLETION'")
    expect(migration).toContain('last_working_day')
    expect(migration).toContain('separation_type')
    expect(migration).not.toContain('update public.employees set employment_status = \'TERMINATED\' where contract_end_date')
  })
})

const movementReport = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261121006300_employee_lifecycle_movement_report.sql'), 'utf8')
describe('employee lifecycle movement report contract', () => {
  it('filters movement rows by authorized employee scope and effective-date range', () => {
    expect(movementReport).toContain("app_private.has_permission('employee.view'")
    expect(movementReport).toContain("app_private.has_permission('employee.status.manage'")
    expect(movementReport).toContain("app_private.has_permission('employee.approve'")
    expect(movementReport).toContain('p_date_from')
    expect(movementReport).toContain('p_date_to')
    expect(movementReport).not.toMatch(/employee_private_details|bank_account_number|basic_pay/i)
    expect(movementReport).toContain('grant execute on function public.employee_lifecycle_movement_report')
  })
})
