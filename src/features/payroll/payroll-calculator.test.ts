import { describe, expect, it } from 'vitest'
import { calculatePayroll, type StatutoryRuleSet } from './payroll-calculator'

const verifiedRules: StatutoryRuleSet = {
  version: 'synthetic-reviewed-v1',
  verified: true,
  effectiveFrom: '2026-01-01',
  effectiveThrough: '2026-12-31',
  employeeDeductions: [{ code: 'PAYE-DEMO', label: 'Illustrative employee tax line', amountCents: 100000 }],
  employerContributions: [{ code: 'EMPLOYER-DEMO', label: 'Illustrative employer contribution', amountCents: 25000 }],
}

describe('payroll calculation preview', () => {
  it('keeps earnings, employee deductions, employer contribution and employer cost separate', () => {
    const result = calculatePayroll({
      periodStart: '2026-10-01',
      earnings: [
        { code: 'BASIC', label: 'Basic pay', amountCents: 1000000 },
        { code: 'HOUSING', label: 'Housing allowance', amountCents: 100000 },
        { code: 'OVERTIME', label: 'Overtime', amountCents: 50000 },
      ],
      voluntaryDeductions: [{ code: 'ADVANCE', label: 'Approved advance', amountCents: 50000 }],
      statutoryRules: verifiedRules,
    })
    expect(result).toMatchObject({ grossPayCents: 1150000, netPayCents: 1000000, employerCostCents: 1175000, canFinalize: true, statutoryRuleVersion: 'synthetic-reviewed-v1' })
    expect(result.employeeDeductions.map((item) => item.code)).toEqual(['PAYE-DEMO', 'ADVANCE'])
  })

  it('blocks finalization and omits net pay without verified effective statutory rules', () => {
    const result = calculatePayroll({ periodStart: '2026-10-01', earnings: [{ code: 'BASIC', label: 'Basic pay', amountCents: 1000000 }], voluntaryDeductions: [] })
    expect(result).toMatchObject({ netPayCents: null, canFinalize: false })
    expect(result.warnings[0]).toMatch(/No statutory rule set/)
    const unverified = calculatePayroll({ periodStart: '2026-10-01', earnings: [{ code: 'BASIC', label: 'Basic pay', amountCents: 1000000 }], voluntaryDeductions: [], statutoryRules: { ...verifiedRules, verified: false } })
    expect(unverified.netPayCents).toBeNull()
    expect(unverified.canFinalize).toBe(false)
  })

  it('blocks rules outside their effective dates and deductions exceeding gross pay', () => {
    const outOfDate = calculatePayroll({ periodStart: '2027-01-01', earnings: [{ code: 'BASIC', label: 'Basic pay', amountCents: 1000000 }], voluntaryDeductions: [], statutoryRules: verifiedRules })
    expect(outOfDate.canFinalize).toBe(false)
    const excess = calculatePayroll({ periodStart: '2026-10-01', earnings: [{ code: 'BASIC', label: 'Basic pay', amountCents: 50000 }], voluntaryDeductions: [{ code: 'LOAN', label: 'Loan', amountCents: 70000 }], statutoryRules: { ...verifiedRules, employeeDeductions: [] } })
    expect(excess).toMatchObject({ netPayCents: 0, canFinalize: false })
    expect(excess.warnings.at(-1)).toMatch(/exceed gross pay/)
  })

  it('rejects invalid dates and negative/non-integer monetary inputs', () => {
    expect(() => calculatePayroll({ periodStart: '2026-02-30', earnings: [], voluntaryDeductions: [] })).toThrow('valid YYYY-MM-DD')
    expect(() => calculatePayroll({ periodStart: '2026-01-01', earnings: [{ code: 'BASIC', label: 'Basic pay', amountCents: -1 }], voluntaryDeductions: [] })).toThrow('non-negative integer cents')
  })
})
