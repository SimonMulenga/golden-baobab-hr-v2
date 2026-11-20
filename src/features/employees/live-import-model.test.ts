import { describe, expect, it } from 'vitest'
import { allowedTemplateBanks, dateForImport, employeeTemplateColumns, findImportHeaderRow, hasTemplateExampleInstruction, importAttemptKey, isAllowedTemplateBank, isValidTemplateMobileNumber, liveImportFields, mapEmployeeColumns, mapImportHeader, normalizeTemplateBank, originalEmployeeTemplateHeaders, preserveIdentifierText, rotateImportAttemptKey, templateFieldsWithUnsupportedData } from './live-import-model'

describe('LIVE employee import mapping', () => {
  it('finds a flexible header row after report title rows and maps known aliases', () => {
    const matrix = [
      ['Copperbelt company employee list'],
      ['Generated on', '28 October 2026'],
      ['Staff ID', 'Given Name', 'Surname', 'NRC Number', 'Department', 'Basic Salary'],
      ['SYN-001', 'Demo', 'Person', 'SYN-NRC-001', 'Finance', 6000],
    ]
    const index = findImportHeaderRow(matrix)
    expect(index).toBe(2)
    expect(mapImportHeader(matrix[index].map(String))).toMatchObject({
      employee_number: 'Staff ID', first_name: 'Given Name', last_name: 'Surname',
      identity_document_number: 'NRC Number', department: 'Department', basic_pay: 'Basic Salary',
    })
  })

  it('normalizes explicit date values without guessing ambiguous timestamps', () => {
    expect(dateForImport('2026-10-28')).toBe('2026-10-28')
    expect(dateForImport('3/2/2026')).toBe('2026-02-03')
    expect(dateForImport('28 October 2026')).toBe('')
    expect(dateForImport('2026-02-29')).toBe('')
    expect(dateForImport('31/04/2026')).toBe('')
    expect(dateForImport('29/02/2024')).toBe('2024-02-29')
  })

  it('maps all 31 original template headings without using its example employee row', () => {
    expect(originalEmployeeTemplateHeaders).toHaveLength(31)
    const mapping = mapImportHeader([...originalEmployeeTemplateHeaders])
    expect(mapping).toMatchObject({
      employee_number: 'Employee No *', first_name: 'First Name *', last_name: 'Surname *', basic_pay: 'Basic Salary *',
      middle_name: 'Other Names', identity_document_number: 'NRC', employment_status: 'Status', annual_leave_days: 'Annual Leave Days',
      loan_or_other_deduction: 'Loan or Other Deduction', deduction_label: 'Deduction Label', sort_code: 'Sort Code',
      mobile_money_provider: 'Wallet Name', bank_branch_name: '',
    })
    expect(liveImportFields.filter((field) => field.required).map((field) => field.key)).toEqual(['employee_number', 'first_name', 'last_name', 'basic_pay'])
  })

  it('preserves formatted identifier text and reports populated fields the current endpoint cannot store', () => {
    expect(preserveIdentifierText(123, '000123')).toBe('000123')
    expect(preserveIdentifierText('000123')).toBe('000123')
    expect(templateFieldsWithUnsupportedData([...originalEmployeeTemplateHeaders], ['Annual Leave Days', 'Sort Code', 'Account Number']))
      .toEqual(['Annual Leave Days', 'Sort Code'])
  })

  it('recognizes the template example-row instruction without reading employee example values', () => {
    expect(hasTemplateExampleInstruction([['How to fill'], ['Replace the example row with your employees, one per row.']])).toBe(true)
    expect(hasTemplateExampleInstruction([['Employee No *'], ['SYN-001']])).toBe(false)
  })

  it('validates only the bank and mobile-money values listed in the workbook instructions', () => {
    expect(allowedTemplateBanks).toHaveLength(15)
    expect(isAllowedTemplateBank('Zambia National Commercial Bank (Zanaco)')).toBe(true)
    expect(normalizeTemplateBank('ABSA')).toBe('Absa Bank Zambia')
    expect(normalizeTemplateBank('Absa Bank, Zambia')).toBe('Absa Bank Zambia')
    expect(isAllowedTemplateBank('Unknown Bank')).toBe(false)
    expect(isValidTemplateMobileNumber('0971234567', 'Airtel Money')).toBe(true)
    expect(isValidTemplateMobileNumber('0961234567', 'MTN MoMo')).toBe(true)
    expect(isValidTemplateMobileNumber('0971234567', 'Zamtel Kwacha')).toBe(false)
    expect(isValidTemplateMobileNumber('260971234567', 'Airtel Money')).toBe(false)
  })

  it('retains an interrupted import key in the current tab and rotates only for a new attempt', () => {
    sessionStorage.clear()
    const first = importAttemptKey('synthetic-company', 'synthetic-branch')
    expect(importAttemptKey('synthetic-company', 'synthetic-branch')).toBe(first)
    const next = rotateImportAttemptKey('synthetic-company', 'synthetic-branch')
    expect(next).not.toBe(first)
    expect(importAttemptKey('synthetic-company', 'synthetic-branch')).toBe(next)
  })

  it('keeps the approved template headings exact and in their required order', () => {
    expect(employeeTemplateColumns.map((column) => column.heading)).toEqual([
      'Employee Number','First Name','Middle Name','Last Name','Date of Birth','Gender','Nationality','NRC / ID Number',
      'Residential Address','Phone Number','Email','Email Unavailable Reason','Company','Branch','Department','Job Title',
      'Employment Type','Contract Type','Date Joined','Salary Frequency','Basic Salary','Housing allowance 30% of basic pay',
      'Lunch Allwance','Transport Alwance','Other allowances','Groce Pay (Sum of all the earnings)','Payment Method','Bank Name',
      'Bank Account Name','Bank Account Number','Mobile Money Provider','Mobile Money Number','TPIN','NAPSA Number','NHIMA Number','Emergency Contact Name',
      'Emergency Contact Relationship','Emergency Contact Phone Number',
    ])
    expect(employeeTemplateColumns).toHaveLength(38)
  })

  it('maps workbook aliases without assigning one source column to multiple targets silently', () => {
    const mapped = mapEmployeeColumns(['Employee No','Surname','Given Name','Monthly Salary','Housing 30%','Lunch Allwance','Transport Alwance','Medical','Other allowances','Work Location','Groce Pay (Sum of all the earnings)'])
    expect(mapped.mapping).toMatchObject({ employee_number: 0, last_name: 1, first_name: 2, basic_pay: 3, housing_allowance: 4, meal_allowance: 5, transport_allowance: 6, medical_allowance: 7, other_allowances: 8, branch_name: 9, gross_pay: 10 })
    const ambiguous = mapEmployeeColumns(['Basic Pay','Monthly Salary'])
    expect(ambiguous.mapping.basic_pay).toBeNull()
    expect(ambiguous.conflicts).toContain('Basic pay matches multiple columns')
    const duplicateSource = mapEmployeeColumns(['Branch'])
    expect(duplicateSource.mapping.branch_name).toBe(0)
    expect(duplicateSource.mapping.bank_branch_name).toBeNull()
  })
})
