import type { Employee, EmployeeApprovalEvent, EmployeeApprovalStatus } from './types'

export type EmployeeReviewAction = 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION'
export type RetirementEligibility = 'NOT_CONFIGURED' | 'NOT_ELIGIBLE' | 'ELIGIBLE'

export function getRetirementEligibility(dateOfBirth: string, retirementAge: number | undefined, today: string): RetirementEligibility {
  if (!retirementAge || !Number.isInteger(retirementAge) || retirementAge < 1 || retirementAge > 100) return 'NOT_CONFIGURED'
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
  const current = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!birth || !current) return 'NOT_CONFIGURED'
  const birthYear = Number(birth[1])
  const birthMonth = Number(birth[2])
  const birthDay = Number(birth[3])
  const retirementYear = birthYear + retirementAge
  const finalDay = new Date(Date.UTC(retirementYear, birthMonth, 0)).getUTCDate()
  if (new Date(Date.UTC(birthYear, birthMonth - 1, birthDay)).toISOString().slice(0, 10) !== dateOfBirth) return 'NOT_CONFIGURED'
  const retirementDate = `${retirementYear}-${String(birthMonth).padStart(2, '0')}-${String(Math.min(birthDay, finalDay)).padStart(2, '0')}`
  return today >= retirementDate ? 'ELIGIBLE' : 'NOT_ELIGIBLE'
}

export function getApprovalStatus(employee: Employee): EmployeeApprovalStatus {
  // Existing seeded synthetic records predate the workflow and are treated as
  // approved fixtures. Newly created records always receive an explicit state.
  return employee.approvalStatus ?? 'APPROVED'
}

export function isPayrollEligible(employee: Employee): boolean {
  return getApprovalStatus(employee) === 'APPROVED' && employee.status !== 'Inactive'
}

export function reviewEmployee(
  employee: Employee,
  action: EmployeeReviewAction,
  actor: string,
  reason = '',
  at = new Date().toISOString(),
): Employee {
  const current = getApprovalStatus(employee)
  if (current !== 'SUBMITTED_FOR_HR_APPROVAL') {
    throw new Error('Only submitted employee records can be reviewed.')
  }
  if (action !== 'APPROVED' && !reason.trim()) {
    throw new Error('Provide a reason when rejecting or returning an employee record.')
  }

  const event: EmployeeApprovalEvent = {
    id: `approval-${employee.id}-${(employee.approvalHistory?.length ?? 0) + 1}`,
    from: current,
    to: action,
    actor,
    at,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  }

  return {
    ...employee,
    approvalStatus: action,
    approvalHistory: [...(employee.approvalHistory ?? []), event],
    reviewedBy: actor,
    reviewedAt: at,
    rejectionReason: action === 'REJECTED' ? reason.trim() : '',
  }
}

export function resubmitEmployee(employee: Employee, actor: string, at = new Date().toISOString()): Employee {
  if (getApprovalStatus(employee) !== 'RETURNED_FOR_CORRECTION' && getApprovalStatus(employee) !== 'REJECTED') {
    throw new Error('Only returned or rejected records can be corrected and resubmitted.')
  }
  const event: EmployeeApprovalEvent = {
    id: `approval-${employee.id}-${(employee.approvalHistory?.length ?? 0) + 1}`,
    from: getApprovalStatus(employee), to: 'SUBMITTED_FOR_HR_APPROVAL', actor, at,
  }
  return { ...employee, approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL', approvalHistory: [...(employee.approvalHistory ?? []), event], submittedAt: at, reviewedBy: undefined, reviewedAt: undefined, rejectionReason: '' }
}
