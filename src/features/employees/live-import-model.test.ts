import { describe, expect, it } from 'vitest'
import { allowedTemplateBanks, dateForImport, findImportHeaderRow, hasTemplateExampleInstruction, importAttemptKey, isAllowedTemplateBank, isValidTemplateMobileNumber, liveImportFields, mapImportHeader, originalEmployeeTemplateHeaders, preserveIdentifierText, rotateImportAttemptKey, templateFieldsWithUnsupportedData } from './live-import-model'

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
      mobile_money_provider: 'Wallet Name', bank_branch_name: 'Branch',
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
})
