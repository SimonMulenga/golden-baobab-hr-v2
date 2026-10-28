import { describe, expect, it } from 'vitest'
import { applyShortfallPolicy, buildDeductionSchedule, parseMoneyCents, postFinalizedDeductionPayment } from './deduction-schedule'

describe('decimal-safe deduction schedules', () => {
  it('creates the requested K6,000 six-month advance with K1,000 each month', () => {
    const rows = buildDeductionSchedule({ principal: '6000.00', startPeriod: '2026-11-01', method: 'EQUAL_INSTALLMENTS', installmentCount: 6 })
    expect(rows.map((row) => row.amountCents)).toEqual(Array(6).fill(100_000))
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(600_000)
  })

  it('splits a K4,800 medical advance into six monthly K800 installments', () => {
    const rows = buildDeductionSchedule({ principal: '4800.00', startPeriod: '2026-01-01', method: 'EQUAL_INSTALLMENTS', installmentCount: 6 })
    expect(rows.map((row) => row.amountCents)).toEqual([80000, 80000, 80000, 80000, 80000, 80000])
    expect(rows.map((row) => row.periodStart)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'])
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(480000)
  })

  it('places any remaining cents in the final equal installment', () => {
    const rows = buildDeductionSchedule({ principal: '10.00', startPeriod: '2026-01-01', method: 'EQUAL_INSTALLMENTS', installmentCount: 3 })
    expect(rows.map((row) => row.amountCents)).toEqual([333, 333, 334])
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1000)
  })

  it('caps the final fixed installment so the total equals principal', () => {
    const rows = buildDeductionSchedule({ principal: '1200', startPeriod: '2026-01-31', method: 'FIXED_AMOUNT', installmentAmount: '500' })
    expect(rows.map((row) => row.amountCents)).toEqual([50000, 50000, 20000])
    expect(rows[1].periodStart).toBe('2026-02-28')
  })

  it('supports a one-time installment and manual schedules', () => {
    expect(buildDeductionSchedule({ principal: '1200', startPeriod: '2026-01-01', method: 'ONE_TIME' })).toHaveLength(1)
    const manual = buildDeductionSchedule({ principal: '100', startPeriod: '2026-01-01', method: 'MANUAL', manualInstallments: [{ periodStart: '2026-02-01', amount: '25' }, { periodStart: '2026-04-01', amount: '75' }] })
    expect(manual.map((row) => [row.periodStart, row.amountCents])).toEqual([['2026-02-01', 2500], ['2026-04-01', 7500]])
  })

  it('rejects invalid precision, dates, overlong schedules and manual totals that do not reconcile', () => {
    expect(() => parseMoneyCents('1.005')).toThrow()
    expect(() => buildDeductionSchedule({ principal: '10', startPeriod: '2026-02-30', method: 'ONE_TIME' })).toThrow()
    expect(() => buildDeductionSchedule({ principal: '100', startPeriod: '2026-01-01', method: 'MANUAL', manualInstallments: [{ periodStart: '2026-01-01', amount: '99' }] })).toThrow()
  })

  it('applies explicit shortfall policy without negative pay or implicit carry-forward', () => {
    expect(applyShortfallPolicy(80000, 20000, 'BLOCK')).toEqual({ scheduledCents: 80000, appliedCents: 0, shortfallCents: 80000, carryForwardCents: 0 })
    expect(applyShortfallPolicy(80000, 20000, 'PARTIAL_NO_CARRY')).toEqual({ scheduledCents: 80000, appliedCents: 20000, shortfallCents: 60000, carryForwardCents: 0 })
  })

  it('posts only finalized payroll, caps at outstanding balance and is idempotent per run', () => {
    const ledger = { balanceCents: 50000, finalizedPayrollRunIds: [] as string[] }
    const payment = { payrollRunId: 'run-1', payrollStatus: 'FINALIZED' as const, scheduledCents: 80000, availablePayCents: 80000, shortfallPolicy: 'BLOCK' as const }
    expect(() => postFinalizedDeductionPayment(ledger, { ...payment, payrollStatus: 'CALCULATED' })).toThrow('only post from finalized payroll')
    const posted = postFinalizedDeductionPayment(ledger, payment)
    expect(posted).toMatchObject({ appliedCents: 50000, alreadyPosted: false, ledger: { balanceCents: 0 } })
    expect(postFinalizedDeductionPayment(posted.ledger, payment)).toMatchObject({ appliedCents: 0, alreadyPosted: true, ledger: { balanceCents: 0 } })
  })
})

