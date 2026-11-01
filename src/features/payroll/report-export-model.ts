import type { EmployeeDirectoryRecord, FinalizedPayslipItemRecord } from '../../services/live-business-services'
import * as XLSX from '@e965/xlsx'

export const PAYE_HEADINGS = [
  'tpin', 'fullName', 'employmentNature', 'grossEmoluments', 'chargeableEmoluments', 'totalTaxCredit', 'taxDeducted', 'taxAdjusted',
] as const

export const CASH_HEADINGS = ['#', 'EMP NO', 'NAME', 'TOTAL EARNINGS', 'STAT DEDUCTIONS', 'GEN DEDUCTIONS', 'TOTAL DEDUCTIONS', 'NET PAY'] as const
export const BANK_HEADINGS = ['NAME', 'NRC NO.', 'BRANCH NAME', 'ACCOUNT NO.', 'AMOUNT'] as const
export const ADVANCE_HEADINGS = ['EMP NO.', 'NAME', 'DEDUCTION NAME', 'MONTHLY AMT', 'INITIAL AMT', 'OUTSTANDING AMT'] as const
export const MOBILE_MONEY_HEADINGS = ['EMP NO', 'EMPLOYEE NAME', 'PAYMENT PROVIDER', 'REGISTERED MOBILE NUMBER', 'NET PAY'] as const

export type PrivateReportDetails = {
  employee_id: string
  identity_document_number: string | null
  tpin: string | null
  napsa_number: string | null
  nhima_number: string | null
  payment_method: 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CASH'
  bank_account_name: string | null
  bank_account_number: string | null
  bank_branch_name: string | null
  mobile_money_provider: string | null
  mobile_money_number: string | null
}

export type DueDeduction = { deduction_id?: string; deduction_type: string; scheduled_amount: number }
export type DeductionReportRecord = {
  id: string; employee_id: string; deduction_type: string; reason: string; principal_amount: number; amount_deducted: number; status: string
}
export type ReportLine = Record<string, string | number>
export type ReportValidation = { rows: ReportLine[]; errors: Array<{ employee: string; field: string; reason: string }> }

export function buildReportWorkbook(rows: ReportLine[], headings: readonly string[], sheetName: string, totalColumn?: string, totalLabel = 'TOTAL') {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headings] })
  if (totalColumn) {
    const total = rows.reduce((sum, row) => sum + numeric(row[totalColumn]), 0)
    const totalRow: Record<string, string | number> = Object.fromEntries(headings.map((heading) => [heading, '']))
    totalRow[headings[0]] = totalLabel
    totalRow[totalColumn] = round2(total)
    XLSX.utils.sheet_add_json(sheet, [totalRow], { header: [...headings], skipHeader: true, origin: -1 })
  }
  sheet['!cols'] = headings.map((heading) => ({ wch: Math.max(12, Math.min(34, heading.length + 5)) }))
  for (const address of Object.keys(sheet)) {
    if (!/^[A-Z]+\d+$/.test(address)) continue
    const cell = sheet[address]
    const column = XLSX.utils.decode_cell(address).c
    const heading = headings[column]
    if (cell?.t === 'n' && heading && !['#'].includes(heading)) cell.z = '#,##0.00'
    if (XLSX.utils.decode_cell(address).r === 0 && cell) cell.s = { font: { bold: true } }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31))
  return workbook
}

