import { describe, expect, it } from 'vitest'
import { amendPayrollRun, beginPayrollReview, createPayrollRun, decidePayrollReview, finalizePayrollRun, reversePayrollRun, submitPayroll } from './payroll-workflow'

const branchManager = { id: 'branch-manager-1', role: 'BRANCH_MANAGER' as const, assignedBranchIds: ['branch-1'] }
const hrReviewer = { id: 'overall-hr-1', role: 'OVERALL_HR_MANAGER' as const }
const payrollCreator = createPayrollRun({ id: 'run-1', companyId: 'company-1', branchId: 'branch-1', period: '2026-11', createdBy: branchManager.id }, '2026-10-28T08:00:00.000Z')

function approvedRun() {
  const submitted = submitPayroll(payrollCreator, branchManager, '2026-10-28T09:00:00.000Z')
  const underReview = beginPayrollReview(submitted, hrReviewer, '2026-10-28T10:00:00.000Z')
  return decidePayrollReview(underReview, 'APPROVED', hrReviewer, '2026-10-28T11:00:00.000Z')
}

describe('payroll approval workflow rules', () => {
  it('restricts branch payroll submission to an assigned branch', () => {
    expect(() => submitPayroll(payrollCreator, { ...branchManager, assignedBranchIds: ['other-branch'] }, 'now')).toThrow(/not assigned/)
    expect(submitPayroll(payrollCreator, branchManager, 'now').status).toBe('SUBMITTED_FOR_APPROVAL')
  })

  it('prevents a branch manager and a preparer from reviewing or approving their own submission', () => {
    const submitted = submitPayroll(payrollCreator, branchManager, 'submitted')
    expect(() => beginPayrollReview(submitted, { id: 'other-branch-manager', role: 'BRANCH_MANAGER' }, 'review')).toThrow(/cannot review/)
    expect(() => beginPayrollReview(submitted, { id: branchManager.id, role: 'OVERALL_HR_MANAGER' }, 'review')).toThrow(/cannot review or approve/)
    expect(() => decidePayrollReview({ ...submitted, status: 'UNDER_REVIEW' }, 'APPROVED', { id: branchManager.id, role: 'OVERALL_HR_MANAGER' }, 'reviewed')).toThrow(/cannot approve their own/)
  })

  it('requires reasons on rejection and return decisions', () => {
    const underReview = beginPayrollReview(submitPayroll(payrollCreator, branchManager, 'submitted'), hrReviewer, 'review')
    expect(() => decidePayrollReview(underReview, 'REJECTED', hrReviewer, 'rejected')).toThrow(/Provide a reason/)
    expect(decidePayrollReview(underReview, 'RETURNED_FOR_CORRECTION', hrReviewer, 'returned', 'Attendance mismatch')).toMatchObject({ status: 'RETURNED_FOR_CORRECTION', events: expect.arrayContaining([expect.objectContaining({ reason: 'Attendance mismatch' })]) })
  })

  it('invalidates approval when the payroll version changes', () => {
    const approved = approvedRun()
    const amended = amendPayrollRun(approved, { id: 'hr-editor', role: 'OVERALL_HR_MANAGER', assignedBranchIds: [] }, 'Corrected earning line', 'amended')
    expect(amended).toMatchObject({ version: 2, status: 'CALCULATED', approvedVersion: undefined })
    expect(() => finalizePayrollRun(amended, hrReviewer, 'key-1', 'finalized')).toThrow(/exact approved payroll version/)
  })

  it('finalizes an approved version idempotently and writes an auditable reversal event', () => {
    const approved = approvedRun()
    const finalized = finalizePayrollRun(approved, hrReviewer, 'key-1', 'finalized')
    expect(finalized).toMatchObject({ alreadyFinalized: false, run: { status: 'FINALIZED', finalizationKey: 'key-1' } })
    expect(finalizePayrollRun(finalized.run, hrReviewer, 'key-1', 'replayed')).toMatchObject({ alreadyFinalized: true })
    const reversed = reversePayrollRun(finalized.run, hrReviewer, 'Approved adjustment was incorrect', 'reversed')
    expect(reversed).toMatchObject({ status: 'REVERSED', events: expect.arrayContaining([expect.objectContaining({ type: 'REVERSAL_COMPENSATION' })]) })
    expect(() => reversePayrollRun(reversed, hrReviewer, 'second reversal', 'again')).toThrow(/Only finalized payroll/)
  })
})
