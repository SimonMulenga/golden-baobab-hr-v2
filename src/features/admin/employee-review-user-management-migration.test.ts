import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261101005000_employee_review_and_user_assignment_lifecycle.sql?raw'

describe('M050 employee-review and user-assignment security contract', () => {
  const review = migration.slice(migration.indexOf('create or replace function public.employee_review_submission'))
    .split('revoke all on function public.employee_review_submission')[0]

  it('authorizes review by the employee permission and full portfolio/company/branch tuple', () => {
    expect(review).toContain("case when p_decision = 'APPROVE' then 'employee.approve' else 'employee.reject' end")
    expect(review).toContain('v_employee.portfolio_id')
    expect(review).toContain('v_employee.company_id')
    expect(review).toContain('v_employee.workplace_branch_id')
    expect(review).not.toContain('v_employee.created_by = auth.uid()')
  })

  it('locks the submission, rejects stale/repeated decisions, and writes reviewer and audit history', () => {
    expect(review).toMatch(/where e\.id = p_employee_id\s+for update/i)
    expect(review).toContain("v_employee.approval_status <> 'SUBMITTED_FOR_HR_APPROVAL'")
    expect(review).toContain('reviewed_by = auth.uid()')
    expect(review).toContain('employee_approval_history')
    expect(review).toContain('audit_logs')
    expect(review).toContain("'40001'")
  })

  it('exposes the role lifecycle only to authenticated callers and never deletes Auth accounts', () => {
    expect(migration).toContain('public.managed_user_assignment_directory')
    expect(migration).toContain("public.manage_company_branch_role_assignment")
    expect(migration).toContain("public.manage_portfolio_role_assignment")
    expect(migration).toContain("public.manage_company_admin_assignment")
    expect(migration).toMatch(/grant execute on function public\.manage_company_branch_role_assignment\([^;]+ to authenticated/i)
    expect(migration).toMatch(/grant execute on function public\.manage_portfolio_role_assignment\([^;]+ to authenticated/i)
    expect(migration).not.toMatch(/delete\s+from\s+auth\.users/i)
  })

  it('keeps branch role operations within the authorized company and selected active branches', () => {
    const branch = migration.slice(migration.indexOf('create or replace function public.manage_company_branch_role_assignment'))
      .split('revoke all on function public.manage_company_branch_role_assignment')[0]
    expect(branch).toContain("has_permission('users.manage', p_portfolio_id, p_company_id, null)")
    expect(branch).toContain("p_user_id = auth.uid()")
    expect(branch).toContain('b.company_id = v_target_company_id')
    expect(branch).toContain('b.id = any(p_branch_ids)')
    expect(branch).toContain("b.status = 'ACTIVE'")
    expect(branch).toContain("'USER_ROLE_ASSIGNMENT_REACTIVATED'")
    expect(branch).toContain("'USER_ROLE_ASSIGNMENT_REMOVED'")
    expect(branch).not.toMatch(/delete\s+from\s+public\.(?:portfolio_memberships|branch_assignments)/i)
  })
})
