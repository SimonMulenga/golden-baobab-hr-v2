import type { SupabaseClient } from '@supabase/supabase-js'
import type { StagedWorkbookRow } from './employee-import-staging'

export type StagingBatch = {
  id: string
  portfolio_id: string
  uploaded_by: string
  uploaded_filename: string
  source_sha256: string
  status: string
  sheet_summary: { sheet: string; extracted: number; excluded: number }[]
  reconciliation: Record<string, unknown>
  total_records: number
  valid_records: number
  incomplete_records: number
  duplicate_warnings: number
  rejected_records: number
  reviewed_records: number
  ready_records: number
  approved_records: number
  created_at: string
  completed_at: string | null
}

export type StagingRecord = StagedWorkbookRow & {
  id: string
  batch_id: string
  portfolio_id: string
  validation_errors: { field?: string; message: string }[]
  duplicate_warnings: { type?: string; message: string }[]
  review_status: string
  review_reason: string | null
  reviewer_id: string | null
  reviewed_at: string | null
  resulting_employee_id: string | null
  submission_job_id: string | null
  created_at: string
  updated_at: string
}

export type StageBatchInput = {
  portfolioId: string
  filename: string
  sourceSha256: string
  idempotencyKey: string
  records: StagedWorkbookRow[]
  sheetSummary: { sheet: string; extracted: number; excluded: number }[]
  reconciliation: Record<string, unknown>
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('The import service returned no result.')
  return result.data
}

export function createEmployeeImportStagingService(client: SupabaseClient) {
  return {
    async listBatches(portfolioId: string): Promise<StagingBatch[]> {
      const result = await client.from('employee_import_batches').select('*')
        .eq('portfolio_id', portfolioId).order('created_at', { ascending: false }).limit(50)
      return unwrap(result) as StagingBatch[]
    },
    async listRecords(batchId: string): Promise<StagingRecord[]> {
      const result = await client.from('employee_import_staging_records').select('*')
        .eq('batch_id', batchId).order('source_sheet').order('source_row').limit(5000)
      return unwrap(result) as StagingRecord[]
    },
    async getRecord(recordId: string): Promise<StagingRecord> {
      const result = await client.from('employee_import_staging_records').select('*').eq('id', recordId).single()
      return unwrap(result) as StagingRecord
    },
    async listPendingReviewRecords(portfolioIds: string[], companyId?: string): Promise<StagingRecord[]> {
      if (!portfolioIds.length) return []
      let query = client.from('employee_import_staging_records').select('*')
        .in('portfolio_id', portfolioIds).is('resulting_employee_id', null)
        .in('review_status', ['PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL'])
        .order('created_at', { ascending: false }).limit(500)
      if (companyId) query = query.eq('company_id', companyId)
      return unwrap(await query) as StagingRecord[]
    },
    async listHistory(recordId: string) {
      const result = await client.from('employee_import_review_history').select('id,actor_id,action,reason,changed_fields,occurred_at')
        .eq('staging_record_id', recordId).order('occurred_at', { ascending: false }).limit(100)
      return unwrap(result)
    },
    async createBatch(input: StageBatchInput) {
      const requestSize = new TextEncoder().encode(JSON.stringify(input)).byteLength
      if (requestSize > 5_500_000) throw new Error('The workbook rows exceed the secure 5.5 MB staging request limit. Split the workbook into smaller batches and preserve the same source row references.')
      const result = await client.rpc('employee_import_stage_batch', {
        p_portfolio_id: input.portfolioId,
        p_uploaded_filename: input.filename,
        p_source_sha256: input.sourceSha256,
        p_idempotency_key: input.idempotencyKey,
        p_records: input.records,
        p_sheet_summary: input.sheetSummary,
        p_reconciliation: input.reconciliation,
      })
      return unwrap(result) as { batch_id: string; status: string; total_records: number; replayed: boolean }
    },
    async review(input: { recordId: string; companyId: string | null; branchId: string | null; currentData: Record<string, string>; payrollData: Record<string, unknown>; decision: 'SAVE' | 'MARK_READY' | 'REJECT'; reason?: string; duplicateResolution?: 'CONFIRMED_DISTINCT' }) {
      const result = await client.rpc('employee_import_stage_review', {
        p_record_id: input.recordId,
        p_company_id: input.companyId,
        p_branch_id: input.branchId,
        p_current_data: input.currentData,
        p_payroll_data: input.payrollData,
        p_decision: input.decision,
        p_reason: input.reason ?? null,
        p_duplicate_resolution: input.duplicateResolution ?? null,
      })
      return unwrap(result) as { record_id: string; review_status: string; validation_errors: { field: string; message: string }[]; duplicate_warnings: { type: string; message: string }[] }
    },
    async submit(recordId: string, idempotencyKey: string) {
      const result = await client.rpc('employee_import_submit_staged', {
        p_record_id: recordId,
        p_idempotency_key: idempotencyKey,
      })
      return unwrap(result) as { record_id: string; employee_id?: string; status: string; import_job?: { status: string }; replayed: boolean }
    },
    async approve(employeeId: string) {
      const result = await client.rpc('employee_review_submission', {
        p_employee_id: employeeId,
        p_decision: 'APPROVE',
        p_reason: null,
      })
      return unwrap(result) as string
    },
  }
}

export async function sha256File(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
