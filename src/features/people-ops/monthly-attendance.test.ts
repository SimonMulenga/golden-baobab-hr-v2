import { describe, expect, it } from 'vitest'
import { summarizeMonthlyAttendance } from './monthly-attendance'

describe('monthly attendance payable-day preview', () => {
  const scheduledDates = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06']

  it('preserves monthly pay for paid leave and approved payable absence', () => {
    const result = summarizeMonthlyAttendance({
      contract: 'MONTHLY_SALARIED',
      scheduledDates,
      monthlyBaseCents: 1000000,
      entries: [
        { date: scheduledDates[0], status: 'WORKED' },
        { date: scheduledDates[1], status: 'PAID_LEAVE' },
        { date: scheduledDates[2], status: 'APPROVED_PAYABLE_ABSENCE' },
      ],
    })
    expect(result).toMatchObject({ scheduledDays: 4, workedDays: 1, paidLeaveDays: 1, approvedPayableAbsenceDays: 1, unclassifiedScheduledDays: 1, payableBasicCents: 1000000, canCalculate: true })
  })

  it('does not apply unpaid-leave deduction without an explicit contract rate', () => {
    const result = summarizeMonthlyAttendance({ contract: 'FIXED_TERM_MONTHLY', scheduledDates, monthlyBaseCents: 1000000, entries: [{ date: scheduledDates[0], status: 'UNPAID_LEAVE' }] })
    expect(result).toMatchObject({ unpaidLeaveDays: 1, payableBasicCents: null, canCalculate: false })
  })

  it('uses only the explicitly supplied unpaid-leave rate', () => {
    const result = summarizeMonthlyAttendance({ contract: 'MONTHLY_SALARIED', scheduledDates, monthlyBaseCents: 1000000, unpaidLeaveDailyRateCents: 25000, entries: [{ date: scheduledDates[0], status: 'UNPAID_LEAVE' }] })
    expect(result.payableBasicCents).toBe(975000)
  })

  it('pays daily-rated employees for worked days, paid leave and approved payable absence', () => {
    const result = summarizeMonthlyAttendance({ contract: 'CASUAL_DAILY', scheduledDates, dailyRateCents: 50000, entries: [
      { date: scheduledDates[0], status: 'WORKED' }, { date: scheduledDates[1], status: 'PAID_LEAVE' }, { date: scheduledDates[2], status: 'APPROVED_PAYABLE_ABSENCE' }, { date: scheduledDates[3], status: 'UNPAID_LEAVE' },
    ] })
    expect(result).toMatchObject({ payableBasicCents: 150000, unpaidLeaveDays: 1, canCalculate: true })
  })

  it('rejects duplicate overlapping leave/attendance entries and unscheduled dates', () => {
    expect(() => summarizeMonthlyAttendance({ contract: 'MONTHLY_SALARIED', scheduledDates, monthlyBaseCents: 100000, entries: [{ date: scheduledDates[0], status: 'WORKED' }, { date: scheduledDates[0], status: 'PAID_LEAVE' }] })).toThrow(/Duplicate or overlapping/)
    expect(() => summarizeMonthlyAttendance({ contract: 'MONTHLY_SALARIED', scheduledDates, monthlyBaseCents: 100000, entries: [{ date: '2026-10-03', status: 'UNPAID_LEAVE' }] })).toThrow(/scheduled work date/)
  })
})
