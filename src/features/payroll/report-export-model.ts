import type { EmployeeDirectoryRecord, FinalizedPayslipItemRecord, LeaveLedgerReportRecord } from '../../services/live-business-services'
import * as XLSX from '@e965/xlsx'

// Reference workbooks illustrate the report types and presentation. The report
// columns are based on fields actually present in the authorized payroll snapshot.
export const PAYE_HEADINGS = ['Employee Number', 'Employee Name', 'TPIN', 'Employment Nature', 'Gross Emoluments', 'Chargeable Emoluments', 'Tax Deducted'] as const
export const LEAVE_HEADINGS = ['Company', 'Branch', 'Payroll Period', 'Employee Number', 'Employee Name', 'Accrued (Period)', 'Leave Taken (Period)', 'Adjustments (Period)', 'Balance at Period End'] as const
export const MASTER_HEADINGS = ['Employee Number', 'Employee Name', 'Basic Pay', 'Housing Allowance', 'Meal Allowance', 'Transport Allowance', 'Other Allowances', 'Overtime', 'Bonus / Other Earnings', 'Gross Pay', 'PAYE', 'Employee NAPSA', 'Employer NAPSA', 'Employee NHIMA', 'Employer NHIMA', 'Other Deductions', 'Net Pay', 'Employer Cost'] as const
export const PAYROLL_REGISTER_HEADINGS = ['EMP NO', 'EMPLOYEE', 'DEPARTMENT', 'BASIC PAY', 'ALLOWANCES', 'OVERTIME', 'BONUS / OTHER', 'GROSS PAY', 'PAYE', 'NAPSA EE', 'NAPSA ER', 'NHIMA EE', 'NHIMA ER', 'OTHER DEDUCTIONS', 'NET PAY', 'EMPLOYER COST'] as const

export const CASH_HEADINGS = ['#', 'EMP NO', 'NAME', 'TOTAL EARNINGS', 'STAT DEDUCTIONS', 'GEN DEDUCTIONS', 'TOTAL DEDUCTIONS', 'NET PAY'] as const
export const BANK_HEADINGS = ['EMP NO', 'NAME', 'NRC NO.', 'BRANCH NAME', 'ACCOUNT NO.', 'AMOUNT'] as const
export const ADVANCE_HEADINGS = ['EMP NO.', 'NAME', 'DEDUCTION NAME', 'MONTHLY AMT', 'INITIAL AMT', 'AMOUNT RECOVERED', 'OUTSTANDING AMT'] as const
export const MOBILE_MONEY_HEADINGS = ['EMP NO', 'EMPLOYEE NAME', 'PAYMENT PROVIDER', 'REGISTERED MOBILE NUMBER', 'NET PAY'] as const
export const NAPSA_HEADINGS = ['Company', 'Branch', 'Payroll Period', 'Employee Number', 'Employee Name', 'NAPSA Number', 'Employee Contribution', 'Employer Contribution', 'Total Contribution'] as const
export const NHIMA_HEADINGS = ['Company', 'Branch', 'Payroll Period', 'Employee Number', 'Employee Name', 'NHIMA Number', 'Employee Contribution', 'Employer Contribution', 'Total Contribution'] as const

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

const csvCell = (value: string | number) => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function buildReportCsv(rows: ReportLine[], headings: readonly string[]): string {
  const lines = [headings, ...rows.map((row) => headings.map((heading) => row[heading] ?? ''))]
  return `\uFEFF${lines.map((row) => row.map((value) => csvCell(value as string | number)).join(',')).join('\r\n')}`
}

export function buildReportWorkbook(rows: ReportLine[], headings: readonly string[], sheetName: string, totalColumn?: string | readonly string[], totalLabel = 'TOTAL') {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headings] })
  if (totalColumn) {
    const totalRow: Record<string, string | number> = Object.fromEntries(headings.map((heading) => [heading, '']))
    totalRow[headings[0]] = totalLabel
    for (const column of typeof totalColumn === 'string' ? [totalColumn] : totalColumn) {
      if (headings.includes(column)) totalRow[column] = round2(rows.reduce((sum, row) => sum + numeric(row[column]), 0))
    }
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
const hasNumericValue = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
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
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
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
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'Bank details', reason: 'Private bank details are not available under your permissions.' }); continue }
    if (details.payment_method !== 'BANK_TRANSFER') continue
    if (!employee.employee_number?.trim()) errors.push({ employee: employeeRef(employee), field: 'EMP NO', reason: 'The required employee number is missing.' })
    if (!details.identity_document_number) errors.push({ employee: employeeRef(employee), field: 'NRC NO.', reason: 'The required identity number is missing.' })
    if (!details.bank_account_name) errors.push({ employee: employeeRef(employee), field: 'Account name', reason: 'The required bank account name is missing.' })
    if (!details.bank_account_number) errors.push({ employee: employeeRef(employee), field: 'ACCOUNT NO.', reason: 'The required bank account number is missing.' })
    const branchName = branchNames.get(employee.workplace_branch_id)
    if (!branchName) errors.push({ employee: employeeRef(employee), field: 'BRANCH NAME', reason: 'The authorized branch name is unavailable.' })
    if (!employee.employee_number?.trim() || !details.identity_document_number || !details.bank_account_name || !details.bank_account_number || !branchName) continue
    rows.push({ 'EMP NO': employee.employee_number, NAME: employeeName(employee), 'NRC NO.': details.identity_document_number, 'BRANCH NAME': branchName, 'ACCOUNT NO.': details.bank_account_number, AMOUNT: numeric(item.net_pay) })
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
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
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

