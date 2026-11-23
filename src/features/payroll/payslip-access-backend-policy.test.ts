import { describe, expect, it } from 'vitest'
import { isValidDateOfBirth } from '../../../supabase/functions/payslip-access/policy'

const today = { year: 2026, month: 11, day: 23 }

describe('server-side payslip DOB policy', () => {
  it('accepts valid prior dates and valid leap days', () => {
    expect(isValidDateOfBirth('1990-04-02', today)).toBe(true)
    expect(isValidDateOfBirth('2000-02-29', today)).toBe(true)
  })

  it('rejects invalid dates and future dates', () => {
    expect(isValidDateOfBirth('1900-02-29', today)).toBe(false)
    expect(isValidDateOfBirth('2026-04-31', today)).toBe(false)
    expect(isValidDateOfBirth('2026-11-24', today)).toBe(false)
    expect(isValidDateOfBirth('1990-4-02', today)).toBe(false)
  })
})