const numeric = (value: unknown) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const employeeName = (employee?: EmployeeDirectoryRecord) => [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ')
const employeeRef = (employee?: EmployeeDirectoryRecord) => employee?.employee_number ?? 'Unknown employee'
const statutory = (item: FinalizedPayslipItemRecord, key: string) => numeric(item.statutory_deductions?.[key])
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const deductionLabel = (type: string) => ({
  EMPLOYEE_LOAN: 'Employee Loan', SALARY_ADVANCE: 'Salary Advance', MEDICAL_ADVANCE: 'Medical Advance',
  EDUCATIONAL_ADVANCE: 'Educational Advance', OTHER_ADVANCE: 'Other Advance',
}[type] ?? 'Authorized Deduction')

export function buildCashPayrollReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    const details = privateDetails.get(item.employee_id)
    if (!employee) { errors.push({ employee: item.employee_id, field: 'Employee', reason: 'Employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'Payment method', reason: 'Private payment settings are not available under your permissions.' }); continue }
    if (details.payment_method !== 'CASH') continue
    const statutoryDeductions = round2(statutory(item, 'PAYE') + statutory(item, 'NAPSA_EMPLOYEE') + statutory(item, 'NHIMA_EMPLOYEE'))
    const totalDeductions = round2(numeric(item.gross_pay) - numeric(item.net_pay))
    const generalDeductions = round2(totalDeductions - statutoryDeductions)
    if (generalDeductions < -0.01) { errors.push({ employee: employeeRef(employee), field: 'Deductions', reason: 'Finalized deduction totals do not reconcile with statutory deductions.' }); continue }
    rows.push({ '#': rows.length + 1, 'EMP NO': employee.employee_number, NAME: employeeName(employee), 'TOTAL EARNINGS': numeric(item.gross_pay), 'STAT DEDUCTIONS': statutoryDeductions, 'GEN DEDUCTIONS': Math.max(0, generalDeductions), 'TOTAL DEDUCTIONS': totalDeductions, 'NET PAY': numeric(item.net_pay) })
  }
  return { rows, errors }
}

export function buildBankPayrollReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>, branchNames: Map<string, string>): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    const details = privateDetails.get(item.employee_id)
    if (!employee) { errors.push({ employee: item.employee_id, field: 'Employee', reason: 'Employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'Bank details', reason: 'Private bank details are not available under your permissions.' }); continue }
    if (details.payment_method !== 'BANK_TRANSFER') continue
    if (!details.identity_document_number) errors.push({ employee: employeeRef(employee), field: 'NRC NO.', reason: 'The required identity number is missing.' })
    if (!details.bank_account_name) errors.push({ employee: employeeRef(employee), field: 'Account name', reason: 'The required bank account name is missing.' })
    if (!details.bank_account_number) errors.push({ employee: employeeRef(employee), field: 'ACCOUNT NO.', reason: 'The required bank account number is missing.' })
    const branchName = branchNames.get(employee.workplace_branch_id)
    if (!branchName) errors.push({ employee: employeeRef(employee), field: 'BRANCH NAME', reason: 'The authorized branch name is unavailable.' })
    if (!details.identity_document_number || !details.bank_account_name || !details.bank_account_number || !branchName) continue
    rows.push({ NAME: employeeName(employee), 'NRC NO.': details.identity_document_number, 'BRANCH NAME': branchName, 'ACCOUNT NO.': details.bank_account_number, AMOUNT: numeric(item.net_pay) })
  }
  return { rows, errors }
}

export function buildMobileMoneyPayrollReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    const details = privateDetails.get(item.employee_id)
    if (!employee) { errors.push({ employee: item.employee_id, field: 'Employee', reason: 'Employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'Payment details', reason: 'Private mobile payment details are not available under your permissions.' }); continue }
    if (details.payment_method !== 'MOBILE_MONEY') continue
    const name = employeeName(employee)
    if (!name) errors.push({ employee: employeeRef(employee), field: 'EMPLOYEE NAME', reason: 'The required employee name is missing.' })
    if (!details.mobile_money_provider?.trim()) errors.push({ employee: employeeRef(employee), field: 'PAYMENT PROVIDER', reason: 'The registered mobile payment provider is missing.' })
    if (!details.mobile_money_number?.trim()) errors.push({ employee: employeeRef(employee), field: 'REGISTERED MOBILE NUMBER', reason: 'The registered mobile number is missing.' })
    if (!name || !details.mobile_money_provider?.trim() || !details.mobile_money_number?.trim()) continue
    rows.push({ 'EMP NO': employee.employee_number, 'EMPLOYEE NAME': name, 'PAYMENT PROVIDER': details.mobile_money_provider.trim(), 'REGISTERED MOBILE NUMBER': details.mobile_money_number.trim(), 'NET PAY': numeric(item.net_pay) })
  }
  return { rows, errors }
}

export function buildPayeReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    const details = privateDetails.get(item.employee_id)
    if (!employee) { errors.push({ employee: item.employee_id, field: 'Employee', reason: 'Employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'TPIN', reason: 'Private statutory identifiers are not available under your permissions.' }); continue }
    if (!details.tpin) errors.push({ employee: employeeRef(employee), field: 'tpin', reason: 'The required TPIN is missing.' })
    if (!employee.contract_type) errors.push({ employee: employeeRef(employee), field: 'employmentNature', reason: 'Employment nature is missing.' })
    // The supplied PAYE sample has non-zero tax credits, but the immutable payroll
    // snapshot has no tax-credit field. Do not invent a zero or derive a tax credit.
    errors.push({ employee: employeeRef(employee), field: 'totalTaxCredit', reason: 'The payroll snapshot does not retain the tax-credit amount required by the supplied PAYE sample.' })
    if (!details.tpin || !employee.contract_type) continue
  }
  return { rows, errors }
}

export function buildAdvanceReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, deductions: DeductionReportRecord[]): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const itemByEmployee = new Map(items.map((item) => [item.employee_id, item]))
  for (const deduction of deductions) {
    if (!['EMPLOYEE_LOAN', 'SALARY_ADVANCE', 'MEDICAL_ADVANCE', 'EDUCATIONAL_ADVANCE', 'OTHER_ADVANCE'].includes(deduction.deduction_type)) continue
    if (!['APPROVED', 'ACTIVE', 'PAUSED'].includes(deduction.status)) continue
    const employee = employees.get(deduction.employee_id)
    const payrollItem = itemByEmployee.get(deduction.employee_id)
    if (!employee || !payrollItem) continue
    const dueItems = Array.isArray(payrollItem.calculation_breakdown?.due_deduction_items) ? payrollItem.calculation_breakdown.due_deduction_items as DueDeduction[] : []
    const matchingDueItems = dueItems.filter((entry) => entry.deduction_id === deduction.id)
    if (matchingDueItems.length > 1) {
      errors.push({ employee: employeeRef(employee), field: 'MONTHLY AMT', reason: 'The finalized payroll snapshot contains duplicate repayment entries for this loan or advance.' })
      continue
    }
    const monthlyAmount = matchingDueItems.reduce((sum, entry) => sum + numeric(entry.scheduled_amount), 0)
    rows.push({
      'EMP NO.': employee.employee_number, NAME: employeeName(employee), 'DEDUCTION NAME': deductionLabel(deduction.deduction_type),
      'MONTHLY AMT': round2(monthlyAmount), 'INITIAL AMT': numeric(deduction.principal_amount),
      'OUTSTANDING AMT': round2(numeric(deduction.principal_amount) - numeric(deduction.amount_deducted)),
    })
  }
  return { rows, errors }
}

export const REPORT_BLOCKERS: Record<string, string> = {
  NAPSA: 'The supplied 12-column CSV has no headers. Its positional field meanings cannot be reliably mapped from the sample alone; export remains disabled until the client supplies the field order or a labelled specification.',
  NHIMA: 'The supplied 12-column CSV has no headers. Its positional field meanings cannot be reliably mapped from the sample alone; export remains disabled until the client supplies the field order or a labelled specification.',
  PAYE: 'The supplied PAYE workbook contains non-zero totalTaxCredit values, but finalized payroll snapshots do not retain a tax-credit amount. PAYE export remains blocked until that value is persisted through an approved payroll calculation change.',
  LEAVE: 'The supplied leave report includes DAYS SOLD, which is not represented in the leave ledger; the sample also has B/F values without formulas defining a revised opening-balance calculation. Export remains blocked pending an approved days-sold mapping and revised calculation rule.',
  MASTER: 'The supplied master report separates consultancy fee, gratuity, withholding tax and multiple advance fields. Current finalized snapshots do not retain all of these categories; export remains blocked until the payroll snapshot can populate them exactly.',
}
