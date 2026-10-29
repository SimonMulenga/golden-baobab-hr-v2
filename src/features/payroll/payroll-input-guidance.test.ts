import { describe, expect, it } from 'vitest'
import { payrollInputLoadGuidance, payrollWarningGuidance } from './payroll-input-guidance'

describe('payroll input guidance', () => {
  it('explains missing preparation authorization without exposing backend details', () => {
    expect(payrollInputLoadGuidance({ code: '42501', message: 'Payroll inputs are not authorized for this branch.' })).toContain('payroll preparation access')
  })
  it('identifies an attendance period that is not approved for the selected dates', () => {
    expect(payrollInputLoadGuidance({ code: '22023', message: 'An approved attendance period matching the payroll dates is required.' })).toContain('submit and approve it')
  })
  it('points to database deployment when the payroll RPC is missing', () => {
    expect(payrollInputLoadGuidance({ code: 'PGRST202', message: 'Could not find the function in the schema cache' })).toContain('RPC migration')
  })
  it('maps known warning codes to actionable text and safely handles unknown codes', () => {
    expect(payrollWarningGuidance('MISSING_EFFECTIVE_COMPENSATION')).toContain('covers this entire pay period')
    expect(payrollWarningGuidance('INTERNAL_UNKNOWN')).not.toContain('INTERNAL_UNKNOWN')
  })
})
