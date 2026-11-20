import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { duplicateWarningsForRow, extractEmployeeWorkbook, validateStagedEmployee } from './employee-import-staging'

function workbookBuffer() {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Employee Number','First Name','Surname','Job Title','LOCATION','Basic Salary','Date of Birth'],
    ['TST-001','Ada','Test','Analyst','Golden Baobab Investments',12000,'1990-04-02'],
    ['', 'Bea', '', '', 'Golden Baobab Investments', 'bad', ''],
    ['','','','','','', ''],
  ]), 'GBI')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Employee Number','First Name','Surname','Job Title','LOCATION','Basic Salary'],
    ['TST-002','Lin','Staff','Technician','Golden Baobab Investments',9000],
    ['','','','','',''],
  ]), 'Chinese Staff')
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return data as ArrayBuffer
}

const companies = [{ id: 'company-1', name: 'Golden Baobab Investments', branches: [{ id: 'branch-1', name: 'Main', status: 'Active' }] }]

describe('employee workbook staging', () => {
  it('extracts employee rows from multiple worksheets and preserves sheet and Excel row coordinates', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    expect(result.records.map(({ source_sheet, source_row }) => [source_sheet, source_row])).toEqual([
      ['GBI', 2], ['GBI', 3], ['Chinese Staff', 2],
    ])
    expect(result.records[2].company_id).toBe('company-1')
    expect(result.records[2].branch_id).toBe('branch-1')
  })

  it('keeps incomplete employee candidates in staging and reports non-employee rows separately', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    expect(result.records[1].current_data.first_name).toBe('Bea')
    expect(result.records[1].current_data.basic_pay).toBe('bad')
    expect(result.exclusions).toEqual([])
    expect(result.records[1].current_data.date_of_birth).toBe('')
  })

  it('retains employee rows when source columns are incomplete and preserves payroll-only fields', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Employee Name','Overtime','Loan Deduction','Bonus'],
      ['Kai Example',4,'invalid amount',250],
    ]), 'Payroll Inputs')
    const result = extractEmployeeWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, [])
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ source_sheet: 'Payroll Inputs', source_row: 2 })
    expect(result.records[0].original_data).toMatchObject({ 'Employee Name': 'Kai Example' })
    expect(result.records[0].current_data.first_name).toBe('')
    expect(result.records[0].payroll_data).toMatchObject({ Overtime: 4, 'Loan Deduction': 'invalid amount', Bonus: 250 })
    expect(validateStagedEmployee(result.records[0].current_data, '', '')).toContain('first_name is required')
  })

  it('validates missing details and malformed salary without rejecting workbook extraction', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    const errors = validateStagedEmployee(result.records[1].current_data, 'company-1', 'branch-1')
    expect(errors).toContain('employee_number is required')
    expect(errors).toContain('Basic salary must be a positive amount with at most two decimal places')
    expect(errors).toContain('Email or email unavailable reason is required')
  })

  it('detects same-company employee-number and identity/name collisions for review', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    const row = { ...result.records[0], current_data: { ...result.records[0].current_data, employee_number: 'TST-001' } }
    expect(duplicateWarningsForRow(row, [result.records[0]])).toContain('Employee number is repeated in this workbook')
    const nameMatch = { ...row, current_data: { ...row.current_data, employee_number: 'TST-009' } }
    expect(duplicateWarningsForRow(nameMatch, [result.records[0]])).toContain('Name is repeated in this workbook; confirm whether this is the same person')
  })

  it('requires explicit company and branch mapping before a record can be marked ready', () => {
    const complete = { employee_number:'TST-1', first_name:'Ada', last_name:'Test', date_of_birth:'1990-04-02', nationality:'Zambian', job_title:'Analyst', department:'Operations', employment_type:'PERMANENT', contract_type:'PERMANENT', contract_start_date:'2020-01-01', residential_address:'Test address', phone:'0970000000', payment_method:'CASH', email:'ada@example.test', emergency_contact_name:'Test Contact', emergency_contact_relationship:'Sibling', emergency_contact_phone:'0970000001', salary_frequency:'MONTHLY', basic_pay:'10000' }
    expect(validateStagedEmployee(complete,'','')).toContain('Company assignment is required')
    expect(validateStagedEmployee(complete,'company-1','branch-1')).toEqual([])
  })

  it('validates optional values that would otherwise fail employee creation at the database cast', () => {
    expect(validateStagedEmployee({ retirement_age: 'unknown', overtime_eligible: 'sometimes' }, 'company-1', 'branch-1'))
      .toEqual(expect.arrayContaining([
        'Retirement age must be a whole number from 18 to 100',
        'Overtime eligibility must be yes or no',
      ]))
  })
})
