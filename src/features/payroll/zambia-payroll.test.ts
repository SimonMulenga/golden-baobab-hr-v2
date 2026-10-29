import { describe, expect, it } from 'vitest'
import { calculateZambiaIllustrativePayroll } from './zambia-payroll'

const payroll = (basicCents: number, taxableAllowanceCents = 0) =>
  calculateZambiaIllustrativePayroll({ basicCents, taxableAllowanceCents })

describe('approved Zambia ordinary monthly payroll configuration', () => {
  it('uses progressive PAYE at band boundaries', () => {
    expect(payroll(510_000).payeCents).toBe(0)
    expect(payroll(550_000).payeCents).toBe(8_000)
    expect(payroll(710_000).payeCents).toBe(40_000)
    expect(payroll(920_000).payeCents).toBe(103_000)
    expect(payroll(1_250_000).payeCents).toBe(225_100)
    expect(payroll(2_500_000).payeCents).toBe(687_600)
  })

  it('matches the mandatory K19,619.60 worked example exactly', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 1_509_200, taxableAllowanceCents: 452_760 })
    expect(result).toMatchObject({
      grossCents: 1_961_960,
      taxablePayCents: 1_961_960,
      payeCents: 488_525,
      napsaEmployeeCents: 98_098,
      napsaEmployerCents: 98_098,
      nhimaEmployeeCents: 15_092,
      nhimaEmployerCents: 15_092,
      netPayCents: 1_360_245,
      employerCostCents: 2_075_150,
    })
  })

  it('uses gross for NAPSA, basic only for NHIMA, and keeps non-taxable earnings out of PAYE', () => {
    const result = calculateZambiaIllustrativePayroll({
      basicCents: 500_000,
      taxableAllowanceCents: 100_000,
      nonTaxableAllowanceCents: 100_000,
    })
    expect(result.grossCents).toBe(700_000)
    expect(result.taxablePayCents).toBe(600_000)
    expect(result.napsaEmployeeCents).toBe(35_000)
    expect(result.nhimaEmployeeCents).toBe(5_000)
    expect(result.nhimaEmployerCents).toBe(5_000)
  })

  it.each([
    [3_000_000, 150_000],
    [3_723_599, 186_180],
    [3_723_600, 186_180],
    [3_723_601, 186_180],
    [5_000_000, 186_180],
  ])('caps both NAPSA contributions correctly for gross cents %s', (grossCents, expectedCents) => {
    const result = payroll(grossCents)
    expect(result.napsaEmployeeCents).toBe(expectedCents)
    expect(result.napsaEmployerCents).toBe(expectedCents)
  })

  it('rounds half-cent contributions away from zero', () => {
    expect(payroll(50).nhimaEmployeeCents).toBe(1)
    expect(payroll(10).napsaEmployeeCents).toBe(1)
  })

  it('includes other approved deductions in net pay and never permits negative net', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 600_000, otherDeductionsCents: 100_000 })
    expect(result.netPayCents).toBe(446_000)
    expect(() => calculateZambiaIllustrativePayroll({ basicCents: 1_000, otherDeductionsCents: 2_000 })).toThrow(/negative net pay/)
  })

  it('keeps browser-side calculation explicitly non-authoritative', () => {
    expect(payroll(1_500_000).productionFinalizationAllowed).toBe(false)
    expect(payroll(1_500_000).warnings[0]).toContain('Supabase PostgreSQL')
  })
})
