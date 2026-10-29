import { describe, expect, it } from 'vitest'
import { buildPayslipView } from './payslip-model'
import type { Company } from '../companies/types'
import type { EmployeeDirectoryRecord, FinalizedPayslipItemRecord, FinalizedPayslipRunRecord } from '../../services/live-business-services'

const company = { id: 'co1', name: 'Synthetic Company', logo: 'SC', address: '1 Demo Rd', town: 'Lusaka', province: 'Lusaka' } as Company
const employee = { employee_number: 'SYN-001', first_name: 'Demo', middle_name: null, last_name: 'Employee', job_title: 'Analyst', department: 'Finance' } as EmployeeDirectoryRecord
const run = { id: '12345678-1111', status: 'FINALIZED', version: 2, payroll_periods: { period_start: '2026-10-01', period_end: '2026-10-31' } } as FinalizedPayslipRunRecord
const item = {
  basic_pay: 15092, housing_allowance: 3018.4, meal_allowance: 0, transport_allowance: 1509.2,
  other_allowances: 0, overtime: 0, bonuses_and_other_earnings: 0, attendance_deduction: 0,
  gross_pay: 19619.6, statutory_deductions: { PAYE: 4885.25, NAPSA_EMPLOYEE: 980.98, NHIMA_EMPLOYEE: 150.92 },
  voluntary_deductions: 1000, net_pay: 12602.45,
  calculation_breakdown: { due_deduction_items: [{ deduction_type: 'MEDICAL_ADVANCE', scheduled_amount: 1000, reason: 'Six month repayment' }] },
} as unknown as FinalizedPayslipItemRecord

describe('finalized payslip view model', () => {
  it('uses the persisted finalized line and reconciles to its saved net pay', () => {
    const result = buildPayslipView({ company, employee, run, item })
    expect(result.gross).toBe(19619.6)
    expect(result.totalDeductions).toBe(7017.15)
    expect(result.net).toBe(12602.45)
    expect(Number(result.deductions.reduce((sum, line) => sum + line.amount, 0).toFixed(2))).toBe(result.totalDeductions)
    expect(result.periodLabel).toBe('October 2026')
    expect(result.reference).toContain('SYN-001')
  })

  it('marks unpaid-leave adjustment as informational so it is not deducted twice', () => {
    const adjusted = { ...item, attendance_deduction: 686 }
    const result = buildPayslipView({ company, employee, run, item: adjusted })
    expect(result.earnings.find((line) => line.label === 'Unpaid leave adjustment')?.memoOnly).toBe(true)
    expect(result.totalDeductions).toBe(7017.15)
  })
})
