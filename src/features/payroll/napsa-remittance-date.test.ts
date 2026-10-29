import { describe, expect, it } from 'vitest'
import { napsaRemittanceDeadline } from './napsa-remittance-date'

describe('NAPSA remittance deadline', () => {
  it.each([
    ['2026-01-31', '2026-02-10'],
    ['2026-04-30', '2026-05-10'],
    ['2026-12-31', '2027-01-10'],
  ])('maps contribution month ending %s to deadline %s', (periodEnd, deadline) => {
    expect(napsaRemittanceDeadline(periodEnd)).toBe(deadline)
  })

  it('rejects malformed or impossible period ends', () => {
    expect(napsaRemittanceDeadline('2026-02-30')).toBe('')
    expect(napsaRemittanceDeadline('not-a-date')).toBe('')
  })
})
