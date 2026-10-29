import type { Company, Branch } from '../companies/types'
import type { EmployeeDirectoryRecord, FinalizedPayslipItemRecord, FinalizedPayslipRunRecord } from '../../services/live-business-services'

export type PayslipLine = { label: string; amount: number; detail?: string; memoOnly?: boolean }
export type PayslipViewModel = {
  reference: string; companyName: string; companyMark: string; companyAddress: string;
  employeeName: string; employeeNumber: string; jobTitle: string; department: string; branchName: string;
  periodLabel: string; earnings: PayslipLine[]; deductions: PayslipLine[];
  gross: number; totalDeductions: number; net: number;
}

const amount = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)
const label = (value: unknown) => typeof value === 'string' ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : ''
const monthLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-ZM', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Presents immutable finalized line items; it never recalculates payroll. */
export function buildPayslipView(input: {
  company: Company; branch?: Branch; employee: EmployeeDirectoryRecord;
  run: FinalizedPayslipRunRecord; item: FinalizedPayslipItemRecord;
}): PayslipViewModel {
  const { company, branch, employee, run, item } = input
  const breakdown = item.calculation_breakdown ?? {}
  const approvedEarnings = Array.isArray(breakdown.approved_earning_items)
    ? breakdown.approved_earning_items as Array<Record<string, unknown>> : []
  const earnings: PayslipLine[] = [
    { label: 'Basic salary', amount: amount(item.basic_pay) },
    { label: 'Housing allowance', amount: amount(item.housing_allowance) },
    { label: 'Meal allowance', amount: amount(item.meal_allowance) },
    { label: 'Transport allowance', amount: amount(item.transport_allowance) },
    { label: 'Other allowances', amount: amount(item.other_allowances) },
  ].filter((line) => line.amount !== 0)

  if (approvedEarnings.length) {
    for (const earning of approvedEarnings) {
      earnings.push({ label: label(earning.earning_type) || 'Additional earning', amount: amount(earning.amount), detail: typeof earning.source_reference === 'string' ? earning.source_reference : undefined })
    }
  } else {
    if (amount(item.overtime)) earnings.push({ label: 'Approved overtime', amount: amount(item.overtime) })
    if (amount(item.bonuses_and_other_earnings)) earnings.push({ label: 'Bonuses and other earnings', amount: amount(item.bonuses_and_other_earnings) })
  }
  if (amount(item.attendance_deduction)) earnings.push({
    label: 'Unpaid leave adjustment', amount: -amount(item.attendance_deduction),
    detail: 'Already reflected in the finalized gross earnings; informational line.', memoOnly: true,
  })

  const statutory = item.statutory_deductions ?? {}
  const deductions: PayslipLine[] = [
    { label: 'PAYE', amount: amount(statutory.PAYE) },
    { label: 'NAPSA', amount: amount(statutory.NAPSA_EMPLOYEE) },
    { label: 'NHIMA', amount: amount(statutory.NHIMA_EMPLOYEE) },
  ].filter((line) => line.amount !== 0)
  const due = Array.isArray(breakdown.due_deduction_items)
    ? breakdown.due_deduction_items as Array<Record<string, unknown>> : []
  let identifiedVoluntaryCents = 0
  for (const deduction of due) {
    const scheduled = amount(deduction.scheduled_amount)
    identifiedVoluntaryCents += cents(scheduled)
    deductions.push({
      label: label(deduction.deduction_type) || 'Approved deduction', amount: scheduled,
      detail: typeof deduction.reason === 'string' ? deduction.reason : 'Approved repayment',
    })
  }
  const voluntaryCents = cents(amount(item.voluntary_deductions))
  if (voluntaryCents > identifiedVoluntaryCents) deductions.push({ label: 'Other approved deductions', amount: (voluntaryCents - identifiedVoluntaryCents) / 100 })

  return {
    reference: `GBHR-${run.id.slice(0, 8).toUpperCase()}-${employee.employee_number}`,
    companyName: company.name, companyMark: company.logo || 'GB',
    companyAddress: [company.address, company.town, company.province].filter(Boolean).join(', '),
    employeeName: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
    employeeNumber: employee.employee_number, jobTitle: employee.job_title, department: employee.department,
    branchName: branch?.name ?? 'Assigned branch', periodLabel: monthLabel(run.payroll_periods.period_start),
    earnings, deductions, gross: amount(item.gross_pay),
    totalDeductions: (cents(amount(item.gross_pay)) - cents(amount(item.net_pay))) / 100,
    net: amount(item.net_pay),
  }
}
