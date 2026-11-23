import { describe, expect, it } from 'vitest'
import { daysInMonth, formatBirthDate } from './payslip-access-date'

const today = { year: 2026, month: 11, day: 23 }

describe('payslip birth date input', () => {
  it('formats a valid selected date as YYYY-MM-DD without timezone conversion', () => {
    expect(formatBirthDate({ day: '2', month: '4', year: '1990' }, today)).toBe('1990-04-02')
  })

  it('validates month lengths and leap days', () => {
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(formatBirthDate({ day: '29', month: '2', year: '2000' }, today)).toBe('2000-02-29')
    expect(formatBirthDate({ day: '29', month: '2', year: '1900' }, today)).toBeNull()
    expect(formatBirthDate({ day: '31', month: '4', year: '1990' }, today)).toBeNull()
  })

  it('rejects dates after the current Lusaka calendar day', () => {
    expect(formatBirthDate({ day: '24', month: '11', year: '2026' }, today)).toBeNull()
  })
})
