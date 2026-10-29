type BackendErrorShape = { code?: unknown; message?: unknown; details?: unknown }

export function payrollInputLoadGuidance(error: unknown): string {
  const value = error && typeof error === 'object' ? error as BackendErrorShape : {}
  const code = typeof value.code === 'string' ? value.code : ''
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : ''
  const details = typeof value.details === 'string' ? value.details.toLowerCase() : ''
  const text = `${message} ${details}`

  if (code === '42501' || text.includes('not authorized') || text.includes('permission denied')) {
    return 'You do not have payroll preparation access for this branch. Ask a company administrator to grant the payroll preparation role and branch membership.'
  }
  if (text.includes('approved attendance period matching the payroll dates')) {
    return 'Attendance is not ready for this payroll period. Create the attendance period for these exact dates, complete every employee entry, then submit and approve it.'
  }
  if (['PGRST202', '42883', 'PGRST203'].includes(code) || text.includes('could not find the function') || text.includes('schema cache')) {
    return 'The payroll input service is unavailable in this database version. Confirm the payroll RPC migration is applied, then refresh the application.'
  }
  if (code === '22023' || text.includes('valid payroll period')) {
    return 'Choose a valid payroll month and confirm its start and end dates.'
  }
  return 'Payroll inputs could not be loaded. Check your company and branch access, confirm the period is valid and its attendance is approved, then retry. No payroll records were changed.'
}

export function payrollWarningGuidance(code: string): string {
  const messages: Record<string, string> = {
    MISSING_EFFECTIVE_COMPENSATION: 'No compensation record covers this entire pay period.',
    COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD: 'Compensation is not defined for this entire pay period exactly once. Check the employee’s approved compensation effective dates. If the employee started during this period, payroll is blocked until an approved partial-month pay rule is configured; do not change the effective date to force a full month of pay.',
    EARNING_INPUTS_AWAITING_APPROVAL: 'Variable earnings are awaiting separate HR approval.',
    CROSS_PERIOD_LEAVE_REQUIRES_REVIEW: 'Approved leave crosses the payroll period boundary and needs HR review.',
    APPROVED_LEAVE_NOT_RECONCILED_WITH_ATTENDANCE: 'Approved leave days do not match the attendance entry.',
    OVERLAPPING_APPROVED_LEAVE: 'Overlapping approved leave requests need correction.',
    MISSING_APPROVED_ATTENDANCE_ENTRY: 'An approved attendance entry is missing.',
    NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE: 'This salary frequency needs a supported payroll calculation rule.',
  }
  return messages[code] ?? 'This employee has a payroll input that needs review.'
}
