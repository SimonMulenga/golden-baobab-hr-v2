import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8')

describe('pending migrations 028 and 029 security contracts', () => {
  it('preserves a compatible employee document bucket and rejects incompatible settings', () => {
    const sql = migration('20261029002800_hr_configuration_employee_documents.sql')
    expect(sql).toMatch(/on conflict\s*\(id\)\s*do nothing/i)
    expect(sql).not.toMatch(/on conflict\s*\(id\)\s*do update/i)
    expect(sql).toMatch(/b\.public is false[\s\S]*b\.file_size_limit=15728640[\s\S]*cardinality\(b\.allowed_mime_types\)=3/i)
    expect(sql).toMatch(/incompatible privacy, size, or MIME settings/i)
  })

  it('guards the document bucket against broader Storage policies and anonymous access', () => {
    const sql = migration('20261029002800_hr_configuration_employee_documents.sql')
    for (const action of ['read', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`employee_documents_storage_${action}_guard[\\s\\S]*?as restrictive`, 'i'))
      expect(sql).toContain(`employee_documents_storage_anon_${action}_guard`)
    }
    expect(sql).toContain("app_private.has_permission('employee.private.view'")
    expect(sql).toContain("app_private.has_permission('employee.create'")
    expect(sql).toContain('owner_id=auth.uid()::text')
  })

  it('checks enabled leave policy overlaps within company/type and serializes saves', () => {
    const sql = migration('20261029002900_attendance_leave_calendar_workflows.sql')
    expect(sql).toMatch(/lp\.portfolio_id=v_company\.portfolio_id[\s\S]*lp\.company_id=v_company\.id[\s\S]*lp\.leave_type=btrim\(p_leave_type\)[\s\S]*lp\.enabled/i)
    expect(sql).toMatch(/daterange\(lp\.effective_from,lp\.effective_to,'\[\]'\)[\s\S]*daterange\(p_effective_from,p_effective_to,'\[\]'\)/i)
    expect(sql).toMatch(/from public\.companies where id=p_company_id for update/i)
    expect(sql).toContain("errcode='23P01'")
  })

  it('replaces only known legacy leave constraints and keeps accrual idempotent', () => {
    const sql = migration('20261029002900_attendance_leave_calendar_workflows.sql')
    expect(sql).toContain('drop constraint leave_requests_status_check')
    expect(sql).toContain('drop constraint leave_requests_check1')
    expect(sql).not.toMatch(/for c in select conname[\s\S]*?pg_get_constraintdef/i)
    expect(sql).toContain("revoke all on function public.leave_create_request(uuid,uuid,uuid,uuid,text,text,date,date,numeric,text,text) from authenticated")
    expect(sql).toContain('revoke all on function public.leave_policy_save(uuid,uuid,text,text,numeric,numeric,date,date) from public,anon,authenticated')
    expect(sql).toContain('revoke all on function public.leave_review_request(uuid,text,text) from public,anon,authenticated')
    expect(sql).toContain('leave_accrue_month_legacy')
    expect(sql).toContain('on conflict(portfolio_id,company_id,employee_id,leave_policy_id,event_type,reference_id) do nothing')
  })

  it('does not expose the revoked legacy leave RPCs through the generic business adapter', () => {
    const adapter = readFileSync(resolve(process.cwd(), 'src', 'services', 'live-business-services.ts'), 'utf8')
    expect(adapter).not.toContain("rpc('leave_create_request'")
    expect(adapter).not.toContain("rpc('leave_review_request'")
    expect(adapter).not.toContain("rpc('leave_policy_save'")
  })

  it('scopes payroll approval to a company membership and keeps the approver out of portfolio roles', () => {
    const sql = migration('20261029003300_company_scoped_payroll_approver.sql')
    expect(sql).toContain("check (role in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_APPROVER'))")
    expect(sql).toContain("('COMPANY_PAYROLL_APPROVER', 'payroll.approve')")
    expect(sql).toContain("('COMPANY_PAYROLL_APPROVER', 'payroll.finalize')")
    expect(sql).toMatch(/cm\.company_id = p_company_id[\s\S]*cm\.user_id = auth\.uid\(\)[\s\S]*cm\.revoked_at is null/i)
    expect(sql).toMatch(/assign_company_payroll_approver[\s\S]*has_permission\('users\.manage', p_portfolio_id, p_company_id, null\)/i)
    expect(sql).toMatch(/assign_company_payroll_approver[\s\S]*p_user_id = auth\.uid\(\)/i)
    expect(sql).not.toContain("('COMPANY_PAYROLL_APPROVER', 'users.manage')")
  })

  it('keeps the HR/payroll preparer company-scoped and explicitly denies approval permissions', () => {
    const sql = migration('20261029003400_company_scoped_payroll_preparer.sql')
    expect(sql).toContain("check (role in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_PREPARER', 'COMPANY_PAYROLL_APPROVER'))")
    expect(sql).toContain("('COMPANY_PAYROLL_PREPARER', 'compensation.edit')")
    expect(sql).toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.prepare')")
    expect(sql).toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.submit')")
    expect(sql).not.toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.approve')")
    expect(sql).not.toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.finalize')")
    expect(sql).toMatch(/cm\.company_id = p_company_id[\s\S]*cm\.user_id = auth\.uid\(\)[\s\S]*cm\.revoked_at is null/i)
  })
})

describe('department activation migration security contract', () => {
  it('restricts activation to the current authorized company manager and audits the state change', () => {
    const sql = migration('20261029003500_department_activation_workflow.sql')
    expect(sql).toMatch(/create or replace function public\.department_activate\(p_department_id uuid\)/i)
    expect(sql).toMatch(/security definer[\s\S]*set row_security\s*=\s*off/i)
    expect(sql).toContain('auth.uid() is null')
    expect(sql).toContain('app_private.can_manage_company_hr_configuration(v_department.company_id)')
    expect(sql).toContain("set status = 'ACTIVE'")
    expect(sql).toContain("'DEPARTMENT_ACTIVATED'")
    expect(sql).toContain('revoke all on function public.department_activate(uuid) from public, anon')
    expect(sql).toContain('grant execute on function public.department_activate(uuid) to authenticated')
  })
})
