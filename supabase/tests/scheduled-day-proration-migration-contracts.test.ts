import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261030004000_branch_calendar_and_scheduled_day_proration.sql'), 'utf8')

describe('approved branch calendar and scheduled-day payroll proration contract', () => {
  it('requires an approved, exact-month, branch-scoped calendar with independent review', () => {
    expect(migration).toContain('alter table public.branch_work_calendars enable row level security')
    expect(migration).toContain("status = 'APPROVED'")
    expect(migration).toContain('v.requested_by = auth.uid()')
    expect(migration).toContain('app_private.has_permission(\'branch.view\'')
    expect(migration).toContain("'MISSING_APPROVED_BRANCH_WORK_CALENDAR'")
    expect(migration).toContain('branch_work_calendar_capabilities')
    expect(migration).toContain('branch_work_calendar_request')
    expect(migration).toContain('branch_work_calendar_review')
    expect(migration).toContain("'WORK_CALENDAR_' || p_decision")
    expect(migration).toContain('The work calendar cannot change after a payroll run exists for this month.')
  })

  it('derives eligible working days from contract dates and approved schedule dates', () => {
    expect(migration).toContain('unnest(p_scheduled_dates)')
    expect(migration).toContain('v_employee.contract_start_date')
    expect(migration).toContain('v_employee.contract_end_date')
    expect(migration).toContain("'ATTENDANCE_SCHEDULE_MISMATCH'")
    expect(migration).toContain("'NO_ELIGIBLE_SCHEDULED_WORK_DAYS'")
  })

  it('blocks missing or overlapping effective compensation and versions the rounding breakdown', () => {
    expect(migration).toContain("'COMPENSATION_GAP_FOR_SCHEDULED_DAYS'")
    expect(migration).toContain("'OVERLAPPING_COMPENSATION_FOR_SCHEDULED_DAYS'")
    expect(migration).toContain('ec.basic_pay * covered.days / v_total_days')
    expect(migration).toContain("'PostgreSQL NUMERIC round to 2 decimal places (half away from zero)'")
    expect(migration).toContain("'basic_salary_proration', v_employee->'basic_salary_proration'")
  })

  it('requires explicit allowance proration and preserves the payroll approval path', () => {
    expect(migration).toContain("'ALLOWANCE_PRORATION_RULE_REQUIRED'")
    expect(migration).toContain("'SCHEDULED_DAYS'")
    expect(migration).toContain("'POSTGRES_NUMERIC_ZM_2026_V2_SCHEDULED_DAY_PRORATION'")
    expect(migration).toContain("'payroll.prepare'")
    expect(migration).toContain('payroll_calculate(uuid, text) to authenticated')
  })
})
