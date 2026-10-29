export type LiveImportField = {
  key: string
  label: string
  required: boolean
  aliases: string[]
  type?: 'date' | 'number' | 'boolean'
}

export const liveImportFields: LiveImportField[] = [
  { key: 'employee_number', label: 'Employee number', required: true, aliases: ['employee number', 'employee no', 'staff number', 'staff id', 'employee id'] },
  { key: 'first_name', label: 'First name', required: true, aliases: ['first name', 'firstname', 'given name', 'forename'] },
  { key: 'middle_name', label: 'Middle name', required: false, aliases: ['middle name', 'middlename', 'other names'] },
  { key: 'last_name', label: 'Last name', required: true, aliases: ['last name', 'lastname', 'surname', 'family name'] },
  { key: 'date_of_birth', label: 'Date of birth', required: false, aliases: ['date of birth', 'dob', 'birth date'], type: 'date' },
  { key: 'gender', label: 'Gender', required: false, aliases: ['gender', 'sex'] },
  { key: 'nationality', label: 'Nationality', required: false, aliases: ['nationality', 'citizenship'] },
  { key: 'identity_document_type', label: 'Identity document type', required: false, aliases: ['identity document type', 'id type', 'document type', 'nrc or passport type'] },
  { key: 'identity_document_number', label: 'NRC / ID number', required: false, aliases: ['nrc', 'nrc number', 'identity document number', 'id number', 'passport number'] },
  { key: 'residential_address', label: 'Residential address', required: false, aliases: ['residential address', 'home address', 'address'] },
  { key: 'phone', label: 'Phone', required: false, aliases: ['phone', 'phone number', 'mobile', 'telephone'] },
  { key: 'email', label: 'Email', required: false, aliases: ['email', 'email address', 'work email'] },
  { key: 'email_unavailable_reason', label: 'Email unavailable reason', required: false, aliases: ['email unavailable reason', 'no email reason'] },
  { key: 'emergency_contact_name', label: 'Emergency contact name', required: false, aliases: ['emergency contact', 'emergency contact name', 'next of kin'] },
  { key: 'emergency_contact_relationship', label: 'Emergency contact relationship', required: false, aliases: ['emergency relationship', 'emergency contact relationship', 'next of kin relationship'] },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', required: false, aliases: ['emergency phone', 'emergency contact phone', 'next of kin phone'] },
  { key: 'tpin', label: 'TPIN', required: false, aliases: ['tpin', 'taxpayer identification number'] },
  { key: 'napsa_number', label: 'NAPSA number', required: false, aliases: ['napsa', 'napsa number', 'napsa reference'] },
  { key: 'nhima_number', label: 'NHIMA number', required: false, aliases: ['nhima', 'nhima number', 'nhima reference'] },
  { key: 'job_title', label: 'Job title', required: false, aliases: ['job title', 'job role', 'position', 'position title', 'role', 'title'] },
  { key: 'department', label: 'Department', required: false, aliases: ['department', 'department name', 'team', 'division'] },
  { key: 'employment_type', label: 'Employment type', required: false, aliases: ['employment type', 'employee type'] },
  { key: 'contract_type', label: 'Contract type', required: false, aliases: ['contract type', 'contract category'] },
  { key: 'contract_start_date', label: 'Employment start date', required: false, aliases: ['employment start date', 'start date', 'contract start date'], type: 'date' },
  { key: 'contract_end_date', label: 'Contract end date', required: false, aliases: ['contract end date', 'end date'], type: 'date' },
  { key: 'retirement_age', label: 'Retirement age', required: false, aliases: ['retirement age'], type: 'number' },
  { key: 'salary_frequency', label: 'Salary frequency', required: false, aliases: ['salary frequency', 'pay frequency'] },
  { key: 'basic_pay', label: 'Basic pay', required: true, aliases: ['basic pay', 'basic salary'], type: 'number' },
  { key: 'housing_allowance', label: 'Housing allowance', required: false, aliases: ['housing allowance', 'house allowance'], type: 'number' },
  { key: 'meal_allowance', label: 'Meal allowance', required: false, aliases: ['meal allowance', 'lunch allowance'], type: 'number' },
  { key: 'transport_allowance', label: 'Transport allowance', required: false, aliases: ['transport allowance'], type: 'number' },
  { key: 'other_allowances', label: 'Other allowances', required: false, aliases: ['other allowances', 'other allowance'], type: 'number' },
  { key: 'annual_leave_days', label: 'Annual leave days', required: false, aliases: ['annual leave days', 'annual leave entitlement'], type: 'number' },
  { key: 'loan_or_other_deduction', label: 'Loan or other deduction', required: false, aliases: ['loan or other deduction', 'loan deduction', 'other deduction'], type: 'number' },
  { key: 'deduction_label', label: 'Deduction label', required: false, aliases: ['deduction label', 'deduction name'] },
  { key: 'overtime_eligible', label: 'Overtime eligible', required: false, aliases: ['overtime eligible', 'overtime eligibility'], type: 'boolean' },
  { key: 'payment_method', label: 'Payment method', required: false, aliases: ['payment method', 'payment channel', 'pay method'] },
  { key: 'bank_name', label: 'Bank name', required: false, aliases: ['bank name'] },
  { key: 'bank_account_name', label: 'Bank account name', required: false, aliases: ['bank account name', 'account name'] },
  { key: 'bank_account_number', label: 'Bank account number', required: false, aliases: ['bank account number', 'account number'] },
  { key: 'bank_branch_name', label: 'Bank branch name', required: false, aliases: ['branch', 'bank branch name', 'bank branch'] },
  { key: 'sort_code', label: 'Bank sort code', required: false, aliases: ['sort code', 'bank sort code'] },
  { key: 'mobile_money_provider', label: 'Mobile money provider or wallet', required: false, aliases: ['mobile money provider', 'mobile money network', 'wallet name'] },
  { key: 'mobile_money_number', label: 'Mobile money number', required: false, aliases: ['mobile money number'] },
  { key: 'employment_status', label: 'Employment status', required: false, aliases: ['status', 'employment status'] },
]

