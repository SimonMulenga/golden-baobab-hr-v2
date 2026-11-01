import { describe, expect, it } from 'vitest'
import type { PayrollRunRecord } from '../../services/live-business-services'
import { payrollReviewGuidance } from './payroll-review-guidance'

const run = (status: string, version = 1, createdBy = 'preparer'): PayrollRunRecord => ({
  id: 'run-1', company_id: 'company-1', branch_id: 'branch-1', payroll_period_id: 'period-1',
  status, version, created_by: createdBy, created_at: '2026-11-01T00:00:00Z',
})

describe('payroll review guidance', () => {
  it('explains the independent reviewer requirement for the run preparer', () => {
    expect(payrollReviewGuidance(run('SUBMITTED_FOR_APPROVAL'), 'preparer')).toMatch(/another authorized payroll reviewer/i)
  })

  it('requires submission before a calculated run can be approved', () => {
    expect(payrollReviewGuidance(run('CALCULATED'), 'reviewer')).toMatch(/submit this payroll run for approval/i)
  })

  it('explains stale versions and refreshes from the latest run', () => {
    expect(payrollReviewGuidance(run('SUBMITTED_FOR_APPROVAL'), 'reviewer', run('SUBMITTED_FOR_APPROVAL', 2))).toMatch(/calculation has changed/i)
  })

  it('distinguishes a missing review permission', () => {
    expect(payrollReviewGuidance(run('SUBMITTED_FOR_APPROVAL'), 'reviewer', null, { code: '42501' })).toMatch(/does not have permission/i)
  })
})
