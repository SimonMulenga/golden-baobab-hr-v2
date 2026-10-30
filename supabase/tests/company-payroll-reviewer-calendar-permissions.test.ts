import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20261030004100_company_payroll_reviewer_and_calendar_permission.sql'
const migration = readFileSync(resolve(process.cwd(), migrationPath), 'utf8')
const payrollReview = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261028000500_trusted_workflows.sql'), 'utf8')
const employeeChangeReview = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261029003800_audited_employee_compensation_changes.sql'), 'utf8')

const reviewerTuple = migration.match(/\('COMPANY_PAYROLL_REVIEWER',[\s\S]*?\('COMPANY_ADMIN', 'reports\.export'/)?.[0] ?? ''
const branchManagerTuple = migration.match(/\('BRANCH_MANAGER',[\s\S]*?\('PAYROLL_PROCESSOR'/)?.[0] ?? ''

describe('migration 041 company payroll reviewer and calendar permissions', () => {
  it('gives the reviewer only company-scoped payroll read/review/approve permissions', () => {
    expect(migration).toContain("check (role in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_PREPARER', 'COMPANY_PAYROLL_APPROVER', 'COMPANY_PAYROLL_REVIEWER'))")
    for (const permission of ['company.view', 'branch.view', 'employee.view', 'payroll.view', 'payroll.review', 'payroll.approve']) {
      expect(reviewerTuple).toContain(`('COMPANY_PAYROLL_REVIEWER', '${permission}')`)
    }
    for (const permission of ['payroll.finalize', 'payroll.prepare', 'payroll.submit', 'payroll.edit', 'employee.edit', 'employee.create', 'compensation.edit', 'users.manage', 'reports.view']) {
      expect(reviewerTuple).not.toContain(`('COMPANY_PAYROLL_REVIEWER', '${permission}')`)
    }
  })

  it('keeps company identity checks and memberships scoped to the supplied company', () => {
    expect(migration).toContain('where c.id = p_company_id and c.portfolio_id = p_portfolio_id')
    expect(migration).toContain('where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id')
    expect(migration).toContain("not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null)")
    expect(migration).toContain('public.assign_company_payroll_reviewer')
    expect(migration).toContain('public.revoke_company_payroll_reviewer')
    expect(migration).toContain('public.company_payroll_reviewer_members')
    expect(migration).toContain("'COMPANY_PAYROLL_REVIEWER_ASSIGNED'")
    expect(migration).toContain("'COMPANY_PAYROLL_REVIEWER_REVOKED'")
  })

  it('preserves permissions for the already-supported portfolio and company roles', () => {
    expect(migration).toContain("('OVERALL_HR_MANAGER', 'payroll.finalize')")
    expect(migration).toContain("('PORTFOLIO_ADMIN', 'payroll.finalize')")
    expect(migration).toContain("('COMPANY_PAYROLL_APPROVER', 'payroll.finalize')")
    expect(migration).toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.prepare')")
    expect(migration).toContain("('COMPANY_PAYROLL_PREPARER', 'payroll.submit')")
    expect(migration).toContain("('BRANCH_MANAGER', 'employee.edit')")
    expect(migration).toContain("('BRANCH_MANAGER', 'compensation.edit')")
    expect(migration).not.toContain("('BRANCH_MANAGER', 'employee.approve')")
  })

  it('does not grant general branch administration to branch managers', () => {
    expect(branchManagerTuple).toContain("('BRANCH_MANAGER', 'branch.calendar.manage')")
    expect(branchManagerTuple).not.toContain("('BRANCH_MANAGER', 'branch.edit')")
    expect(migration).toContain('ba.branch_id = p_branch_id')
    expect(migration).toContain('ba.revoked_at is null')
    expect(migration).toContain("('COMPANY_ADMIN', 'branch.calendar.manage')")
    expect(migration).toContain("('OVERALL_HR_MANAGER', 'branch.calendar.manage')")
    expect(migration).toContain("('PORTFOLIO_ADMIN', 'branch.calendar.manage')")
  })

  it('uses the narrow calendar permission and retains requester/reviewer separation', () => {
    expect(migration).toContain("has_permission('branch.calendar.manage'")
    expect(migration).not.toMatch(/branch_work_calendar_(?:capabilities|request|review)[\s\S]*?has_permission\('branch\.edit'/)
    expect(migration).toContain('v.requested_by = auth.uid()')
    expect(migration).toContain('v.status <> \'PENDING\'')
  })

  it('retains existing payroll and employee-change self-review guards', () => {
    expect(payrollReview).toContain('v.created_by = auth.uid()')
    expect(employeeChangeReview).toContain('v_request.requested_by = auth.uid()')
    expect(migration).toContain('p_user_id = auth.uid()')
  })
})
