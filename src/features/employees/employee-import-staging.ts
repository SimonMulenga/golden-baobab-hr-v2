import * as XLSX from '@e965/xlsx'
import { dateForImport, isValidImportDate, liveImportFields, mapImportHeader, normalizeImportHeader, preserveIdentifierText } from './live-import-model'

export type StagedWorkbookRow = {
  source_sheet: string
  source_row: number
  company_id: string | null
  branch_id: string | null
  original_data: Record<string, unknown>
  current_data: Record<string, string>
  payroll_data: Record<string, unknown>
}

export type WorkbookExtraction = {
  records: StagedWorkbookRow[]
  sheetSummary: { sheet: string; extracted: number; excluded: number }[]
  exclusions: { sheet: string; row: number; reason: string }[]
  reconciliation: Record<string, unknown> & { row_count: number; basic_salary_total: number; excluded_rows: number }
}

const normalizeEnum = (value: string) => normalizeImportHeader(value).replaceAll(' ', '_').toUpperCase()
const companyHeader = (value: string) => ['location', 'company', 'company name', 'employing company', 'workplace'].includes(normalizeImportHeader(value))
const summaryRow = (values: unknown[]) => values.some((value) => /^(grand\s+total|sub\s*total|subtotal|total\s+employees|employee\s+count)$/i.test(String(value ?? '').trim()))
const employeeSignals = new Set(['employee_number','first_name','middle_name','last_name','identity_document_number','phone','email','tpin','napsa_number','nhima_number','job_title','department','employment_type','basic_pay'])

function cellValue(value: unknown, format?: string): unknown {
  if (value && typeof value === 'object' && 'v' in value) {
    const v = (value as { v: unknown }).v
    const w = (value as { w?: string }).w
    if (typeof v === 'number' && format?.toLowerCase().includes('d')) return dateForImport(w ?? v)
    return v
  }
  return value
}

function canonicalValue(key: string, value: unknown, formatted?: string): string {
  const field = liveImportFields.find((item) => item.key === key)
  if (field?.type === 'number') {
    const parsed = amountValue(value)
    if (parsed !== null) return String(parsed)
  }
  const text = key === 'employee_number' || key.includes('number') || key === 'phone' || key === 'tpin'
    ? preserveIdentifierText(value, formatted)
    : String(value ?? '').trim()
  if (!text) return ''
  if (['date_of_birth','contract_start_date','contract_end_date'].includes(key)) return dateForImport(text)
  if (key === 'payment_method') {
    const norm = normalizeEnum(text)
    if (norm.includes('AIRTEL') || norm.includes('MTN') || norm.includes('ZAMTEL') || norm === 'MOBILE_MONEY') return 'MOBILE_MONEY'
    if (norm.includes('BANK')) return 'BANK_TRANSFER'
    if (norm === 'CASH') return 'CASH'
    return norm
  }
  if (key === 'overtime_eligible') {
    const norm = normalizeImportHeader(text)
    return ['yes','true','1','eligible'].includes(norm) ? 'true' : ['no','false','0','not eligible'].includes(norm) ? 'false' : text
  }
  if (key === 'employment_type') {
    const norm = normalizeEnum(text)
    if (norm === 'FIXED_TERM_CONTRACT') return 'FIXED_TERM'
    if (norm === 'DAILY') return 'DAILY_RATED'
    return norm
  }
  if (['salary_frequency'].includes(key)) return normalizeEnum(text)
  if (key === 'gender') return normalizeEnum(text)
  return text
}

