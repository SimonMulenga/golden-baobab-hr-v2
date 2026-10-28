import { describe, expect, it } from 'vitest'
import { calculateZambiaIllustrativePayroll } from './zambia-payroll'

describe('illustrative Zambia payroll bands', () => {
  it('applies the supplied progressive PAYE bands to K15,000 as K3,176', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 1_500_000, taxableAllowanceCents: 0, napsaBaseCents: 0, nhimaEmployeeBaseCents: 0, nhimaEmployerBaseCents: 0 })
    expect(result.payeCents).toBe(317_600)
    expect(result.netPayCents).toBe(1_182_400)
    expect(result.productionFinalizationAllowed).toBe(false)
  })

  it.each([
    [450_000, 0],
    [510_000, 0],
    [550_000, 8_000],
    [650_000, 28_000],
    [710_000, 40_000],
    [920_000, 103_000],
    [1_250_000, 225_100],
    [2_500_000, 687_600],
  ])('calculates the progressive PAYE preview for %s cents', (grossCents, expectedPayeCents) => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: grossCents, taxableAllowanceCents: 0, napsaBaseCents: 0, nhimaEmployeeBaseCents: 0, nhimaEmployerBaseCents: 0 })
    expect(result.payeCents).toBe(expectedPayeCents)
  })

  it('rounds percentage calculations using integer cents and half-up cent rounding', () => {
    const belowTie = calculateZambiaIllustrativePayroll({ basicCents: 10_001, taxableAllowanceCents: 0, napsaBaseCents: 10, nhimaEmployeeBaseCents: 49, nhimaEmployerBaseCents: 50 })
    expect(belowTie.napsaEmployeeCents).toBe(1)
    expect(belowTie.nhimaEmployeeCents).toBe(0)
    expect(belowTie.nhimaEmployerCents).toBe(1)
  })

  it('illustrates 1% NHIMA employee/employer values while keeping bases configurable', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 1_000_000, taxableAllowanceCents: 0, napsaBaseCents: 0 })
    expect(result.nhimaEmployeeCents).toBe(10_000)
    expect(result.nhimaEmployerCents).toBe(10_000)
    expect(result.warnings[0]).toContain('Confirm')
  })
})


