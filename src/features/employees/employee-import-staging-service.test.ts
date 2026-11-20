import { describe, expect, it, vi } from 'vitest'
import { createEmployeeImportStagingService } from './employee-import-staging-service'

describe('employee import staging service', () => {
  it('persists the reviewed file hash, source rows and reconciliation through the authenticated RPC contract', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { batch_id: 'batch-synthetic', status: 'IN_REVIEW', total_records: 1, replayed: false }, error: null })
    const service = createEmployeeImportStagingService({ rpc } as never)
    const records = [{ source_sheet: 'Synthetic', source_row: 2, company_id: 'company-synthetic', branch_id: 'branch-synthetic', original_data: { name: 'Test Employee' }, current_data: { first_name: 'Test' }, payroll_data: { allowance: 50 } }]
    await expect(service.createBatch({ portfolioId: 'portfolio-synthetic', filename: 'synthetic.xlsx', sourceSha256: 'a'.repeat(64), idempotencyKey: 'test-import-key', records, sheetSummary: [{ sheet: 'Synthetic', extracted: 1, excluded: 0 }], reconciliation: { row_count: 1 } })).resolves.toMatchObject({ batch_id: 'batch-synthetic' })
    expect(rpc).toHaveBeenCalledWith('employee_import_stage_batch', expect.objectContaining({ p_portfolio_id: 'portfolio-synthetic', p_source_sha256: 'a'.repeat(64), p_records: records }))
  })

  it('uses the scoped review RPC and leaves authorization and company/branch integrity to the database', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { record_id: 'record-synthetic', review_status: 'READY_FOR_APPROVAL', validation_errors: [], duplicate_warnings: [] }, error: null })
    const service = createEmployeeImportStagingService({ rpc } as never)
    await service.review({ recordId: 'record-synthetic', companyId: 'company-synthetic', branchId: 'branch-synthetic', currentData: { employee_number: 'TEST-001' }, payrollData: {}, decision: 'MARK_READY', duplicateResolution: 'CONFIRMED_DISTINCT', reason: 'Synthetic reviewer confirmed different people.' })
    expect(rpc).toHaveBeenCalledWith('employee_import_stage_review', expect.objectContaining({ p_company_id: 'company-synthetic', p_branch_id: 'branch-synthetic', p_duplicate_resolution: 'CONFIRMED_DISTINCT' }))
  })

  it('submits only through the existing staging approval RPC and surfaces authorization failures', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { record_id: 'record-synthetic', employee_id: 'employee-synthetic', status: 'SUBMITTED_FOR_APPROVAL', replayed: false }, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'Employee import and create permissions are required for this branch.' } })
    const service = createEmployeeImportStagingService({ rpc } as never)
    await expect(service.submit('record-synthetic', 'idempotency-key-synthetic')).resolves.toMatchObject({ status: 'SUBMITTED_FOR_APPROVAL' })
    await expect(service.submit('record-synthetic', 'idempotency-key-synthetic')).rejects.toThrow('permissions are required')
    expect(rpc).toHaveBeenNthCalledWith(1, 'employee_import_submit_staged', { p_record_id: 'record-synthetic', p_idempotency_key: 'idempotency-key-synthetic' })
  })

  it('approves a submitted employee only through the existing permission-checked HR review RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'employee-synthetic', error: null })
    const service = createEmployeeImportStagingService({ rpc } as never)
    await expect(service.approve('employee-synthetic')).resolves.toBe('employee-synthetic')
    expect(rpc).toHaveBeenCalledWith('employee_review_submission', {
      p_employee_id: 'employee-synthetic', p_decision: 'APPROVE', p_reason: null,
    })
  })
})
