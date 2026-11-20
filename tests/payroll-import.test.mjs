import { describe, expect, it, vi } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { duplicateWarningsForRow, extractEmployeeWorkbook, validateStagedEmployee } from '../src/features/employees/employee-import-staging.ts'
import { createEmployeeImportStagingService } from '../src/features/employees/employee-import-staging-service.ts'
import migration from '../supabase/migrations/20261120005500_secure_employee_import_staging.sql?raw'

function makeWorkbook() {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Employee Number','First Name','Surname','Job Title','LOCATION','Basic Salary','Loan Deduction'],
    ['TEST-001','Ada','Sample','Analyst','Golden Baobab Investments',12000,500],
    ['','Bea','','','Golden Baobab Investments','bad',''],
  ]), 'GBI')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Employee Name','Overtime','Bonus'],
    ['Kai Example',4,250],
  ]), 'Payroll Inputs')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

const companies = [{ id: 'company-1', name: 'Golden Baobab Investments', branches: [{ id: 'branch-1', name: 'Main', status: 'Active' }] }]

describe('secure employee workbook staging', () => {
  it('extracts multiple employee worksheets with source coordinates and company/branch mapping', () => {
    const result = extractEmployeeWorkbook(makeWorkbook(), companies)
    expect(result.records.map((row) => [row.source_sheet, row.source_row])).toEqual([
      ['GBI', 2], ['GBI', 3], ['Payroll Inputs', 2],
    ])
    expect(result.records[0]).toMatchObject({ company_id: 'company-1', branch_id: 'branch-1' })
  })

  it('retains incomplete fields and malformed amounts for HR review', () => {
    const result = extractEmployeeWorkbook(makeWorkbook(), companies)
    expect(result.records[1].current_data.first_name).toBe('Bea')
    expect(result.records[1].current_data.last_name).toBe('')
    expect(result.records[1].current_data.basic_pay).toBe('bad')
    expect(validateStagedEmployee(result.records[1].current_data, 'company-1', 'branch-1')).toContain('last_name is required')
  })

  it('preserves combined names and payroll components without inventing employee fields', () => {
    const row = extractEmployeeWorkbook(makeWorkbook(), companies).records[2]
    expect(row.original_data['Employee Name']).toBe('Kai Example')
    expect(row.current_data.first_name).toBe('')
    expect(row.payroll_data).toMatchObject({ Overtime: 4, Bonus: 250 })
    expect(validateStagedEmployee(row.current_data, '', '')).toContain('first_name is required')
  })

  it('detects within-scope duplicates while keeping identical numbers in another company separate', () => {
    const [row] = extractEmployeeWorkbook(makeWorkbook(), companies).records
    const sameScope = { ...row, current_data: { ...row.current_data } }
    expect(duplicateWarningsForRow(row, [sameScope])).toContain('Employee number is repeated in this workbook')
    const otherScope = { ...sameScope, company_id: 'company-2' }
    expect(duplicateWarningsForRow(row, [otherScope])).toEqual([])
  })

  it('persists unassigned source rows using the authenticated staging RPC and an idempotency key', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: 'batch-test', status: 'IN_REVIEW', total_records: 1, replayed: false }, error: null })
    const service = createEmployeeImportStagingService({ rpc })
    const record = { source_sheet: 'Sheet', source_row: 2, company_id: null, branch_id: null, original_data: { name: 'Sample' }, current_data: {}, payroll_data: {} }
    await expect(service.createBatch({ portfolioId: 'portfolio-test', filename: 'synthetic.xlsx', sourceSha256: 'a'.repeat(64), idempotencyKey: 'synthetic-key', records: [record], sheetSummary: [], reconciliation: {} })).resolves.toMatchObject({ batch_id: 'batch-test' })
    expect(rpc).toHaveBeenCalledWith('employee_import_stage_batch', expect.objectContaining({ p_records: [record], p_idempotency_key: 'synthetic-key' }))
  })

  it('routes edits and submission through review RPCs without bypassing employee approval', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { record_id: 'record-test', review_status: 'READY_FOR_APPROVAL', validation_errors: [], duplicate_warnings: [] }, error: null })
      .mockResolvedValueOnce({ data: { record_id: 'record-test', employee_id: 'employee-test', status: 'SUBMITTED_FOR_APPROVAL', replayed: false }, error: null })
    const service = createEmployeeImportStagingService({ rpc })
    await service.review({ recordId: 'record-test', companyId: 'company-test', branchId: 'branch-test', currentData: { employee_number: 'TEST-001' }, payrollData: {}, decision: 'MARK_READY' })
    await service.submit('record-test', 'synthetic-submit-key')
    expect(rpc).toHaveBeenNthCalledWith(1, 'employee_import_stage_review', expect.any(Object))
    expect(rpc).toHaveBeenNthCalledWith(2, 'employee_import_submit_staged', { p_record_id: 'record-test', p_idempotency_key: 'synthetic-submit-key' })
  })

  it('keeps private staging scoped and synchronizes only authoritative approval outcomes', () => {
    expect(migration).toMatch(/enable row level security/i)
    expect(migration).toMatch(/employee\.private\.view/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.import'/i)
    expect(migration).toMatch(/public\.employee_import_atomic\(/i)
    expect(migration).toMatch(/after update of approval_status on public\.employees/i)
    expect(migration).not.toMatch(/update public\.employee_compensation/i)
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table|schema)\b/i)
  })
})
