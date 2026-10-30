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
    return 'Payroll inputs are not available yet. Ask your administrator to update the payroll service, then refresh and try again.'
  }
  if (code === '22023' || text.includes('valid payroll period')) {
    return 'Choose a valid payroll month and confirm its start and end dates.'
  }
  return 'Payroll inputs could not be loaded. Check your company and branch access, confirm the period is valid and its attendance is approved, then retry. No payroll records were changed.'
}

export function payrollWarningGuidance(code: string): string {
  const messages: Record<string, string> = {
    MISSING_EFFECTIVE_COMPENSATION: 'No approved salary rate applies to this employee during the pay period. Review the employment start date and approved compensation history.',
    COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD: 'Approved compensation does not cover each eligible scheduled workday exactly once. Review the employee’s start date, approved salary effective dates and branch work calendar. For an employee who joined during the month, scheduled-day proration uses the approved calendar; do not change dates to force a full month of pay.',
    EARNING_INPUTS_AWAITING_APPROVAL: 'Variable earnings are awaiting separate HR approval.',
    CROSS_PERIOD_LEAVE_REQUIRES_REVIEW: 'Approved leave crosses the payroll period boundary and needs HR review.',
    APPROVED_LEAVE_NOT_RECONCILED_WITH_ATTENDANCE: 'Approved leave days do not match the attendance entry.',
    OVERLAPPING_APPROVED_LEAVE: 'Overlapping approved leave requests need correction.',
    MISSING_APPROVED_ATTENDANCE_ENTRY: 'An approved attendance entry is missing.',
    NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE: 'This salary frequency needs a supported payroll calculation rule.',
    MISSING_APPROVED_BRANCH_WORK_CALENDAR: 'There is no approved working calendar for this branch and month. Ask an authorized administrator to submit and approve the branch schedule before preparing payroll.',
    ATTENDANCE_SCHEDULE_MISMATCH: 'The approved attendance schedule does not match the employee’s eligible working days in the approved branch calendar. Correct attendance and obtain approval again.',
    COMPENSATION_GAP_FOR_SCHEDULED_DAYS: 'Approved compensation does not cover every eligible scheduled workday. Add a correctly effective-dated compensation version through the approval workflow.',
    OVERLAPPING_COMPENSATION_FOR_SCHEDULED_DAYS: 'More than one compensation version applies to an eligible scheduled workday. Resolve the overlapping effective dates before calculating payroll.',
    ALLOWANCE_PRORATION_RULE_REQUIRED: 'A non-zero allowance needs an explicit scheduled-days proration rule for this partial month or compensation change.',
    ALLOWANCE_TAX_TREATMENT_CHANGED_DURING_PERIOD: 'Allowance tax treatment changes during this month. HR review is required before payroll can be calculated.',
  }
  return messages[code] ?? 'This employee has a payroll input that needs review.'
}
