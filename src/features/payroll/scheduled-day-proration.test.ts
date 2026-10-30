import { describe, expect, it } from 'vitest'
import { isScheduledDayProrationConsistent } from './scheduled-day-proration'

const breakdown = (eligible: number, total: number, rate: number) => ({
  valid_compensation: true,
  eligible_scheduled_days: eligible,
  total_scheduled_days: total,
  basic_pay: Math.round((rate * eligible / total + Number.EPSILON) * 100) / 100,
  segments: [{ effective_from: '2026-10-01', effective_to: null, monthly_basic_pay: rate,
    eligible_scheduled_days: eligible, prorated_basic_pay: Math.round((rate * eligible / total + Number.EPSILON) * 100) / 100 }],
})

describe('scheduled-day payroll proration audit validation', () => {
  it('accepts the synthetic K4,500 × 11/22 = K2,250 breakdown', () => {
    expect(isScheduledDayProrationConsistent(breakdown(11, 22, 4500), 2250)).toBe(true)
  })

  it('accepts full-month and final-scheduled-day results using the supplied branch calendar denominator', () => {
    expect(isScheduledDayProrationConsistent(breakdown(22, 22, 4500), 4500)).toBe(true)
    expect(isScheduledDayProrationConsistent(breakdown(1, 22, 4500), 204.55)).toBe(true)
  })

  it('sums effective-dated salary segments against the same calendar denominator', () => {
    const changed = { ...breakdown(22, 22, 4500), basic_pay: 4750, segments: [
      { effective_from: '2026-10-01', effective_to: '2026-10-15', monthly_basic_pay: 4500, eligible_scheduled_days: 11, prorated_basic_pay: 2250 },
      { effective_from: '2026-10-16', effective_to: null, monthly_basic_pay: 5000, eligible_scheduled_days: 11, prorated_basic_pay: 2500 },
    ] }
    expect(isScheduledDayProrationConsistent(changed, 4750)).toBe(true)
  })

  it('rejects missing dates, overlapping/gapped segments, invalid denominator, or a mismatched server amount', () => {
    expect(isScheduledDayProrationConsistent(undefined, 2250)).toBe(false)
    expect(isScheduledDayProrationConsistent(breakdown(11, 0, 4500), 2250)).toBe(false)
    expect(isScheduledDayProrationConsistent({ ...breakdown(11, 22, 4500), segments: [] }, 2250)).toBe(false)
    expect(isScheduledDayProrationConsistent(breakdown(11, 22, 4500), 4500)).toBe(false)
  })
})
