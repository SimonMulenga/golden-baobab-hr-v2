import * as XLSX from '@e965/xlsx'
import { dateForImport, isValidImportDate, liveImportFields, mapEmployeeColumns, normalizeImportHeader, normalizeTemplateBank, preserveIdentifierText, type EmployeeFieldMapping } from './live-import-model'
import { calculateGrossEarningsPreview, calculateHousingAllowanceCents, formatCurrencyCents } from './employee-import-template'

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
  worksheetMappings: { sheet: string; headerRow: number; headers: string[]; mapping: EmployeeFieldMapping; conflicts: string[] }[]
  reconciliation: Record<string, unknown> & { row_count: number; basic_salary_total: number; excluded_rows: number }
}

const normalizeEnum = (value: string) => normalizeImportHeader(value).replaceAll(' ', '_').toUpperCase()
const summaryRow = (values: unknown[]) => values.some((value) => /^(grand\s+total|sub\s*total|subtotal|total\s+employees|employee\s+count)$/i.test(String(value ?? '').trim()))
const employeeSignals = new Set(['employee_number','first_name','middle_name','last_name','full_name','identity_document_number','phone','email','tpin','napsa_number','nhima_number','job_title','department','employment_type','basic_pay','housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances','gross_pay'])

export type ImportBranch = { id: string; name: string; status: string; code?: string }

/** Resolve only an exact normalized name or company-scoped branch code. Fuzzy matches are never assigned. */
export function matchAuthorizedImportBranch(value: unknown, branches: ImportBranch[]): ImportBranch | null {
  const normalized = normalizeImportHeader(value)
  if (!normalized) return null
  const active = branches.filter((branch) => branch.status.trim().toLowerCase() === 'active')
  const comparable = (value: unknown) => normalizeImportHeader(value).replace(/\s+/g, '')
  const normalizedComparable = comparable(value)
  const matches = active.filter((branch) => comparable(branch.name) === normalizedComparable
    || Boolean(branch.code && comparable(branch.code) === normalizedComparable))
  return matches.length === 1 ? matches[0] : null
}

export function matchingInactiveImportBranch(value: unknown, branches: ImportBranch[]): ImportBranch | null {
  const normalized = normalizeImportHeader(value)
  if (!normalized) return null
  const matches = branches.filter((branch) => branch.status.trim().toLowerCase() !== 'active'
    && normalizeImportHeader(branch.name) === normalized)
  return matches.length === 1 ? matches[0] : null
}

function cellValue(value: unknown, format?: unknown): unknown {
  if (value && typeof value === 'object' && 'v' in value) {
    const v = (value as { v: unknown }).v
    const dateFormat = String(format ?? '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')
    if (typeof v === 'number' && /[dmy]/i.test(dateFormat)) return dateForImport(v)
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
  if (['date_of_birth','contract_start_date','contract_end_date'].includes(key)) {
    const normalized = dateForImport(value)
    return normalized || String(value ?? '').trim()
  }
  const text = key === 'employee_number' || key.includes('number') || key === 'phone' || key === 'tpin'
    ? preserveIdentifierText(value, formatted)
    : String(value ?? '').trim()
  if (!text) return ''
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
    if (norm === 'DAILY' || norm === 'DAILY_RATED') return 'DAILY_RATED'
    if (norm === 'PART_TIME') return 'PART_TIME'
    return norm
  }
  if (['salary_frequency'].includes(key)) return normalizeEnum(text)
  if (key === 'gender') {
    const norm = normalizeEnum(text)
    if (norm === 'M') return 'MALE'
    if (norm === 'F') return 'FEMALE'
    return norm
  }
  if (key === 'bank_name') return normalizeTemplateBank(text) ?? text
  if (key === 'mobile_money_provider') {
    const norm = normalizeEnum(text)
    if (norm.includes('AIRTEL')) return 'AIRTEL'
    if (norm.includes('MTN')) return 'MTN'
    if (norm.includes('ZAMTEL')) return 'ZAMTEL'
  }
  return text
}

function amountValue(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(/[\s,]/g, '').replace(/^K/i, '')
  return /^\d+(?:\.\d{1,2})?$/.test(raw) ? Number(raw) : null
}

const payrollHeader = /allowance|lunch|meal|transport|medical|overtime|o\/t|earning|income|loan|advance|deduction|napsa|nhima|paye|levy|net pay|gross pay|bonus|commission|gratuity|arrears|reimburse|benefit|cash|bank|mobile|salary/i

