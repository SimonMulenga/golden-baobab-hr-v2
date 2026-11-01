import { describe, expect, it } from 'vitest'
import { formatPayrollPeriodRange } from './payroll-period-display'

const zambia = { timezone: 'Africa/Lusaka', date_format: 'DD/MM/YYYY' as const, currency_code: 'ZMW' as const, payroll_cutoff_day: 25 }

describe('payroll calendar period display', () => {
  it('formats date-only values without timezone shifts in Zambia', () => {
    expect(formatPayrollPeriodRange('2026-11-01', '2026-11-30', zambia)).toBe('01/11/2026 – 30/11/2026')
  })

  it('preserves month and year boundaries', () => {
    expect(formatPayrollPeriodRange('2026-12-31', '2027-01-01', zambia)).toBe('31/12/2026 – 01/01/2027')
  })

  it('uses the configured ISO date order', () => {
    expect(formatPayrollPeriodRange('2026-01-01', '2026-01-31', { ...zambia, date_format: 'YYYY-MM-DD' })).toBe('2026-01-01 – 2026-01-31')
  })

  it.each([
    [null, '2026-11-30'],
    ['2026-11-01', null],
    ['', '2026-11-30'],
    ['1970-01-01T00:00:00Z', '2026-11-30'],
    ['2026-02-30', '2026-03-01'],
    ['2026-12-31', '2026-01-01'],
  ])('does not render a fabricated epoch for invalid dates (%s, %s)', (start, end) => {
    expect(formatPayrollPeriodRange(start, end, zambia)).toBe('Period dates unavailable')
  })
})
