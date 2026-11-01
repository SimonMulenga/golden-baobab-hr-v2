import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { ADVANCE_HEADINGS, BANK_HEADINGS, buildAdvanceReport, buildBankPayrollReport, buildCashPayrollReport, buildLeaveDaysReport, buildMasterPayrollReport, buildMobileMoneyPayrollReport, buildNapsaReport, buildNhimaReport, buildPayeReport, buildReportCsv, buildReportWorkbook, CASH_HEADINGS, LEAVE_HEADINGS, MASTER_HEADINGS, MOBILE_MONEY_HEADINGS, PAYE_HEADINGS, type DeductionReportRecord, type PrivateReportDetails } from './report-export-model'
import type { EmployeeDirectoryRecord } from '../../services/live-business-services'

const employee = (id: string, employee_number: string): EmployeeDirectoryRecord => ({
  id, portfolio_id: 'portfolio-a', company_id: 'company-a', workplace_branch_id: 'branch-a', employee_number,
  first_name: 'Synthetic', middle_name: null, last_name: id, job_title: 'Analyst', department: 'Finance',
  employment_type: 'PERMANENT', contract_type: 'PERMANENT', contract_start_date: '2026-01-01', contract_end_date: null,
  retirement_age: 65, retirement_status: 'NOT_RETIRED', approval_status: 'APPROVED', employment_status: 'ACTIVE',
  submitted_at: null, reviewed_at: null, created_at: '2026-01-01T00:00:00Z',
})
const line = (employee_id: string, changes: Record<string, unknown> = {}) => ({
  id: `line-${employee_id}`, payroll_run_id: 'run-a', employee_id, version: 2, basic_pay: 5000, housing_allowance: 0, meal_allowance: 0,
  transport_allowance: 0, other_allowances: 0, overtime: 0, bonuses_and_other_earnings: 0, attendance_deduction: 0, gross_pay: 5000,
  statutory_deductions: { PAYE: 0, NAPSA_EMPLOYEE: 250, NHIMA_EMPLOYEE: 50 }, voluntary_deductions: 500, net_pay: 4200,
  paye_taxable_income: 5000, napsa_employee: 250, napsa_employer: 250, nhima_employee: 50, nhima_employer: 50, total_employer_cost: 5300,
  calculation_breakdown: {}, ...changes,
})
const privateInfo = (employee_id: string, payment_method: PrivateReportDetails['payment_method'], changes: Partial<PrivateReportDetails> = {}): PrivateReportDetails => ({
  employee_id, identity_document_number: '000000/00/0', tpin: 'SYN0000000', napsa_number: '0000000000', nhima_number: '0000000000', payment_method,
  bank_account_name: 'Synthetic Recipient', bank_account_number: '0000123400', bank_branch_name: 'Synthetic Branch', mobile_money_provider: null, mobile_money_number: null, ...changes,
})