type StatutoryReportContext = { companyName: string; branchName: string; payrollPeriod: string }

function buildContributionReport(
  kind: 'NAPSA' | 'NHIMA', items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>,
  privateDetails: Map<string, PrivateReportDetails>, context: StatutoryReportContext,
): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  const idField = kind === 'NAPSA' ? 'napsa_number' : 'nhima_number'
  const employeeKey = kind === 'NAPSA' ? 'napsa_employee' : 'nhima_employee'
  const employerKey = kind === 'NAPSA' ? 'napsa_employer' : 'nhima_employer'
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    const details = privateDetails.get(item.employee_id)
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: `${kind} Number`, reason: 'Private statutory details are unavailable under your permissions.' }); continue }
    const statutoryId = details[idField]?.trim()
    const name = employeeName(employee)
    if (!employee.employee_number?.trim()) errors.push({ employee: employeeRef(employee), field: 'Employee Number', reason: 'The required employee number is missing.' })
    if (!name) errors.push({ employee: employeeRef(employee), field: 'Employee Name', reason: 'The required employee name is missing.' })
    if (!statutoryId) errors.push({ employee: employeeRef(employee), field: `${kind} Number`, reason: `The required ${kind} identifier is missing.` })
    const employeeContribution = Number(item[employeeKey])
    const employerContribution = Number(item[employerKey])
    if (!hasNumericValue(item[employeeKey]) || !hasNumericValue(item[employerKey])) {
      errors.push({ employee: employeeRef(employee), field: 'Contribution', reason: 'The finalized contribution amount is invalid.' })
      continue
    }
    if (!employee.employee_number?.trim() || !name || !statutoryId) continue
    rows.push({
      Company: context.companyName, Branch: context.branchName, 'Payroll Period': context.payrollPeriod,
      'Employee Number': employee.employee_number, 'Employee Name': name, [`${kind} Number`]: statutoryId,
      'Employee Contribution': round2(employeeContribution), 'Employer Contribution': round2(employerContribution),
      'Total Contribution': round2(employeeContribution + employerContribution),
    })
  }
  return { rows, errors }
}

export function buildNapsaReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>, context: StatutoryReportContext): ReportValidation {
  return buildContributionReport('NAPSA', items, employees, privateDetails, context)
}

export function buildNhimaReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, privateDetails: Map<string, PrivateReportDetails>, context: StatutoryReportContext): ReportValidation {
  return buildContributionReport('NHIMA', items, employees, privateDetails, context)
}

export function buildLeaveDaysReport(
  items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>, ledger: LeaveLedgerReportRecord[],
  context: StatutoryReportContext & { periodStart: string; periodEnd: string },
): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    const entries = ledger.filter((entry) => entry.employee_id === item.employee_id && entry.period_start <= context.periodEnd)
    const inPeriod = entries.filter((entry) => entry.period_start >= context.periodStart && entry.period_start <= context.periodEnd)
    const accrued = round2(inPeriod.filter((entry) => entry.event_type === 'ACCRUAL').reduce((sum, entry) => sum + numeric(entry.amount_delta), 0))
    const taken = round2(Math.abs(inPeriod.filter((entry) => entry.event_type === 'PAID_LEAVE').reduce((sum, entry) => sum + numeric(entry.amount_delta), 0)))
    const adjustments = round2(inPeriod.filter((entry) => entry.event_type === 'ADJUSTMENT' || entry.event_type === 'REVERSAL').reduce((sum, entry) => sum + numeric(entry.amount_delta), 0))
    const balance = round2(entries.reduce((sum, entry) => sum + numeric(entry.amount_delta), 0))
    rows.push({
      Company: context.companyName, Branch: context.branchName, 'Payroll Period': context.payrollPeriod,
      'Employee Number': employee.employee_number, 'Employee Name': employeeName(employee),
      'Accrued (Period)': accrued, 'Leave Taken (Period)': taken, 'Adjustments (Period)': adjustments, 'Balance at Period End': balance,
    })
  }
  return { rows, errors }
}

