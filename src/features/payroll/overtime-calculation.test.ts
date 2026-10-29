import { describe, expect, it } from 'vitest'
import { estimateOvertime } from './overtime-calculation'

describe('Zambian overtime estimate (informational; database remains authoritative)', () => {
  it('uses the ordinary-day 150% rate and 208-hour divisor', () => {
    expect(estimateOvertime(10000, 10, 208, 'ORDINARY')?.amount).toBe(721.15)
  })

  it('uses the explicit five-day divisor displayed by ZamCalc', () => {
    expect(estimateOvertime(10000, 10, 176, 'ORDINARY')?.amount).toBe(852.27)
  })

  it('matches the published K10,000 basic-pay hourly-rate examples', () => {
    expect(estimateOvertime(10000, 1, 208, 'ORDINARY')?.hourlyRate.toFixed(2)).toBe('48.08')
    expect(estimateOvertime(10000, 1, 176, 'ORDINARY')?.hourlyRate.toFixed(2)).toBe('56.82')
  })

  it('matches the combined ZamCalc five-day schedule worked example', () => {
    const ordinary = estimateOvertime(10000, 10, 176, 'ORDINARY')
    const restDay = estimateOvertime(10000, 8, 176, 'REST_DAY')

    expect(ordinary?.amount).toBe(852.27)
    expect(restDay?.amount).toBe(909.09)
    expect(Number(((ordinary?.amount ?? 0) + (restDay?.amount ?? 0)).toFixed(2))).toBe(1761.36)
  })

  it('uses double time for rest-day and public-holiday work', () => {
    expect(estimateOvertime(10000, 8, 208, 'REST_DAY')?.amount).toBe(769.23)
    expect(estimateOvertime(10000, 8, 208, 'PUBLIC_HOLIDAY')?.amount).toBe(769.23)
  })

  it('keeps the guard divisor explicit and rejects invalid inputs', () => {
    expect(estimateOvertime(10000, 10, 240, 'ORDINARY')?.amount).toBe(625)
    expect(estimateOvertime(-1, 10, 208, 'ORDINARY')).toBeNull()
  })
})