export function extractEmployeeWorkbook(buffer: ArrayBuffer, companies: { id: string; name: string; branches: { id: string; name: string; status: string }[] }[], mappingOverrides: Record<string, EmployeeFieldMapping> = {}, defaultCompanyId?: string): WorkbookExtraction {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true, dense: false })
  const records: StagedWorkbookRow[] = []
  const exclusions: WorkbookExtraction['exclusions'] = []
  const sheetSummary: WorkbookExtraction['sheetSummary'] = []
  const worksheetMappings: WorkbookExtraction['worksheetMappings'] = []
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
    if (/^(instructions|readme|summary|valid\s+values)$/i.test(sheetName.trim())) continue
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
    if (!matrix.length) continue
    const headerIndex = findEmployeeHeader(matrix, sheet)
    if (headerIndex < 0) continue
    const headers = (matrix[headerIndex] ?? []).map((item, index) => {
      const address = `${XLSX.utils.encode_col(index)}${headerIndex + 1}`
      const actualCellValue = sheet[address] && typeof sheet[address] === 'object' && 'v' in sheet[address] ? (sheet[address] as XLSX.CellObject).v : item
      return String(actualCellValue ?? '').trim() || `Column ${index + 1}`
    })
    const autoMapping = mapEmployeeColumns(headers)
    const hasOverride = Object.hasOwn(mappingOverrides, sheetName)
    const mapping = mappingOverrides[sheetName] ?? autoMapping.mapping
    const mappingConflicts = hasOverride ? [] : [...autoMapping.conflicts]
    const selectedColumns = new Map<number, string[]>()
    for (const [key, column] of Object.entries(mapping)) if (column !== null && column !== undefined) selectedColumns.set(column, [...(selectedColumns.get(column) ?? []), key])
    for (const [column, keys] of selectedColumns) if (keys.length > 1) mappingConflicts.push(`Column ${column + 1} is mapped to multiple fields: ${keys.join(', ')}`)
    worksheetMappings.push({ sheet: sheetName, headerRow: headerIndex + 1, headers, mapping, conflicts: [...new Set(mappingConflicts)] })
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
      const original = Object.fromEntries(headers.map((header, column) => {
        const duplicateIndex = headers.slice(0, column).filter((prior) => prior === header).length
        const address = `${XLSX.utils.encode_col(column)}${excelRow}`
        const cell = sheet[address]
        return [duplicateIndex ? `${header} (${duplicateIndex + 1})` : header, cell ? cellValue(cell, (cell as XLSX.CellObject).z) : row[column]]
      }))
      const current = Object.fromEntries(liveImportFields.map((field) => {
        const column = mapping[field.key] ?? null
        const cell = column === null ? undefined : sheet[`${XLSX.utils.encode_col(column)}${excelRow}`]
        const raw = column === null ? '' : cell ? cellValue(cell, (cell as XLSX.CellObject).z) : row[column]
        return [field.key, canonicalValue(field.key, raw, (cell as XLSX.CellObject | undefined)?.w)]
      })) as Record<string, string>
      splitFullName(current)
      if (!current.mobile_money_provider && current.payment_method === 'MOBILE_MONEY') {
        const paymentColumn = mapping.payment_method
        const paymentSource = paymentColumn === null || paymentColumn === undefined ? '' : String(row[paymentColumn] ?? '')
        const provider = /airtel/i.test(paymentSource) ? 'AIRTEL' : /mtn/i.test(paymentSource) ? 'MTN' : /zamtel/i.test(paymentSource) ? 'ZAMTEL' : ''
        if (provider) current.mobile_money_provider = provider
      }
      const populatedSignals = [...employeeSignals].filter((key) => Boolean(current[key]?.trim()))
      const populatedEmployeeColumns = headers.some((header, column) =>
        (Object.values(mapping).includes(column) || payrollHeader.test(header))
        && String(row[column] ?? '').trim() !== '',
      )
      if (populatedSignals.length === 0 && !populatedEmployeeColumns) {
        exclusions.push({ sheet: sheetName, row: excelRow, reason: 'No employee identifying or compensation fields' })
        excluded++
        continue
      }
      const location = current.company_name
      const normalizedLocation = normalizeImportHeader(location)
      const matchedCompany = normalizedLocation ? companies.find((item) => normalizeImportHeader(item.name) === normalizedLocation) : undefined
      const company = matchedCompany ?? (!normalizedLocation ? companies.find((item) => item.id === defaultCompanyId) : undefined)
      if (company) current.company_name = company.name
      const branch = company ? matchAuthorizedImportBranch(current.branch_name, company.branches) : null
      if (branch) current.branch_name = branch.name
      const salary = amountValue(current.basic_pay)
      const housingColumn = mapping.housing_allowance
      const housingCell = housingColumn === null || housingColumn === undefined ? undefined : sheet[`${XLSX.utils.encode_col(housingColumn)}${excelRow}`]
      const housingFormula = typeof housingCell?.f === 'string' && /\*\s*30\s*%/i.test(housingCell.f)
      const uploadedHousing = housingFormula ? null : amountValue(current.housing_allowance)
      const hasHousingValue = !housingFormula && Boolean(current.housing_allowance.trim())
      const proposedHousing = salary === null ? null : calculateHousingAllowanceCents(current.basic_pay)
      if (proposedHousing !== null) current.housing_allowance_proposed = formatCurrencyCents(proposedHousing)
      if (hasHousingValue && uploadedHousing === null) {
        current.housing_allowance_source = 'IMPORTED'
        current.housing_allowance_review_required = proposedHousing === null ? 'false' : 'true'
      } else if (uploadedHousing !== null) {
        current.housing_allowance = formatCurrencyCents(Math.round(uploadedHousing * 100))
        current.housing_allowance_source = 'IMPORTED'
        if (proposedHousing !== null && Math.round(uploadedHousing * 100) !== proposedHousing) current.housing_allowance_review_required = 'true'
      } else if (proposedHousing !== null) {
        current.housing_allowance = formatCurrencyCents(proposedHousing)
        current.housing_allowance_source = 'DEFAULT_30'
      } else {
        current.housing_allowance = ''
        current.housing_allowance_source = ''
      }
      const importedGrossPay = amountValue(current.gross_pay)
      const grossPreviewValues = {
        basic_pay: current.basic_pay,
        housing_allowance: current.housing_allowance,
        meal_allowance: current.meal_allowance,
        transport_allowance: current.transport_allowance,
        other_allowances: current.other_allowances,
      }
      const calculatedGrossPay = calculateGrossEarningsPreview(grossPreviewValues, false)
      if (calculatedGrossPay.total !== null) {
        const calculatedCents = Math.round(Number(calculatedGrossPay.total) * 100)
        current.gross_pay_proposed = calculatedGrossPay.total
        current.gross_pay_review_required = ''
        if (importedGrossPay !== null && Math.round(importedGrossPay * 100) !== calculatedCents) current.gross_pay_review_required = 'true'
      } else {
        current.gross_pay_proposed = ''
        current.gross_pay_review_required = importedGrossPay === null && current.gross_pay.trim() ? 'true' : ''
      }
      if (salary !== null) basicSalaryTotal += salary
      const payrollData = Object.fromEntries(headers.flatMap((header, column) => payrollHeader.test(header) ? [[originalKey(headers, column), original[originalKey(headers, column)]]] : []))
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

  return { records, sheetSummary, exclusions, worksheetMappings, reconciliation: { row_count: records.length, basic_salary_total: Math.round(basicSalaryTotal * 100) / 100, excluded_rows: exclusions.length, consolidated_report: consolidatedReport ?? null } }
}