function amountValue(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(/[\s,]/g, '').replace(/^K/i, '')
  return /^\d+(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : null
}

const payrollHeader = /allowance|overtime|o\/t|earning|income|loan|advance|deduction|napsa|nhima|paye|levy|net pay|gross pay|bonus|commission|gratuity|arrears|reimburse|benefit|cash|bank|mobile|salary/i
const combinedNameHeader = (value: string) => ['name','employee name','full name','staff name','name of employee'].includes(normalizeImportHeader(value))

export function extractEmployeeWorkbook(buffer: ArrayBuffer, companies: { id: string; name: string; branches: { id: string; name: string; status: string }[] }[]): WorkbookExtraction {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true, dense: false })
  const records: StagedWorkbookRow[] = []
  const exclusions: WorkbookExtraction['exclusions'] = []
  const sheetSummary: WorkbookExtraction['sheetSummary'] = []
  let basicSalaryTotal = 0

  let consolidatedReport: Record<string, unknown> | undefined
  for (const sheetName of workbook.SheetNames) {
    if (/napsa.*paye/i.test(sheetName)) {
      const summarySheet = workbook.Sheets[sheetName]
      const numberOfEmployees = summarySheet.D12?.v
      const basicSubtotal = summarySheet.E12?.v
      const brokenFormulas = Object.entries(summarySheet).flatMap(([address, cell]) => {
        if (!/^[A-Z]+\d+$/.test(address) || !cell || typeof cell !== 'object') return []
        const value = (cell as XLSX.CellObject).v
        const formula = (cell as XLSX.CellObject).f
        if ((cell as XLSX.CellObject).t !== 'e' && String(value ?? '').toUpperCase() !== '#REF!') return []
        const row = Number(address.match(/\d+$/)?.[0] ?? 0)
        return [{ cell: address, row, error: String(value ?? '#REF!'), formula: formula ?? '' }]
      })
      consolidatedReport = { worksheet: sheetName, employee_count: Number(numberOfEmployees) || null, basic_subtotal: amountValue(basicSubtotal), count_cell: 'D12', subtotal_cell: 'E12', broken_formulas: brokenFormulas }
      continue
    }
    if (/^(instructions|readme|summary)$/i.test(sheetName.trim())) continue
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
    if (!matrix.length) continue
    const headerIndex = findEmployeeHeader(matrix)
    if (headerIndex < 0) continue
    const headers = (matrix[headerIndex] ?? []).map((item, index) => String(item ?? '').trim() || `Column ${index + 1}`)
    const mapping = mapImportHeader(headers)
    const mappedEmployeeHeaders = new Set(Object.values(mapping).filter(Boolean))
    const companyColumn = headers.findIndex(companyHeader)
    let extracted = 0
    let excluded = 0

    for (let index = headerIndex + 1; index < matrix.length; index++) {
      const row = matrix[index] ?? []
      if (!row.some((cell) => String(cell ?? '').trim())) continue
      const excelRow = index + 1
      if (summaryRow(row)) {
        exclusions.push({ sheet: sheetName, row: excelRow, reason: 'Summary or subtotal row' })
        excluded++
        continue
      }
      const original = Object.fromEntries(headers.map((header, column) => [header, cellValue(row[column], sheet[`${XLSX.utils.encode_col(column)}${excelRow}`]?.z)]))
      const current = Object.fromEntries(liveImportFields.map((field) => {
        const column = mapping[field.key]
        const cell = column ? sheet[`${XLSX.utils.encode_col(headers.indexOf(column))}${excelRow}`] : undefined
        const raw = column ? row[headers.indexOf(column)] : ''
        return [field.key, canonicalValue(field.key, cellValue(raw, cell?.z), cell?.w)]
      })) as Record<string, string>
      if (!current.mobile_money_provider && current.payment_method === 'MOBILE_MONEY') {
        const paymentSource = mapping.payment_method ? String(row[headers.indexOf(mapping.payment_method)] ?? '') : ''
        const provider = /airtel/i.test(paymentSource) ? 'AIRTEL' : /mtn/i.test(paymentSource) ? 'MTN' : /zamtel/i.test(paymentSource) ? 'ZAMTEL' : ''
        if (provider) current.mobile_money_provider = provider
      }
      const populatedSignals = [...employeeSignals].filter((key) => Boolean(current[key]?.trim()))
      const populatedEmployeeColumns = headers.some((header, column) =>
        (combinedNameHeader(header) || mappedEmployeeHeaders.has(header) || payrollHeader.test(header))
        && String(row[column] ?? '').trim() !== '',
      )
      if (populatedSignals.length === 0 && !populatedEmployeeColumns) {
        exclusions.push({ sheet: sheetName, row: excelRow, reason: 'No employee identifying or compensation fields' })
        excluded++
        continue
      }
      const location = companyColumn >= 0 ? String(row[companyColumn] ?? '').trim() : sheetName
      const normalizedLocation = normalizeImportHeader(location)
      const company = companies.find((item) => normalizeImportHeader(item.name) === normalizedLocation)
      const activeBranches = company?.branches.filter((item) => item.status === 'Active') ?? []
      const branch = activeBranches.length === 1 ? activeBranches[0] : undefined
      const salaryField = mapping.basic_pay
      const salary = salaryField ? amountValue(row[headers.indexOf(salaryField)]) : null
      if (salary !== null) basicSalaryTotal += salary
      const payrollData = Object.fromEntries(headers.filter((header) => payrollHeader.test(header)).map((header) => [header, original[header]]))
      records.push({
        source_sheet: sheetName,
        source_row: excelRow,
        company_id: company?.id ?? null,
        branch_id: branch?.id ?? null,
        original_data: original,
        current_data: current,
        payroll_data: payrollData,
      })
      extracted++
    }
    sheetSummary.push({ sheet: sheetName, extracted, excluded })
  }

  return { records, sheetSummary, exclusions, reconciliation: { row_count: records.length, basic_salary_total: Math.round(basicSalaryTotal * 100) / 100, excluded_rows: exclusions.length, consolidated_report: consolidatedReport ?? null } }
}