export const originalEmployeeTemplateHeaders = [
  'Employee No *', 'First Name *', 'Surname *', 'Other Names', 'NRC', 'Date of Birth', 'Phone', 'Email', 'Job Title', 'Department',
  'Employment Type', 'Start Date', 'Status', 'TPIN', 'NAPSA No', 'NHIMA No', 'Annual Leave Days', 'Basic Salary *', 'Housing Allowance',
  'Transport Allowance', 'Other Allowances', 'Loan or Other Deduction', 'Deduction Label', 'Pay Method', 'Bank', 'Branch', 'Sort Code',
  'Account Number', 'Account Name', 'Mobile Money Number', 'Wallet Name',
] as const

export const unsupportedTemplateFieldHeaders = ['Annual Leave Days', 'Loan or Other Deduction', 'Deduction Label', 'Sort Code'] as const
export const allowedTemplateBanks = [
  'AB Bank Zambia', 'Absa Bank Zambia', 'Access Bank Zambia', 'Bank of China (Zambia)', 'Citibank Zambia', 'Ecobank Zambia',
  'First Alliance Bank Zambia', 'First Capital Bank Zambia', 'First National Bank Zambia (FNB)', 'Indo-Zambia Bank',
  'Stanbic Bank Zambia', 'Standard Chartered Zambia', 'United Bank for Africa (UBA) Zambia',
  'Zambia Industrial Commercial Bank (ZICB)', 'Zambia National Commercial Bank (Zanaco)',
] as const

export function templateFieldsWithUnsupportedData(headers: string[], populatedHeaders: string[]): string[] {
  const normalizedPopulated = new Set(populatedHeaders.map(normalizeImportHeader))
  return headers.filter((header) => unsupportedTemplateFieldHeaders.some((unsupported) => normalizeImportHeader(unsupported) === normalizeImportHeader(header)) && normalizedPopulated.has(normalizeImportHeader(header)))
}

export function preserveIdentifierText(value: unknown, formattedValue?: string): string {
  if (formattedValue?.trim()) return formattedValue.trim()
  return String(value ?? '').trim()
}

export function hasTemplateExampleInstruction(rows: unknown[][]): boolean {
  return rows.some((row) => row.some((cell) => normalizeImportHeader(cell).includes('replace the example row')))
}

export function isAllowedTemplateBank(value: string): boolean {
  return allowedTemplateBanks.some((bank) => normalizeImportHeader(bank) === normalizeImportHeader(value))
}

export function isValidTemplateMobileNumber(value: string, paymentMethod: string): boolean {
  if (!/^0\d{9}$/.test(value)) return false
  const prefix = value.slice(0, 3)
  const provider = normalizeImportHeader(paymentMethod)
  if (provider.includes('airtel')) return ['097', '077', '057'].includes(prefix)
  if (provider.includes('mtn')) return ['096', '076', '056'].includes(prefix)
  if (provider.includes('zamtel')) return ['095', '075', '055'].includes(prefix)
  return ['097', '077', '057', '096', '076', '056', '095', '075', '055'].includes(prefix)
}

export function normalizeImportHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

export function findImportHeaderRow(matrix: unknown[][]): number {
  let bestIndex = 0
  let bestScore = 0
  for (let index = 0; index < Math.min(matrix.length, 30); index++) {
    const normalized = new Set(matrix[index].map(normalizeImportHeader))
    const score = liveImportFields.reduce((count, field) => count + (field.aliases.some((alias) => normalized.has(normalizeImportHeader(alias))) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; bestIndex = index }
  }
  return bestIndex
}

export function mapImportHeader(headers: string[]): Record<string, string> {
  const normalized = headers.map((header) => ({ header, normalized: normalizeImportHeader(header) }))
  return Object.fromEntries(liveImportFields.map((field) => {
    const aliases = field.aliases.map(normalizeImportHeader)
    return [field.key, normalized.find((item) => aliases.includes(item.normalized))?.header ?? '']
  }))
}

export function dateForImport(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return validIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  const text = String(value ?? '').trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const dmy = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/)
  if (dmy) return validIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
  return ''
}

function validIsoDate(year: number, month: number, day: number): string {
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isValidImportDate(value: unknown): boolean {
  return dateForImport(value) !== ''
}

export function importAttemptKey(companyId: string, branchId: string): string {
  const storageKey = `golden-baobab:employee-import:${companyId}:${branchId}`
  try {
    const existing = sessionStorage.getItem(storageKey)
    if (existing) return existing
  } catch { /* A blocked session store still permits a single-tab attempt. */ }
  return rotateImportAttemptKey(companyId, branchId)
}

export function rotateImportAttemptKey(companyId: string, branchId: string): string {
  const next = crypto.randomUUID()
  try { sessionStorage.setItem(`golden-baobab:employee-import:${companyId}:${branchId}`, next) }
  catch { /* The server still enforces employee-number uniqueness and atomicity. */ }
  return next
}
