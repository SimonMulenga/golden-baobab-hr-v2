import { describe, expect, it } from 'vitest'
import { formatWorkspaceDate, formatWorkspaceDateTime } from './WorkspaceContext'

describe('company workspace date preferences', () => {
  it('uses the configured day-first date order and company time zone', () => {
    expect(formatWorkspaceDate('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25,
    })).toBe('30/10/2026')
  })

  it('uses ISO date order when selected', () => {
    expect(formatWorkspaceDate('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'YYYY-MM-DD', currency_code: 'ZMW', payroll_cutoff_day: 25,
    })).toBe('2026-10-30')
  })

  it('formats audit timestamps in the configured time zone', () => {
    const text = formatWorkspaceDateTime('2026-10-29T23:30:00Z', {
      timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY', currency_code: 'ZMW', payroll_cutoff_day: 25,
    }, { dateStyle: 'short', timeStyle: 'short' })
    expect(text).toContain('30/10/2026')
    expect(text).toContain('01:30')
  })
})
