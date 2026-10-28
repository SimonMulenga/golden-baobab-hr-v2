import { createContext, useContext } from 'react'
import type { DeductionInstallment } from './deduction-schedule'

export type DemoDeduction = {
  id: string; employeeId: string; employeeName: string; companyId: string; branchId: string
  type: string; principalCents: number; balanceCents: number; reason: string
  initiatedBy?: string; approvedBy?: string; approvedAt?: string
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED'
  schedule: DeductionInstallment[]; postedRunIds: string[]
}
export type DemoPayrollRun = {
  id: string; companyId: string; branchId: string; period: string; createdBy: string
  status: 'CALCULATED' | 'SUBMITTED_FOR_APPROVAL' | 'UNDER_REVIEW' | 'RETURNED_FOR_CORRECTION' | 'REJECTED' | 'APPROVED' | 'FINALIZED'
  version: number; employeeCount: number; grossCents: number; deductionCents: number
  netCents: number | null; warnings: string[]; events: { type: string; reason?: string; at: string }[]
  postedDeductionIds: string[]
  statutoryDeductionCents?: number
  employeeBreakdowns?: { employeeId: string; employeeName: string; grossCents: number; payeCents: number; napsaCents: number; nhimaCents: number; netCents: number }[]
}
export type PayrollStore = {
  deductions: DemoDeduction[]; runs: DemoPayrollRun[]
  saveDeduction: (item: DemoDeduction) => void; saveRun: (item: DemoPayrollRun) => void
  finalizeRun: (runId: string) => void
}
export const PayrollContext = createContext<PayrollStore | null>(null)
export function usePayroll() {
  const context = useContext(PayrollContext)
  if (!context) throw new Error('Payroll demo state is not available')
  return context
}
