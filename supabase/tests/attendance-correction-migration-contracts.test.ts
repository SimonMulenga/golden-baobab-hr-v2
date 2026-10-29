import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261029003700_approved_attendance_correction_workflow.sql'), 'utf8')

describe('approved attendance correction migration contract', () => {
  it('adds submitter and correction ownership without replacing existing attendance history', () => {
    expect(migration).toContain('add column submitted_by uuid')
    expect(migration).toContain('add column correction_opened_by uuid')
    expect(migration).toContain("where status in ('SUBMITTED', 'APPROVED') and submitted_by is null")
    expect(migration).toContain("update public.attendance_periods")
    expect(migration).toContain("insert into public.audit_logs")
  })

  it('requires the current company and branch attendance permission', () => {
    expect(migration).toContain("app_private.has_permission('attendance.manage', v.portfolio_id, v.company_id, v.branch_id)")
    expect(migration).toContain("app_private.has_permission('attendance.manage', (select c.portfolio_id from public.companies c where c.id=p_company_id), p_company_id, p_branch_id)")
  })

  it('only reopens approved periods with a reason and refuses any period that has a payroll run', () => {
    expect(migration).toContain("nullif(btrim(p_reason), '') is null")
    expect(migration).toContain("v.status <> 'APPROVED'")
    expect(migration).toContain('join public.payroll_runs pr')
    expect(migration).toContain("set status='RETURNED_FOR_CORRECTION'")
    expect(migration).toContain('ATTENDANCE_APPROVED_CORRECTION_REQUESTED')
    expect(migration).toContain('Serialize draft creation with correction reopening')
    expect(migration).toContain('where ap.portfolio_id=v_portfolio_id and ap.company_id=p_company_id and ap.branch_id=p_branch_id')
    expect(migration).toMatch(/where ap\.portfolio_id=v_portfolio_id[\s\S]*?for update;/)
  })

  it('records each submission and prevents its submitter from approving that version', () => {
    expect(migration).toContain("set status='SUBMITTED', submitted_by=auth.uid()")
    expect(migration).toContain('coalesce(v.submitted_by,v.created_by)=auth.uid()')
  })

  it('exposes only the scoped capability and mutation RPCs to authenticated users', () => {
    expect(migration).toContain('revoke all on function public.attendance_request_approved_correction(uuid,text) from public,anon')
    expect(migration).toContain('grant execute on function public.attendance_request_approved_correction(uuid,text) to authenticated')
    expect(migration).not.toMatch(/grant execute on function public\.attendance_request_approved_correction\([^\n]+ to (?:public|anon)/i)
  })
})
