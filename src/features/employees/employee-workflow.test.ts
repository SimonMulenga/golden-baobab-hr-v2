import { describe, expect, it } from 'vitest'
import { mockEmployees } from './mockData'
import { getApprovalStatus, getRetirementEligibility, isPayrollEligible, resubmitEmployee, reviewEmployee } from './employee-workflow'

const submitted = { ...mockEmployees[0], id: 'synthetic-pending', approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' as const }

describe('synthetic employee approval workflow', () => {
  it('treats existing demo fixtures as approved and submitted records as payroll-ineligible', () => {
    expect(getApprovalStatus(mockEmployees[0])).toBe('APPROVED')
    expect(isPayrollEligible(mockEmployees[0])).toBe(true)
    expect(isPayrollEligible(submitted)).toBe(false)
  })

  it('records an approval actor, timestamp, and history event', () => {
    const approved = reviewEmployee(submitted, 'APPROVED', 'Demo HR reviewer', '', '2026-10-28T10:00:00.000Z')
    expect(approved.approvalStatus).toBe('APPROVED')
    expect(approved.reviewedBy).toBe('Demo HR reviewer')
    expect(approved.reviewedAt).toBe('2026-10-28T10:00:00.000Z')
    expect(approved.approvalHistory?.[0]).toMatchObject({ from: 'SUBMITTED_FOR_HR_APPROVAL', to: 'APPROVED' })
    expect(isPayrollEligible(approved)).toBe(true)
  })

  it('requires a reason for rejection and preserves that reason in the audit event', () => {
    expect(() => reviewEmployee(submitted, 'REJECTED', 'Demo HR reviewer')).toThrow(/reason/i)
    const rejected = reviewEmployee(submitted, 'REJECTED', 'Demo HR reviewer', 'Missing contract details')
    expect(rejected.rejectionReason).toBe('Missing contract details')
    expect(rejected.approvalHistory?.[0].reason).toBe('Missing contract details')
    expect(isPayrollEligible(rejected)).toBe(false)
  })

  it('requires a submitted record before review', () => {
    expect(() => reviewEmployee(mockEmployees[0], 'APPROVED', 'Demo HR reviewer')).toThrow(/submitted/i)
  })

  it('resubmits a corrected returned record while preserving its employee ID and review history', () => {
    const returned = reviewEmployee(submitted, 'RETURNED_FOR_CORRECTION', 'Demo HR reviewer', 'Add the contract end date', '2026-10-28T10:00:00.000Z')
    const corrected = resubmitEmployee({ ...returned, contractEndDate: '2027-10-27' }, 'Demo employee editor', '2026-10-28T11:00:00.000Z')
    expect(corrected.id).toBe(submitted.id)
    expect(corrected.approvalStatus).toBe('SUBMITTED_FOR_HR_APPROVAL')
    expect(corrected.approvalHistory).toHaveLength(2)
    expect(corrected.approvalHistory?.[1]).toMatchObject({ from: 'RETURNED_FOR_CORRECTION', to: 'SUBMITTED_FOR_HR_APPROVAL' })
    expect(isPayrollEligible(corrected)).toBe(false)
  })

  it('calculates retirement eligibility from the employee-specific configured age without changing contribution treatment', () => {
    expect(getRetirementEligibility('1961-10-28', 65, '2026-10-27')).toBe('NOT_ELIGIBLE')
    expect(getRetirementEligibility('1961-10-28', 65, '2026-10-28')).toBe('ELIGIBLE')
    expect(getRetirementEligibility('1961-02-29', 65, '2026-10-28')).toBe('NOT_CONFIGURED')
    expect(getRetirementEligibility('1961-10-28', undefined, '2026-10-28')).toBe('NOT_CONFIGURED')
  })
})
