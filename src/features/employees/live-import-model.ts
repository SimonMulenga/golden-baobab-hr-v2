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
  { key: 'date_of_birth', label: 'Date of birth', required: true, aliases: ['date of birth', 'dob', 'birth date'], type: 'date' },
  { key: 'gender', label: 'Gender', required: false, aliases: ['gender', 'sex'] },
  { key: 'nationality', label: 'Nationality', required: true, aliases: ['nationality', 'citizenship'] },
  { key: 'identity_document_type', label: 'Identity document type', required: true, aliases: ['identity document type', 'id type', 'document type', 'nrc or passport type'] },
  { key: 'identity_document_number', label: 'NRC / ID number', required: true, aliases: ['nrc', 'nrc number', 'identity document number', 'id number', 'passport number'] },
  { key: 'residential_address', label: 'Residential address', required: true, aliases: ['residential address', 'home address', 'address'] },
  { key: 'phone', label: 'Phone', required: true, aliases: ['phone', 'phone number', 'mobile', 'telephone'] },
  { key: 'email', label: 'Email', required: false, aliases: ['email', 'email address', 'work email'] },
  { key: 'email_unavailable_reason', label: 'Email unavailable reason', required: false, aliases: ['email unavailable reason', 'no email reason'] },
  { key: 'emergency_contact_name', label: 'Emergency contact name', required: true, aliases: ['emergency contact', 'emergency contact name', 'next of kin'] },
  { key: 'emergency_contact_relationship', label: 'Emergency contact relationship', required: true, aliases: ['emergency relationship', 'emergency contact relationship', 'next of kin relationship'] },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', required: true, aliases: ['emergency phone', 'emergency contact phone', 'next of kin phone'] },
  { key: 'tpin', label: 'TPIN', required: false, aliases: ['tpin', 'taxpayer identification number'] },
  { key: 'napsa_number', label: 'NAPSA number', required: false, aliases: ['napsa', 'napsa number', 'napsa reference'] },
  { key: 'nhima_number', label: 'NHIMA number', required: false, aliases: ['nhima', 'nhima number', 'nhima reference'] },
  { key: 'job_title', label: 'Job title', required: true, aliases: ['job title', 'position', 'role'] },
  { key: 'department', label: 'Department', required: true, aliases: ['department', 'team', 'division'] },
  { key: 'employment_type', label: 'Employment type', required: true, aliases: ['employment type', 'employee type'] },
  { key: 'contract_type', label: 'Contract type', required: true, aliases: ['contract type', 'contract category'] },
  { key: 'contract_start_date', label: 'Employment start date', required: true, aliases: ['employment start date', 'start date', 'contract start date'], type: 'date' },
  { key: 'contract_end_date', label: 'Contract end date', required: false, aliases: ['contract end date', 'end date'], type: 'date' },
  { key: 'retirement_age', label: 'Retirement age', required: true, aliases: ['retirement age'], type: 'number' },
  { key: 'salary_frequency', label: 'Salary frequency', required: true, aliases: ['salary frequency', 'pay frequency'] },
  { key: 'basic_pay', label: 'Basic pay', required: true, aliases: ['basic pay', 'basic salary'], type: 'number' },
  { key: 'housing_allowance', label: 'Housing allowance', required: false, aliases: ['housing allowance', 'house allowance'], type: 'number' },
  { key: 'meal_allowance', label: 'Meal allowance', required: false, aliases: ['meal allowance', 'lunch allowance'], type: 'number' },
  { key: 'transport_allowance', label: 'Transport allowance', required: false, aliases: ['transport allowance'], type: 'number' },
  { key: 'other_allowances', label: 'Other allowances', required: false, aliases: ['other allowances', 'other allowance'], type: 'number' },
  { key: 'overtime_eligible', label: 'Overtime eligible', required: false, aliases: ['overtime eligible', 'overtime eligibility'], type: 'boolean' },
  { key: 'payment_method', label: 'Payment method', required: true, aliases: ['payment method', 'payment channel'] },
  { key: 'bank_name', label: 'Bank name', required: false, aliases: ['bank name'] },
  { key: 'bank_account_name', label: 'Bank account name', required: false, aliases: ['bank account name', 'account name'] },
  { key: 'bank_account_number', label: 'Bank account number', required: false, aliases: ['bank account number', 'account number'] },
  { key: 'bank_branch_name', label: 'Bank branch name', required: false, aliases: ['bank branch name', 'bank branch'] },
  { key: 'mobile_money_provider', label: 'Mobile money provider', required: false, aliases: ['mobile money provider', 'mobile money network'] },
  { key: 'mobile_money_number', label: 'Mobile money number', required: false, aliases: ['mobile money number'] },
]

export function normalizeImportHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const dmy = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return ''
}

