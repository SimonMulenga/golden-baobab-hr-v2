import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { detectEmployeeUploadFormat, duplicateWarningsForRow, extractEmployeeWorkbook, matchAuthorizedImportBranch, matchingInactiveImportBranch, missingOptionalEmployeeFields, recalculateStagedHousingAllowance, validateStagedEmployee } from './employee-import-staging'
import { calculateGrossEarningsPreview, calculateHousingAllowanceCents, formatCurrencyCents } from './employee-import-template'
import { employeeTemplateColumns } from './live-import-model'

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

describe('workplace branch import mapping', () => {
  const branches = [
    { id: 'branch-lusaka', name: 'Lusaka Headquarters', code: 'LSK-01', status: 'ACTIVE' },
    { id: 'branch-other', name: 'Copperbelt Office', code: 'CB-02', status: 'ACTIVE' },
    { id: 'branch-closed', name: 'Lusaka Headqautera', code: 'LSK-OLD', status: 'INACTIVE' },
  ]

  it('maps exact normalized branch names and company-scoped branch codes only', () => {
    expect(matchAuthorizedImportBranch('  LUSAKA   HEADQUARTERS ', branches)?.id).toBe('branch-lusaka')
    expect(matchAuthorizedImportBranch('LUSAKA—HEADQUARTERS', branches)).toBeNull()
    expect(matchAuthorizedImportBranch('LSK-01', branches)?.id).toBe('branch-lusaka')
    expect(matchAuthorizedImportBranch('lsk 01', branches)).toBeNull()
    expect(matchAuthorizedImportBranch('Lusaka Head', branches)).toBeNull()
    expect(matchAuthorizedImportBranch('Lusaka Headquarters', [branches[0], { ...branches[0], id: 'duplicate' }])).toBeNull()
  })

  it('does not assign an inactive exact match and reports it separately for HR', () => {
    expect(matchAuthorizedImportBranch('LUSAKA HEADQAUTERA', branches)).toBeNull()
    expect(matchingInactiveImportBranch('LUSAKA HEADQAUTERA', branches)?.id).toBe('branch-closed')
  })

  it('uses the workbook Branch column as the canonical workplace branch assignment', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Employee Number', 'First Name', 'Last Name', 'Company', 'Branch'],
      ['SYN-BRANCH', 'Test', 'Worker', 'Golden Baobab Investments', 'Main'],
    ]), 'Employees')
    const result = extractEmployeeWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, companies)
    expect(result.records[0]).toMatchObject({ branch_id: 'branch-1', current_data: { branch_name: 'Main' } })
  })

  it('matches multi-company rows only to exact registered organizations and rejects cross-company branches', () => {
    const secondCompany = { id: 'company-2', name: 'Second Company', branches: [{ id: 'branch-2', name: 'Harbor', status: 'ACTIVE' }] }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['First Name','Last Name','Company','Branch','Department','Basic Salary'],
      ['Ada','One',' golden   baobab investments ','Main','Finance',6000],
      ['Mina','Two','Second Company','Harbor','HR',5000],
      ['Kai','Three','Second Company','Main','IT',4000],
      ['Unknown','Org','Second Company XYZ','Harbor','HR',3000],
    ]), 'Employees')
    const result = extractEmployeeWorkbook(XLSX.write(workbook,{type:'array',bookType:'xlsx'}) as ArrayBuffer,[companies[0],secondCompany])
    expect(result.records.map((row)=>[row.company_id,row.branch_id])).toEqual([
      ['company-1','branch-1'],['company-2','branch-2'],['company-2',null],[null,null],
    ])
  })
})