function findEmployeeHeader(matrix: unknown[][]): number {
  for (let index = 0; index < Math.min(matrix.length, 30); index++) {
    const rawHeaders = (matrix[index] ?? []).map((value) => String(value ?? '').trim())
    const mapped = mapImportHeader(rawHeaders)
    const hasIdentitySignal = Boolean(mapped.employee_number || mapped.first_name || mapped.last_name || mapped.identity_document_number || mapped.phone || mapped.email || mapped.tpin || mapped.napsa_number || mapped.nhima_number || mapped.job_title || mapped.basic_pay)
    const payrollColumnCount = rawHeaders.filter((header) => payrollHeader.test(header)).length
    if (hasIdentitySignal || rawHeaders.some(combinedNameHeader) || payrollColumnCount >= 2) return index
  }
  return -1
}

export const requiredStagingFields = [
  'employee_number','first_name','last_name','date_of_birth','nationality','job_title','department',
  'employment_type','contract_type','contract_start_date','residential_address','phone','payment_method',
  'emergency_contact_name','emergency_contact_relationship','emergency_contact_phone','salary_frequency','basic_pay',
] as const

export function validateStagedEmployee(data: Record<string, string>, companyId: string, branchId: string): string[] {
  const errors = requiredStagingFields.filter((key) => !String(data[key] ?? '').trim()).map((key) => `${key} is required`)
  if (!companyId) errors.push('Company assignment is required')
  if (!branchId) errors.push('Branch assignment is required')
  if (!data.email?.trim() && !data.email_unavailable_reason?.trim()) errors.push('Email or email unavailable reason is required')
  if (data.email?.trim() && !/^\S+@\S+\.\S+$/.test(data.email)) errors.push('Email is invalid')
  if (data.basic_pay && (!/^\d{1,12}(?:\.\d{1,2})?$/.test(data.basic_pay) || Number(data.basic_pay) <= 0)) errors.push('Basic salary must be a positive amount with at most two decimal places')
  for (const key of ['housing_allowance','meal_allowance','transport_allowance','other_allowances']) {
    if (data[key] && (!/^\d{1,12}(?:\.\d{1,2})?$/.test(data[key]) || Number(data[key]) < 0)) errors.push(`${key} must be a non-negative amount with at most two decimal places`)
  }
  if (data.employment_type && !['PERMANENT','FIXED_TERM','PART_TIME','CASUAL','DAILY_RATED'].includes(data.employment_type)) errors.push('Employment type is not supported')
  if (data.salary_frequency && !['MONTHLY','FORTNIGHTLY','WEEKLY','DAILY'].includes(data.salary_frequency)) errors.push('Salary frequency is not supported')
  if (data.payment_method && !['BANK_TRANSFER','MOBILE_MONEY','CASH'].includes(data.payment_method)) errors.push('Payment method is not supported')
  if (data.payment_method === 'BANK_TRANSFER' && (!data.bank_name || !data.bank_account_name || !data.bank_account_number)) errors.push('Bank details are required for bank transfer')
  if (data.payment_method === 'MOBILE_MONEY' && (!data.mobile_money_provider || !data.mobile_money_number)) errors.push('Mobile wallet details are required for mobile money')
  if (data.retirement_age?.trim() && (!/^\d{1,3}$/.test(data.retirement_age) || Number(data.retirement_age) < 18 || Number(data.retirement_age) > 100)) errors.push('Retirement age must be a whole number from 18 to 100')
  if (data.overtime_eligible?.trim() && !['true','false','yes','no','1','0','eligible','not eligible'].includes(data.overtime_eligible.trim().toLowerCase())) errors.push('Overtime eligibility must be yes or no')
  if (data.date_of_birth && !isValidImportDate(data.date_of_birth)) errors.push('Date of birth must be an unambiguous date')
  if (data.contract_start_date && !isValidImportDate(data.contract_start_date)) errors.push('Employment start date must be an unambiguous date')
  if (data.contract_end_date && !isValidImportDate(data.contract_end_date)) errors.push('Contract end date must be an unambiguous date')
  if (data.contract_start_date && data.contract_end_date && data.contract_end_date < data.contract_start_date) errors.push('Contract end date cannot precede the start date')
  return errors
}

export function duplicateWarningsForRow(row: StagedWorkbookRow, prior: StagedWorkbookRow[]): string[] {
  const number = row.current_data.employee_number.trim().toLocaleLowerCase()
  const identity = row.current_data.identity_document_number.trim().toLocaleLowerCase()
  const name = `${row.current_data.first_name} ${row.current_data.last_name}`.trim().toLocaleLowerCase()
  return prior.filter((item) => item.company_id === row.company_id && item.branch_id === row.branch_id).flatMap((item) => {
    if (number && item.current_data.employee_number.trim().toLocaleLowerCase() === number) return ['Employee number is repeated in this workbook']
    if (identity && item.current_data.identity_document_number.trim().toLocaleLowerCase() === identity) return ['Identity reference is repeated in this workbook']
    if (name && `${item.current_data.first_name} ${item.current_data.last_name}`.trim().toLocaleLowerCase() === name) return ['Name is repeated in this workbook; confirm whether this is the same person']
    return []
  })
}