describe('sample-based payroll report mappings', () => {
  it('keeps the exact supplied column order for supported sample layouts', () => {
    expect([...BANK_HEADINGS]).toEqual(['EMP NO', 'NAME', 'NRC NO.', 'BRANCH NAME', 'ACCOUNT NO.', 'AMOUNT'])
    expect([...CASH_HEADINGS]).toEqual(['#', 'EMP NO', 'NAME', 'TOTAL EARNINGS', 'STAT DEDUCTIONS', 'GEN DEDUCTIONS', 'TOTAL DEDUCTIONS', 'NET PAY'])
    expect([...ADVANCE_HEADINGS]).toEqual(['EMP NO.', 'NAME', 'DEDUCTION NAME', 'MONTHLY AMT', 'INITIAL AMT', 'AMOUNT RECOVERED', 'OUTSTANDING AMT'])
    expect([...MOBILE_MONEY_HEADINGS]).toEqual(['EMP NO', 'EMPLOYEE NAME', 'PAYMENT PROVIDER', 'REGISTERED MOBILE NUMBER', 'NET PAY'])
    expect([...PAYE_HEADINGS]).toEqual(['Employee Number', 'Employee Name', 'TPIN', 'Employment Nature', 'Gross Emoluments', 'Chargeable Emoluments', 'Tax Deducted'])
  })

  it('creates a readable workbook with ordered headings, numeric cells and the bank total row', () => {
    const workbook = buildReportWorkbook([{ 'EMP NO': 'QA-001', NAME: 'Synthetic Person', 'NRC NO.': '000000/00/0', 'BRANCH NAME': 'QA Lusaka', 'ACCOUNT NO.': '0000123400', AMOUNT: 4200 }], BANK_HEADINGS, 'Bank Payroll', 'AMOUNT')
    const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    const sheet = reopened.Sheets['Bank Payroll']
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      [...BANK_HEADINGS], ['QA-001', 'Synthetic Person', '000000/00/0', 'QA Lusaka', '0000123400', 4200], ['TOTAL', '', '', '', '', 4200],
    ])
    expect(sheet?.F2?.t).toBe('n')
    expect(sheet?.E2?.t).toBe('s')
  })

  it('creates a valid zero-employee workbook with its headers and zero total', () => {
    const workbook = buildReportWorkbook([], BANK_HEADINGS, 'Bank Payroll', 'AMOUNT', 'TOTAL (0 employees)')
    const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(reopened.Sheets['Bank Payroll'], { header: 1 })).toEqual([
      [...BANK_HEADINGS], ['TOTAL (0 employees)', '', '', '', '', 0],
    ])
  })

  it('writes dynamic CSV rows with numeric contribution values and safe text identifiers', () => {
    const csv = buildReportCsv([{ 'Employee Number': '00007', Amount: 125.5, Name: '=HYPERLINK("x")' }], ['Employee Number', 'Amount', 'Name'])
    expect(csv).toContain('"00007",125.5,"\'=HYPERLINK(""x"")"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('reopens Cash and Loans & Advances workbooks with the reference headings and numeric values', () => {
    const cashWorkbook = buildReportWorkbook([{ '#': 1, 'EMP NO': 'QA-001', NAME: 'Synthetic Person', 'TOTAL EARNINGS': 5000, 'STAT DEDUCTIONS': 300, 'GEN DEDUCTIONS': 500, 'TOTAL DEDUCTIONS': 800, 'NET PAY': 4200 }], CASH_HEADINGS, 'Cash Payroll')
    const cashReopened = XLSX.read(XLSX.write(cashWorkbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(cashReopened.Sheets['Cash Payroll'], { header: 1 })[0]).toEqual([...CASH_HEADINGS])
    expect(cashReopened.Sheets['Cash Payroll']?.D2?.t).toBe('n')

    const advanceWorkbook = buildReportWorkbook([{ 'EMP NO.': 'QA-001', NAME: 'Synthetic Person', 'DEDUCTION NAME': 'Synthetic advance', 'MONTHLY AMT': 500, 'INITIAL AMT': 3000, 'OUTSTANDING AMT': 1000 }], ADVANCE_HEADINGS, 'Loans and Advances')
    const advanceReopened = XLSX.read(XLSX.write(advanceWorkbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(advanceReopened.Sheets['Loans and Advances'], { header: 1 })[0]).toEqual([...ADVANCE_HEADINGS])
    expect(advanceReopened.Sheets['Loans and Advances']?.D2?.t).toBe('n')
  })

  it('filters bank report rows and preserves leading zeroes in account and identity fields', () => {
    const people = new Map([['bank-1', employee('bank-1', 'QA-001')], ['cash-1', employee('cash-1', 'QA-002')]])
    const details = new Map([['bank-1', privateInfo('bank-1', 'BANK_TRANSFER')], ['cash-1', privateInfo('cash-1', 'CASH')]])
    const result = buildBankPayrollReport([line('bank-1'), line('cash-1')], people, details, new Map([['branch-a', 'QA Lusaka']]))
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ 'NRC NO.': '000000/00/0', 'ACCOUNT NO.': '0000123400', 'BRANCH NAME': 'QA Lusaka', AMOUNT: 4200 })
  })

  it('filters cash records and reconciles statutory and general deductions to net pay', () => {
    const people = new Map([['cash-1', employee('cash-1', 'QA-001')], ['bank-1', employee('bank-1', 'QA-002')]])
    const details = new Map([['cash-1', privateInfo('cash-1', 'CASH')], ['bank-1', privateInfo('bank-1', 'BANK_TRANSFER')]])
    const result = buildCashPayrollReport([line('cash-1'), line('bank-1')], people, details)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ 'TOTAL EARNINGS': 5000, 'STAT DEDUCTIONS': 300, 'GEN DEDUCTIONS': 500, 'TOTAL DEDUCTIONS': 800, 'NET PAY': 4200 })
  })

  it('filters mobile money employees, validates recipient details and preserves the registered number', () => {
    const mobile = employee('mobile-1', 'QA-003')
    const cash = employee('cash-1', 'QA-004')
    const details = new Map([
      [mobile.id, privateInfo(mobile.id, 'MOBILE_MONEY', { mobile_money_provider: 'Synthetic Provider', mobile_money_number: '0970000001' })],
      [cash.id, privateInfo(cash.id, 'CASH')],
    ])
    const result = buildMobileMoneyPayrollReport([line(mobile.id), line(cash.id)], new Map([[mobile.id, mobile], [cash.id, cash]]), details)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([{ 'EMP NO': 'QA-003', 'EMPLOYEE NAME': 'Synthetic mobile-1', 'PAYMENT PROVIDER': 'Synthetic Provider', 'REGISTERED MOBILE NUMBER': '0970000001', 'NET PAY': 4200 }])

    const workbook = buildReportWorkbook(result.rows, MOBILE_MONEY_HEADINGS, 'Mobile Money', 'NET PAY', `TOTAL (${result.rows.length} employees)`)
    const reopened = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(reopened.Sheets['Mobile Money'], { header: 1 })).toEqual([
      [...MOBILE_MONEY_HEADINGS], ['QA-003', 'Synthetic mobile-1', 'Synthetic Provider', '0970000001', 4200], ['TOTAL (1 employees)', '', '', '', 4200],
    ])
    expect(reopened.Sheets['Mobile Money']?.D2?.t).toBe('s')
  })

  it('blocks mobile money rows with missing provider or registered number', () => {
    const person = employee('mobile-1', 'QA-003')
    const details = privateInfo(person.id, 'MOBILE_MONEY', { mobile_money_provider: null, mobile_money_number: null })
    const result = buildMobileMoneyPayrollReport([line(person.id)], new Map([[person.id, person]]), new Map([[person.id, details]]))
    expect(result.rows).toEqual([])
    expect(result.errors.map((error) => error.field)).toEqual(['PAYMENT PROVIDER', 'REGISTERED MOBILE NUMBER'])
  })

  it('reports missing mandatory bank data without echoing sensitive values', () => {
    const person = employee('bank-1', 'QA-001')
    const details = privateInfo('bank-1', 'BANK_TRANSFER', { identity_document_number: null, bank_account_number: null })
    const result = buildBankPayrollReport([line('bank-1')], new Map([[person.id, person]]), new Map([[person.id, details]]), new Map([['branch-a', 'QA Lusaka']]))
    expect(result.rows).toEqual([])
    expect(result.errors.map((error) => error.field)).toEqual(['NRC NO.', 'ACCOUNT NO.'])
    expect(JSON.stringify(result.errors)).not.toContain('0000123400')
  })

  it('reconciles loan balances against the finalized snapshot without duplicating repayment lines', () => {
    const person = employee('emp-1', 'QA-001')
    const item = line('emp-1', { calculation_breakdown: { due_deduction_items: [{ deduction_id: 'ded-1', deduction_type: 'SALARY_ADVANCE', scheduled_amount: 500 }] } })
    const deduction: DeductionReportRecord = { id: 'ded-1', employee_id: 'emp-1', deduction_type: 'SALARY_ADVANCE', reason: 'Synthetic advance', principal_amount: 3000, amount_deducted: 2000, status: 'ACTIVE' }
    const result = buildAdvanceReport([item, item], new Map([[person.id, person]]), [deduction])
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ 'DEDUCTION NAME': 'Salary Advance', 'MONTHLY AMT': 500, 'INITIAL AMT': 3000, 'OUTSTANDING AMT': 1000 })
    expect(JSON.stringify(result.rows)).not.toContain('Synthetic advance')
  })

  it('blocks duplicate repayment entries in an immutable payroll snapshot', () => {
    const person = employee('emp-1', 'QA-001')
    const item = line('emp-1', { calculation_breakdown: { due_deduction_items: [
      { deduction_id: 'ded-1', deduction_type: 'SALARY_ADVANCE', scheduled_amount: 500 },
      { deduction_id: 'ded-1', deduction_type: 'SALARY_ADVANCE', scheduled_amount: 500 },
    ] } })
    const deduction: DeductionReportRecord = { id: 'ded-1', employee_id: 'emp-1', deduction_type: 'SALARY_ADVANCE', reason: 'Private reason not for report', principal_amount: 3000, amount_deducted: 2000, status: 'ACTIVE' }
    const result = buildAdvanceReport([item], new Map([[person.id, person]]), [deduction])
    expect(result.rows).toEqual([])
    expect(result.errors[0].reason).toContain('duplicate repayment entries')
  })

  it('creates an internal PAYE schedule from persisted finalized snapshot fields without inventing tax credits', () => {
    const person = employee('emp-1', 'QA-001')
    const result = buildPayeReport([line('emp-1')], new Map([[person.id, person]]), new Map([[person.id, privateInfo('emp-1', 'CASH')]]))
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([{
      'Employee Number': 'QA-001', 'Employee Name': 'Synthetic emp-1', TPIN: 'SYN0000000', 'Employment Nature': 'PERMANENT',
      'Gross Emoluments': 5000, 'Chargeable Emoluments': 5000, 'Tax Deducted': 0,
    }])
  })

  it('includes every employee in the selected branch payroll and exposes the actual contribution fields', () => {
    const first = employee('emp-1', 'QA-001')
    const second = employee('emp-2', 'QA-002')
    const items = [line(first.id), line(second.id, { napsa_employee: 300, napsa_employer: 300, nhima_employee: 60, nhima_employer: 60 })]
    const people = new Map([[first.id, first], [second.id, second]])
    const details = new Map([[first.id, privateInfo(first.id, 'CASH')], [second.id, privateInfo(second.id, 'CASH')]])
    const context = { companyName: 'QA Company', branchName: 'QA Branch', payrollPeriod: 'October 2026' }
    expect(buildNapsaReport(items, people, details, context).rows).toHaveLength(2)
    expect(buildNhimaReport(items, people, details, context).rows[1]).toMatchObject({ 'Employee Contribution': 60, 'Employer Contribution': 60, 'Total Contribution': 120 })
  })

  it('builds leave and master reports from the selected payroll employee set without a brought-forward column', () => {
    const person = employee('emp-1', 'QA-001')
    const ledger = [
      { employee_id: person.id, branch_id: 'branch-a', event_type: 'ACCRUAL' as const, amount_delta: 2, period_start: '2026-10-01' },
      { employee_id: person.id, branch_id: 'branch-a', event_type: 'PAID_LEAVE' as const, amount_delta: -1, period_start: '2026-10-10' },
      { employee_id: person.id, branch_id: 'branch-a', event_type: 'ACCRUAL' as const, amount_delta: 1.5, period_start: '2026-11-01' },
    ]
    const leave = buildLeaveDaysReport([line(person.id)], new Map([[person.id, person]]), ledger, {
      companyName: 'QA Company', branchName: 'QA Branch', payrollPeriod: 'October 2026', periodStart: '2026-10-01', periodEnd: '2026-10-31',
    })
    expect(leave.rows[0]).toMatchObject({ 'Accrued (Period)': 2, 'Leave Taken (Period)': 1, 'Balance at Period End': 1 })
    expect(Object.keys(leave.rows[0])).toEqual([...LEAVE_HEADINGS])
    expect(Object.keys(leave.rows[0]).some((heading) => /B.F|brought forward/i.test(heading))).toBe(false)
    const master = buildMasterPayrollReport([line(person.id)], new Map([[person.id, person]]))
    expect(master.rows).toHaveLength(1)
    expect(Object.keys(master.rows[0])).toEqual([...MASTER_HEADINGS])
  })

  it('rejects missing mandatory statutory identifiers without substituting zero', () => {
    const person = employee('emp-1', 'QA-001')
    const result = buildNapsaReport([line(person.id)], new Map([[person.id, person]]), new Map([[person.id, privateInfo(person.id, 'CASH', { napsa_number: null })]]), { companyName: 'QA', branchName: 'QA', payrollPeriod: '2026-10' })
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toMatchObject({ field: 'NAPSA Number' })
  })
})
