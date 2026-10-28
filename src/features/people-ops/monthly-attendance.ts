export type AttendanceDayStatus = 'WORKED' | 'PAID_LEAVE' | 'UNPAID_LEAVE' | 'APPROVED_PAYABLE_ABSENCE'
export type AttendanceDay = { date: string; status: AttendanceDayStatus }
export type AttendanceContract = 'MONTHLY_SALARIED' | 'FIXED_TERM_MONTHLY' | 'DAILY_RATED' | 'PART_TIME_DAILY' | 'CASUAL_DAILY'

export type MonthlyAttendanceInput = {
  contract: AttendanceContract
  scheduledDates: string[]
  entries: AttendanceDay[]
  monthlyBaseCents?: number
  dailyRateCents?: number
  unpaidLeaveDailyRateCents?: number
}

export function summarizeMonthlyAttendance(input: MonthlyAttendanceInput) {
  if (new Set(input.scheduledDates).size !== input.scheduledDates.length) throw new Error('Scheduled work dates must be unique.')
  for (const date of input.scheduledDates) {
    if (!isDate(date)) throw new Error('Scheduled work dates must be valid YYYY-MM-DD dates.')
  }
  const scheduled = new Set(input.scheduledDates)
  const seen = new Set<string>()
  for (const entry of input.entries) {
    if (!isDate(entry.date) || !scheduled.has(entry.date)) throw new Error('Attendance entries must fall on a scheduled work date.')
    if (seen.has(entry.date)) throw new Error(`Duplicate or overlapping attendance/leave entry for ${entry.date}.`)
    seen.add(entry.date)
  }

  const count = (status: AttendanceDayStatus) => input.entries.filter((entry) => entry.status === status).length
  const workedDays = count('WORKED')
  const paidLeaveDays = count('PAID_LEAVE')
  const unpaidLeaveDays = count('UNPAID_LEAVE')
  const approvedPayableAbsenceDays = count('APPROVED_PAYABLE_ABSENCE')
  const unclassifiedScheduledDays = input.scheduledDates.length - input.entries.length
  const warnings: string[] = []
  let payableBasicCents: number | null = null

  if (input.contract === 'MONTHLY_SALARIED' || input.contract === 'FIXED_TERM_MONTHLY') {
    if (!isMoney(input.monthlyBaseCents)) throw new Error('Monthly contracts need a non-negative monthly base in integer cents.')
    if (unpaidLeaveDays === 0) payableBasicCents = input.monthlyBaseCents
    else if (isMoney(input.unpaidLeaveDailyRateCents)) {
      const deduction = unpaidLeaveDays * input.unpaidLeaveDailyRateCents
      payableBasicCents = input.monthlyBaseCents - deduction
      if (payableBasicCents < 0) {
        payableBasicCents = null
        warnings.push('Configured unpaid-leave deduction exceeds monthly base pay; review the contract rule.')
      }
    } else {
      warnings.push('Unpaid leave is recorded, but no approved contract-specific deduction rate was supplied; pay calculation is blocked.')
    }
  } else {
    if (!isMoney(input.dailyRateCents)) throw new Error('Daily-rated contracts need a non-negative daily rate in integer cents.')
    const payableDays = workedDays + paidLeaveDays + approvedPayableAbsenceDays
    payableBasicCents = payableDays * input.dailyRateCents
  }
  if (payableBasicCents !== null && !Number.isSafeInteger(payableBasicCents)) {
    payableBasicCents = null
    warnings.push('Attendance earnings exceed the supported calculation range.')
  }

  return {
    scheduledDays: input.scheduledDates.length,
    workedDays,
    paidLeaveDays,
    unpaidLeaveDays,
    approvedPayableAbsenceDays,
    unclassifiedScheduledDays,
    payableBasicCents,
    canCalculate: payableBasicCents !== null,
    warnings,
  }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function isMoney(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
}

