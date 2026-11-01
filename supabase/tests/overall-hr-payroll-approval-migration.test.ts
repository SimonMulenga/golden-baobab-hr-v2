import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261101005100_overall_hr_payroll_approval_scope.sql'), 'utf8')

describe('Overall HR payroll self-approval migration contract', () => {
  const review = migration.slice(migration.indexOf('create or replace function public.payroll_review_submission'))

  it('permits a creator self-approval only for an active Overall HR role in the payroll portfolio', () => {
    expect(review).toContain("p_action = 'APPROVE'")
    expect(review).toContain("has_portfolio_role(v.portfolio_id, 'OVERALL_HR_MANAGER')")
    expect(review).toContain("v.created_by = auth.uid() and not v_hr_self_approval")
  })

  it('retains scoped approval permission, submitted-state and exact-version checks', () => {
    expect(review).toContain("v.version <> p_expected_version")
    expect(review).toContain("v.status not in ('SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW')")
    expect(review).toContain("has_permission('payroll.approve', v.portfolio_id, v.company_id, v.branch_id)")
  })

  it('records an audit marker for the narrowly allowed HR self-approval and retains authenticated-only execution', () => {
    expect(review).toContain("'overall_hr_self_approval', v_hr_self_approval")
    expect(migration).toContain('revoke all on function public.payroll_review_submission(uuid, text, integer, text) from public, anon')
    expect(migration).toContain('grant execute on function public.payroll_review_submission(uuid, text, integer, text) to authenticated')
  })
})
