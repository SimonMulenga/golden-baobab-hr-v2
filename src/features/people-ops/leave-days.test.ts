import { describe, expect, it } from 'vitest'
import { countRequestedLeaveDays } from './leave-days'

describe('leave day calculation preview', () => {
  it('counts inclusive weekdays and applies company calendar exceptions', () => {
    expect(countRequestedLeaveDays('2026-11-02', '2026-11-08', 'WORKING_DAYS', [
      { calendar_date: '2026-11-07', is_working_day: true }, { calendar_date: '2026-11-04', is_working_day: false },
    ])).toBe(5)
  })
  it('counts all inclusive dates for calendar-day policies and rejects invalid ranges', () => {
    expect(countRequestedLeaveDays('2026-11-02', '2026-11-08', 'CALENDAR_DAYS', [])).toBe(7)
    expect(countRequestedLeaveDays('2026-11-09', '2026-11-02', 'WORKING_DAYS', [])).toBe(0)
  })
})
