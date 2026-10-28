import { describe, expect, it } from 'vitest'
import { calculateZambiaIllustrativePayroll } from './zambia-payroll'

describe('illustrative Zambia payroll bands', () => {
  it('applies the supplied progressive PAYE bands to K15,000 as K3,176', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 1_500_000, taxableAllowanceCents: 0, napsaBaseCents: 0, nhimaEmployeeBaseCents: 0, nhimaEmployerBaseCents: 0 })
    expect(result.payeCents).toBe(317_600)
    expect(result.netPayCents).toBe(1_182_400)
    expect(result.productionFinalizationAllowed).toBe(false)
  })

  it('illustrates 1% NHIMA employee/employer values while keeping bases configurable', () => {
    const result = calculateZambiaIllustrativePayroll({ basicCents: 1_000_000, taxableAllowanceCents: 0, napsaBaseCents: 0 })
    expect(result.nhimaEmployeeCents).toBe(10_000)
    expect(result.nhimaEmployerCents).toBe(10_000)
    expect(result.warnings[0]).toContain('Confirm')
  })
})