describe('employee workbook staging', () => {
  it('extracts employee rows from multiple worksheets and preserves sheet and Excel row coordinates', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    expect(result.records.map(({ source_sheet, source_row }) => [source_sheet, source_row])).toEqual([
      ['GBI', 2], ['GBI', 3], ['Chinese Staff', 2],
    ])
    expect(result.records[2].company_id).toBe('company-1')
    expect(result.records[2].branch_id).toBeNull()
    expect(result.records[2].current_data.branch_name).toBe('')
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
    expect(result.records[0].current_data.first_name).toBe('Kai')
    expect(result.records[0].current_data.last_name).toBe('Example')
    expect(result.records[0].payroll_data).toMatchObject({ Overtime: 4, 'Loan Deduction': 'invalid amount', Bonus: 250 })
    expect(validateStagedEmployee(result.records[0].current_data, '', '')).toContain('Company assignment is required')
  })

  it('validates missing details and malformed salary without rejecting workbook extraction', () => {
    const result = extractEmployeeWorkbook(workbookBuffer(), companies)
    const errors = validateStagedEmployee(result.records[1].current_data, 'company-1', 'branch-1')
    expect(errors).toContain('last_name is required')
    expect(errors).toContain('department is required')
    expect(errors).toContain('Basic salary must be a valid positive amount with at most two decimal places')
    expect(errors).not.toContain('Email or email unavailable reason is required')
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

  it('reports payment details according to the selected payment method', () => {
    expect(missingOptionalEmployeeFields({ payment_method: '' })).not.toContain('Bank details')
    expect(missingOptionalEmployeeFields({ payment_method: 'BANK_TRANSFER' })).toContain('Bank details')
    expect(missingOptionalEmployeeFields({ payment_method: 'MOBILE_MONEY' })).toContain('Mobile money details')
    expect(missingOptionalEmployeeFields({ payment_method: 'CASH' })).not.toContain('Mobile money details')
  })

  it('generates the exact blank 41-column template and supporting sheets with allowance formulas', async () => {
    const buffer = new Uint8Array(readFileSync('public/employee-template.xlsx')).buffer
    const template = XLSX.read(buffer, { type: 'array', cellFormula: true })
    expect(template.SheetNames).toEqual(['Employees', 'Instructions', 'Valid Values'])
    const worksheet = template.Sheets.Employees
    expect(XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: true })[0]).toEqual(employeeTemplateColumns.map((column) => column.heading))
    expect(employeeTemplateColumns).toHaveLength(41)
    expect(employeeTemplateColumns.slice(0, 8).map(({ heading }) => heading)).toEqual([
      'First Name *','Middle Name','Last Name *','Employee Number (optional)','Company *','Branch *','Department *','Basic Salary (ZMW) *',
    ])
    expect(employeeTemplateColumns.map(({ key }) => key)).toContain('medical_allowance')
    const excel = new ExcelJS.Workbook()
    const loaded = await excel.xlsx.load(Buffer.from(buffer) as never)
    const sheet = loaded.getWorksheet('Employees')!
    expect(sheet.getCell('A1').font.bold).toBe(true)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(sheet.getColumn(1).width).toBeGreaterThan(0)
    expect(sheet.getCell('A2').value).toBeNull()
    expect(sheet.getCell('I2').value).toMatchObject({ formula: 'IF(H2="","",ROUND(H2*30%,2))' })
    expect(sheet.getCell('I501').value).toMatchObject({ formula: 'IF(H501="","",ROUND(H501*30%,2))' })
    expect(sheet.getCell('N2').value).toMatchObject({ formula: 'IF(H2="","",SUM(H2:M2))' })
    expect(sheet.getCell('N501').value).toMatchObject({ formula: 'IF(H501="","",SUM(H501:M501))' })
    expect(sheet.getCell('AJ2').numFmt).toBe('@')
    expect((sheet.model as unknown as { sheetProtection?: unknown }).sheetProtection).toBeFalsy()
    for (const cell of ['A2','AO2','AH2','AK2','A501','AO501']) expect(sheet.getCell(cell).protection?.locked ?? false).toBe(false)
    expect(loaded.getWorksheet('Valid Values')?.getCell('A2').value).toBe('Male')
    const validations = (sheet as unknown as { dataValidations: { model: Record<string, { formulae: string[] }> } }).dataValidations.model
    expect(validations.V2.formulae).toEqual(['=GenderValues'])
    expect(validations.P2.formulae).toEqual(['=EmploymentTypeValues'])
    expect(validations.O2.formulae).toEqual(['=SalaryFrequencyValues'])
    expect(validations.AF2.formulae).toEqual(['=PaymentMethodValues'])
    expect(validations.AG2.formulae).toEqual(['=BankNameValues'])
    const parsedBlank = extractEmployeeWorkbook(buffer, companies)
    expect(parsedBlank.records).toEqual([])
    expect(parsedBlank.worksheetMappings.map(({ sheet }) => sheet)).toEqual(['Employees'])
  })

  it('round-trips the template, recalculates housing from salary, and maps all allowance columns', () => {
    const excel = new ExcelJS.Workbook()
    const source = readFileSync('public/employee-template.xlsx')
    return excel.xlsx.load(source as never).then(async (template) => {
    const worksheet = template.getWorksheet('Employees')!
    const indexes = Object.fromEntries(employeeTemplateColumns.map((column, index) => [column.key, index]))
    const values: Record<string, string | number | Date> = {
      employee_number: 'SYN-0007', first_name: 'Mina', last_name: 'Test', company_name: 'Golden Baobab Investments', branch_name: 'North Office', department: 'Finance',
      basic_pay: 8000, meal_allowance: 450, transport_allowance: 250, other_allowances: 80, gross_pay: 10980,
      phone: '0970000007', tpin: '0000001234', contract_start_date: '2026-11-01',
      date_of_birth: new Date('1990-04-02T00:00:00Z'),
      contract_type: 'Permanent', salary_frequency: 'Monthly', bank_account_name: 'Mina Test', bank_account_number: '00012345',
      gender: 'F', employment_type: 'Fixed-term contract', payment_method: 'Bank transfer', bank_name: 'ABSA',
    }
    for (const [key, value] of Object.entries(values)) {
      worksheet.getCell(2, indexes[key] + 1).value = value
    }
    const output = await template.xlsx.writeBuffer()
    const buffer = new Uint8Array(output).buffer as ArrayBuffer
    const result = extractEmployeeWorkbook(buffer, [{ ...companies[0], branches: [{ id: 'north-1', name: 'North Office', status: 'ACTIVE' }] }])
    expect(result.records).toHaveLength(1)
    const employee = result.records[0]
    expect(employee.current_data).toMatchObject({
      employee_number: 'SYN-0007', first_name: 'Mina', last_name: 'Test', basic_pay: '8000',
      housing_allowance: '2400.00', housing_allowance_source: 'DEFAULT_30', meal_allowance: '450',
      transport_allowance: '250', other_allowances: '80', phone: '0970000007', tpin: '0000001234', gross_pay_proposed: '11180.00', gross_pay_review_required: 'true',
      contract_type: 'Permanent', salary_frequency: 'MONTHLY', bank_account_name: 'Mina Test', bank_account_number: '00012345',
      date_of_birth: '1990-04-02', contract_start_date: '2026-11-01',
      gender: 'FEMALE', employment_type: 'FIXED_TERM', payment_method: 'BANK_TRANSFER', bank_name: 'Absa Bank Zambia',
    })
    expect(employee.company_id).toBe('company-1')
    expect(employee.branch_id).toBe('north-1')
    expect(employee.original_data['Housing allowance 30% of basic pay']).toBe('')
    expect(employee.payroll_data).toMatchObject({ 'Basic Salary (ZMW) *': 8000, 'Gross Pay (earnings preview)': 10980, 'Bank Account Name': 'Mina Test', 'Bank Account Number': '00012345' })
    expect(employee.current_data.gross_pay).toBe('10980')
    })
  })

  it('keeps the reported incomplete candidate stageable with bank, contract, frequency, and branch details missing', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(readFileSync('public/employee-template.xlsx') as never)
    const worksheet = workbook.getWorksheet('Employees')!
    const columns = Object.fromEntries(employeeTemplateColumns.map((column, index) => [column.key, index + 1]))
    worksheet.getCell(2, columns.employee_number).value = 'BEN-002'
    worksheet.getCell(2, columns.first_name).value = 'SIMON'
    worksheet.getCell(2, columns.last_name).value = 'MULENGA'
    worksheet.getCell(2, columns.company_name).value = 'Golden Baobab Investments'
    worksheet.getCell(2, columns.department).value = 'IT'
    worksheet.getCell(2, columns.basic_pay).value = 5000
    worksheet.getCell(2, columns.payment_method).value = 'Bank transfer'
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer as ArrayBuffer
    const parsed = extractEmployeeWorkbook(buffer, companies, {}, 'company-1')
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({
      company_id: 'company-1', branch_id: null,
      current_data: {
        employee_number: 'BEN-002', first_name: 'SIMON', last_name: 'MULENGA', department: 'IT',
        basic_pay: '5000', housing_allowance: '1500.00', housing_allowance_proposed: '1500.00',
        gross_pay_proposed: '6500.00', bank_account_name: '', contract_type: '', salary_frequency: '',
      },
    })
    expect(validateStagedEmployee(parsed.records[0].current_data, 'company-1', '')).toEqual(expect.arrayContaining([
      'Branch assignment is required',
    ]))
  })

  it('supports UTF-8 CSV, keeps incomplete rows, and rejects extension/content mismatches', () => {
    const csv = new TextEncoder().encode('Employee No,Staff Name,Basic Pay,Work Location\nSYN-1,Ada Example,,Unknown Branch\n').buffer
    expect(detectEmployeeUploadFormat('staff.csv', csv)).toBe('csv')
    const parsed = extractEmployeeWorkbook(csv, companies)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].current_data).toMatchObject({ employee_number: 'SYN-1', first_name: 'Ada', last_name: 'Example', basic_pay: '', branch_name: 'Unknown Branch' })
    expect(parsed.records[0].branch_id).toBeNull()
    expect(() => detectEmployeeUploadFormat('staff.xlsx', csv)).toThrow(/extension does not match/)
    expect(() => detectEmployeeUploadFormat('staff.csv', new Uint8Array([0, 1, 2, 3]).buffer)).toThrow(/extension does not match/)
  })

  it('flags an uploaded housing amount that differs from 30% and recalculates proposals after salary corrections', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Employee Number','First Name','Last Name','Basic Salary','Housing Allowance'],
      ['SYN-2','Ada','Example',5000,1000],
    ]), 'Employees')
    const row = extractEmployeeWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, []).records[0]
    expect(row.current_data).toMatchObject({ housing_allowance: '1000.00', housing_allowance_proposed: '1500.00', housing_allowance_review_required: 'true' })
    expect(validateStagedEmployee(row.current_data, 'company-1', 'branch-1')).toContain('Review the imported housing allowance against the 30% default and choose which amount to keep')
    const recalculated = calculateHousingAllowanceCents('8050.01')
    expect(formatCurrencyCents(recalculated)).toBe('2415.00')
    expect(calculateHousingAllowanceCents('5000')).toBe(150000)
    expect(calculateHousingAllowanceCents('8000')).toBe(240000)
    expect(calculateHousingAllowanceCents('10000')).toBe(300000)
    const reviewed = recalculateStagedHousingAllowance({ basic_pay: '8000', housing_allowance: '2400', housing_allowance_source: 'IMPORTED', housing_allowance_resolution: 'USE_UPLOADED', meal_allowance: '0', transport_allowance: '100', other_allowances: '50', gross_pay: '10950' }, 'basic_pay', '10000')
    expect(reviewed).toMatchObject({ housing_allowance_proposed: '3000.00', housing_allowance_resolution: '', housing_allowance_review_required: 'true' })
    expect(reviewed).toMatchObject({ gross_pay_proposed: '12550.00', gross_pay_review_required: 'true' })
    const calculatedHousing = recalculateStagedHousingAllowance({ ...reviewed, housing_allowance_resolution: 'USE_CALCULATED', housing_allowance: '3000.00' }, 'housing_allowance', '3000.00')
    expect(calculatedHousing.gross_pay_proposed).toBe('13150.00')
  })

  it('keeps blank allowances unconfirmed in the compensation preview and totals explicit values in cents', () => {
    expect(calculateGrossEarningsPreview({ basic_pay: '5000', housing_allowance: '1500', meal_allowance: '0', transport_allowance: '', medical_allowance: '', other_allowances: '80.25' }))
      .toEqual({ total: '6580.25', incomplete: ['transport_allowance', 'medical_allowance'] })
  })
})