export function detectEmployeeUploadFormat(filename: string, buffer: ArrayBuffer): 'xlsx' | 'xls' | 'csv' {
  const extension = filename.toLowerCase().split('.').pop()
  const bytes = new Uint8Array(buffer)
  if (extension === 'xlsx' && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'xlsx'
  if (extension === 'xls' && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'xls'
  if (extension === 'csv') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
      if (text.trim() && !text.includes('\0') && /[,;\t]/.test(text.split(/\r?\n/, 1)[0] ?? '')) return 'csv'
    } catch { /* Invalid text is not an acceptable CSV payload. */ }
  }
  throw new Error('The selected file extension does not match a supported Excel workbook or UTF-8 CSV file.')
}

function findEmployeeHeader(matrix: unknown[][], sheet?: XLSX.WorkSheet): number {
  for (let index = 0; index < Math.min(matrix.length, 30); index++) {
    const rawHeaders = (matrix[index] ?? []).map((value, column) => {
      const address = `${XLSX.utils.encode_col(column)}${index + 1}`
      const actualCellValue = sheet?.[address] && typeof sheet[address] === 'object' && 'v' in sheet[address] ? (sheet[address] as XLSX.CellObject).v : value
      return String(actualCellValue ?? '').trim()
    })
    const mapped = mapEmployeeColumns(rawHeaders).mapping
    const hasIdentitySignal = Boolean(mapped.employee_number !== null || mapped.first_name !== null || mapped.last_name !== null || mapped.full_name !== null || mapped.identity_document_number !== null || mapped.phone !== null || mapped.email !== null || mapped.tpin !== null || mapped.napsa_number !== null || mapped.nhima_number !== null || mapped.job_title !== null || mapped.basic_pay !== null)
    const payrollColumnCount = rawHeaders.filter((header) => payrollHeader.test(header)).length
    if (hasIdentitySignal || payrollColumnCount >= 2) return index
  }
  return -1
}

