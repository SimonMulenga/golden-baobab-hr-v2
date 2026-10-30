import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261029003800_audited_employee_compensation_changes.sql'), 'utf8')

describe('audited approved employee and compensation change migration contract', () => {
  it('keeps request payloads behind RLS and permission-checked RPCs', () => {
    expect(migration).toContain('alter table public.employee_change_requests enable row level security')
    expect(migration).toContain('revoke all on public.employee_change_requests from public, anon, authenticated')
    expect(migration).toContain("app_private.has_permission('employee.edit'")
    expect(migration).toContain("app_private.has_permission('compensation.edit'")
    expect(migration).toContain("app_private.has_permission('compensation.view'")
    expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete|all)\s+on\s+public\.employee_change_requests\s+to\s+authenticated/i)
  })

  it('requires approved, active employees and prevents duplicate pending requests', () => {
    expect(migration).toContain("v_employee.approval_status <> 'APPROVED'")
    expect(migration).toContain("v_employee.employment_status = 'TERMINATED'")
    expect(migration).toContain("r.status = 'PENDING'")
    expect(migration).toContain('Resolve the existing pending employee change')
    expect(migration).toContain("'latest_request', (select jsonb_build_object('status', r.status")
  })

  it('supports audited personal and employment corrections without exposing request-row writes', () => {
    expect(migration).toContain("'first_name', 'middle_name', 'last_name', 'date_of_birth', 'gender', 'nationality'")
    expect(migration).toContain("v_request.employment_changes ?| array['first_name', 'middle_name', 'last_name', 'date_of_birth', 'gender', 'nationality']")
    expect(migration).toContain("upper(v_employment ->> 'gender') not in ('MALE', 'FEMALE')")
    expect(migration).toContain("'EMPLOYEE_CHANGE_' || p_decision")
    expect(migration).not.toMatch(/details\s*,\s*jsonb_build_object\([^\n]*first_name|details\s*,\s*jsonb_build_object\([^\n]*basic_pay/i)
    expect(migration).toContain("r.employment_changes else r.employment_changes - 'private_details'")
    expect(migration).toContain("not app_private.has_permission('employee.private.view'")
    expect(migration).toContain('update public.employee_private_details set')
  })

  it('requires a different authorized reviewer and records a reason for returned or rejected changes', () => {
    expect(migration).toContain('v_request.requested_by = auth.uid()')
    expect(migration).toContain("app_private.has_permission('employee.approve'")
    expect(migration).toContain("p_decision <> 'APPROVE' and nullif(btrim(p_reason), '') is null")
    expect(migration).toContain("'EMPLOYEE_CHANGE_' || p_decision")
  })

  it('versions compensation and blocks retroactive changes across any payroll run', () => {
    expect(migration).toContain('set effective_to = v_effective_from - 1')
    expect(migration).toContain('insert into public.employee_compensation')
    expect(migration).toContain('join public.payroll_periods p on p.id = r.payroll_period_id')
    expect(migration).toContain('p.period_end >= v_effective_from')
    expect(migration).toContain('v_request.base_compensation_id')
    expect(migration).toContain('Contract dates cannot change after this employee has payroll history')
    expect(migration).toContain('from public.payroll_run_items pri')
  })

  it('validates and preserves scheduled-days allowance rules during new employee creation', () => {
    expect(migration).toContain('create or replace function public.employee_create_draft(')
    expect(migration).toContain('allowance_proration_rules, payment_method, created_by')
    expect(migration).toContain("p_compensation -> 'allowance_proration_rules'")
    expect(migration).toContain("Allowance proration must use the supported scheduled-days method.")
  })

  it('grants only authenticated execution of the RPC interface', () => {
    expect(migration).toContain('grant execute on function public.employee_change_request_create(uuid, jsonb, jsonb, text) to authenticated')
    expect(migration).toContain('grant execute on function public.employee_change_capabilities(uuid) to authenticated')
    expect(migration).not.toMatch(/grant execute on function public\.employee_change_request_(?:create|review)[^\n]+ to (?:public|anon)/i)
  })
})
