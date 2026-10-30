import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261030004200_simplified_branch_payroll_and_inputs.sql?raw'
import hardeningMigration from '../../../supabase/migrations/20261030004300_retire_calendar_rpcs_and_restrict_internal_trigger.sql?raw'
import editableScheduleMigration from '../../../supabase/migrations/20261030004400_honor_editable_attendance_schedule.sql?raw'


describe('simplified payroll migration security contract', () => {
  it('grants branch managers payroll preparation only through the assigned-branch permission resolver', () => {
    const permissions = migration.slice(migration.indexOf('create or replace function app_private.has_permission'))
    expect(permissions).toContain("('BRANCH_MANAGER', 'payroll.prepare')")
    expect(permissions).toContain("('BRANCH_MANAGER', 'payroll.submit')")
    expect(permissions).not.toContain("('BRANCH_MANAGER', 'payroll.approve')")
    expect(permissions).not.toContain("('BRANCH_MANAGER', 'payroll.finalize')")
    expect(permissions).toContain('ba.branch_id = p_branch_id')
  })

  it('allows saved attendance entries to feed payroll without an approved work calendar', () => {
    expect(migration).toContain("v_attendance.status not in ('APPROVED', 'DRAFT')")
    expect(migration).toContain("v_attendance.status not in ('APPROVED','DRAFT')")
    expect(migration).toContain('extract(isodow from scheduled_date) between 1 and 5')
    expect(migration).not.toContain("'MISSING_APPROVED_BRANCH_WORK_CALENDAR'")
  })

  it('records earnings for the final payroll review instead of a separate approval queue', () => {
    expect(migration).toContain("status set default 'RECORDED'")
    expect(migration).toContain("pi.status in ('APPROVED','RECORDED')")
    expect(migration).toContain("new.action := 'RECORDED'")
  })

  it('allows one-step independent payroll approval and retains creator self-approval denial', () => {
    const review = migration.slice(migration.indexOf('create or replace function public.payroll_review_submission'))
    expect(review).toContain("v.created_by = auth.uid()")
    expect(review).toContain("v.status not in ('SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW')")
    expect(review).toContain("has_permission('payroll.approve'")
    expect(review).toContain("v_status := case p_action when 'APPROVE' then 'APPROVED'")
  })

  it('removes client execution grants from retired calendar RPCs and the trigger-only helper', () => {
    expect(hardeningMigration).toContain('public.branch_work_calendar_request')
    expect(hardeningMigration).toContain('public.branch_work_calendar_review')
    expect(hardeningMigration).toContain('public.branch_work_calendar_capabilities')
    expect(hardeningMigration).toContain('app_private.normalize_new_earning_history')
    expect(hardeningMigration.match(/revoke all on function/g)).toHaveLength(4)
    expect(hardeningMigration).not.toMatch(/grant execute/i)
  })
})

describe('editable monthly attendance schedule contract', () => {
  it('uses the saved attendance entry without rejecting a schedule adjustment', () => {
    expect(editableScheduleMigration).toContain('payroll_preview_inputs_legacy')
    expect(editableScheduleMigration).toContain('payroll_employee_proration')
    expect(editableScheduleMigration).not.toContain('ATTENDANCE_SCHEDULE_MISMATCH')
    expect(editableScheduleMigration).toContain("'MISSING_EFFECTIVE_COMPENSATION'")
    expect(editableScheduleMigration).toContain("'COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD'")
    expect(editableScheduleMigration).toContain("grant execute on function public.payroll_preview_inputs(uuid, uuid, date, date) to authenticated")
  })
})