function splitFullName(data: Record<string, string>): void {
  if (data.first_name?.trim() && data.last_name?.trim()) return
  const value = data.full_name?.trim() ?? ''
  if (!value) return
  const commaName = value.match(/^\s*([^,]+),\s*([^,]+)\s*$/)
  if (commaName) { data.last_name ||= commaName[1].trim(); data.first_name ||= commaName[2].trim(); return }
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length === 2) { data.first_name ||= parts[0]; data.last_name ||= parts[1] }
}

function originalKey(headers: string[], column: number): string {
  const header = headers[column]
  const duplicateIndex = headers.slice(0, column).filter((prior) => prior === header).length
  return duplicateIndex ? `${header} (${duplicateIndex + 1})` : header
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
  for (const key of ['housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances']) {
    if (data[key] && (!/^\d{1,12}(?:\.\d{1,2})?$/.test(data[key]) || Number(data[key]) < 0)) errors.push(`${key} must be a non-negative amount with at most two decimal places`)
  }
  if (data.housing_allowance_review_required === 'true' && !['USE_CALCULATED','USE_UPLOADED'].includes(data.housing_allowance_resolution ?? '')) errors.push('Review the imported housing allowance against the 30% default and choose which amount to keep')
  if (data.employment_type && !['PERMANENT','FIXED_TERM','PART_TIME','CASUAL','DAILY_RATED'].includes(data.employment_type)) errors.push('Employment type is not supported')
  if (data.salary_frequency && !['MONTHLY','FORTNIGHTLY','WEEKLY','DAILY'].includes(data.salary_frequency)) errors.push('Salary frequency is not supported')
  if (data.payment_method && !['BANK_TRANSFER','MOBILE_MONEY','CASH'].includes(data.payment_method)) errors.push('Payment method is not supported')
  if (data.payment_method === 'BANK_TRANSFER' && (!data.bank_name || !data.bank_account_name || !data.bank_account_number)) errors.push('Bank details are required for bank transfer')
  if (data.payment_method === 'BANK_TRANSFER' && data.bank_name && !normalizeTemplateBank(data.bank_name)) errors.push('Select a supported bank from the HR bank directory')
  if (data.payment_method === 'MOBILE_MONEY' && (!data.mobile_money_provider || !data.mobile_money_number)) errors.push('Mobile wallet details are required for mobile money')
  if (data.retirement_age?.trim() && (!/^\d{1,3}$/.test(data.retirement_age) || Number(data.retirement_age) < 18 || Number(data.retirement_age) > 100)) errors.push('Retirement age must be a whole number from 18 to 100')
  if (data.overtime_eligible?.trim() && !['true','false','yes','no','1','0','eligible','not eligible'].includes(data.overtime_eligible.trim().toLowerCase())) errors.push('Overtime eligibility must be yes or no')
  if (data.date_of_birth && !isValidImportDate(data.date_of_birth)) errors.push('Date of birth must be an unambiguous date')
  if (data.contract_start_date && !isValidImportDate(data.contract_start_date)) errors.push('Employment start date must be an unambiguous date')
  if (data.contract_end_date && !isValidImportDate(data.contract_end_date)) errors.push('Contract end date must be an unambiguous date')
  if (data.contract_start_date && data.contract_end_date && data.contract_end_date < data.contract_start_date) errors.push('Contract end date cannot precede the start date')
  return errors
}

export function recalculateStagedHousingAllowance(data: Record<string, string>, key: string, value: string): Record<string, string> {
  const next = { ...data, [key]: value }
  if (key === 'housing_allowance') { next.housing_allowance_source = 'HR_EDITED'; next.housing_allowance_resolution = '' }
  if (key === 'basic_pay') next.housing_allowance_resolution = ''
  const cents = calculateHousingAllowanceCents(next.basic_pay)
  next.housing_allowance_proposed = formatCurrencyCents(cents)
  const mismatch = cents !== null && ['IMPORTED', 'HR_EDITED'].includes(next.housing_allowance_source ?? '')
    && Math.round((amountValue(next.housing_allowance) ?? -1) * 100) !== cents
  next.housing_allowance_review_required = mismatch ? 'true' : ''
  if (next.housing_allowance_source === 'DEFAULT_30') next.housing_allowance = formatCurrencyCents(cents)
  if (!mismatch) next.housing_allowance_resolution = ''
  if (['basic_pay','housing_allowance','meal_allowance','transport_allowance','other_allowances','gross_pay'].includes(key)) {
    const gross = calculateGrossEarningsPreview(next, false)
    next.gross_pay_proposed = gross.total ?? ''
    const importedGross = amountValue(next.gross_pay)
    next.gross_pay_review_required = importedGross !== null && gross.total !== null
      && Math.round(importedGross * 100) !== Math.round(Number(gross.total) * 100) ? 'true' : ''
  }
  return next
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