export function buildMasterPayrollReport(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>): ReportValidation {
  const rows: ReportLine[] = []
  const errors: ReportValidation['errors'] = []
  const seen = new Set<string>()
  for (const item of items) {
    const employee = employees.get(item.employee_id)
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!employee.employee_number?.trim() || !employeeName(employee)) { errors.push({ employee: employeeRef(employee), field: 'Employee identity', reason: 'The required employee number or name is missing.' }); continue }
    rows.push({
      'Employee Number': employee.employee_number, 'Employee Name': employeeName(employee), 'Basic Pay': numeric(item.basic_pay),
      'Housing Allowance': numeric(item.housing_allowance), 'Meal Allowance': numeric(item.meal_allowance),
      'Transport Allowance': numeric(item.transport_allowance), 'Other Allowances': numeric(item.other_allowances),
      Overtime: numeric(item.overtime), 'Bonus / Other Earnings': numeric(item.bonuses_and_other_earnings), 'Gross Pay': numeric(item.gross_pay),
      PAYE: statutory(item, 'PAYE'), 'Employee NAPSA': numeric(item.napsa_employee), 'Employer NAPSA': numeric(item.napsa_employer),
      'Employee NHIMA': numeric(item.nhima_employee), 'Employer NHIMA': numeric(item.nhima_employer),
      'Other Deductions': numeric(item.voluntary_deductions), 'Net Pay': numeric(item.net_pay), 'Employer Cost': numeric(item.total_employer_cost),
    })
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
    if (!employee) { errors.push({ employee: 'Employee', field: 'Employee', reason: 'An employee record is unavailable under the current access scope.' }); continue }
    if (seen.has(item.employee_id)) { errors.push({ employee: employeeRef(employee), field: 'Employee', reason: 'Duplicate employee line in finalized payroll.' }); continue }
    seen.add(item.employee_id)
    if (!details) { errors.push({ employee: employeeRef(employee), field: 'TPIN', reason: 'Private statutory identifiers are not available under your permissions.' }); continue }
    const name = employeeName(employee)
    if (!details.tpin) errors.push({ employee: employeeRef(employee), field: 'TPIN', reason: 'The required TPIN is missing.' })
    if (!employee.contract_type) errors.push({ employee: employeeRef(employee), field: 'Employment nature', reason: 'Employment nature is missing.' })
    if (!name) errors.push({ employee: employeeRef(employee), field: 'Employee name', reason: 'The required employee name is missing.' })
    if (!details.tpin || !employee.contract_type || !employee.employee_number?.trim() || !name) continue
    if (!hasNumericValue(item.gross_pay) || !hasNumericValue(item.paye_taxable_income) || !hasNumericValue(item.statutory_deductions?.PAYE)) {
      errors.push({ employee: employeeRef(employee), field: 'PAYE amounts', reason: 'A required finalized gross, chargeable-income or PAYE amount is missing.' })
      continue
    }
    rows.push({
      'Employee Number': employee.employee_number, 'Employee Name': name, TPIN: details.tpin.trim(), 'Employment Nature': employee.contract_type,
      'Gross Emoluments': numeric(item.gross_pay), 'Chargeable Emoluments': numeric(item.paye_taxable_income), 'Tax Deducted': statutory(item, 'PAYE'),
    })
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
    if (!employee.employee_number?.trim() || !employeeName(employee)) {
      errors.push({ employee: employeeRef(employee), field: 'Employee identity', reason: 'The required employee number or name is missing.' })
      continue
    }
    if (!hasNumericValue(deduction.principal_amount) || !hasNumericValue(deduction.amount_deducted) || numeric(deduction.amount_deducted) > numeric(deduction.principal_amount)) {
      errors.push({ employee: employeeRef(employee), field: 'Loan balance', reason: 'The stored principal or recovered amount is missing or inconsistent.' })
      continue
    }
    const monthlyAmount = matchingDueItems.reduce((sum, entry) => sum + numeric(entry.scheduled_amount), 0)
    rows.push({
      'EMP NO.': employee.employee_number, NAME: employeeName(employee), 'DEDUCTION NAME': deductionLabel(deduction.deduction_type),
      'MONTHLY AMT': round2(monthlyAmount), 'INITIAL AMT': numeric(deduction.principal_amount), 'AMOUNT RECOVERED': numeric(deduction.amount_deducted),
      'OUTSTANDING AMT': round2(numeric(deduction.principal_amount) - numeric(deduction.amount_deducted)),
    })
  }
  return { rows, errors }
}
