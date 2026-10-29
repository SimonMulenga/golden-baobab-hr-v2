import type { SupabaseClient } from '@supabase/supabase-js'

export type ReconciliationStatus = 'PENDING' | 'NO_PAYMENT_DUE' | 'PAID' | 'PARTIAL' | 'FAILED' | 'RETURNED'
export type PayoutReconciliationBatch = {
  export_id: string; payroll_run_id: string; payroll_version: number; created_at: string
  instruction_count: number; manifest_sha256: string; expected_total: number
  reconciled_count: number; paid_count: number; partial_count: number; failed_count: number
  returned_count: number; no_payment_due_count: number
}
export type PayoutReconciliationLine = {
  employee_id: string; employee_number: string; employee_name: string; expected_amount: number
  status: ReconciliationStatus; paid_amount: number; paid_at: string | null
  provider_reference: string | null; note: string | null; reconciled_at: string | null
}

function unwrap<T>(response: { data: unknown; error: unknown }): T {
  if (response.error) throw response.error
  return response.data as T
}

export function createLivePayoutReconciliationServices(client: SupabaseClient) {
  return {
    async batches(companyId: string, branchId: string): Promise<PayoutReconciliationBatch[]> {
      return unwrap(await client.rpc('payroll_payout_reconciliation_batches', { p_company_id: companyId, p_branch_id: branchId }))
    },
    async detail(exportId: string, page = 1, pageSize = 50): Promise<{ total: number; page: number; page_size: number; items: PayoutReconciliationLine[] }> {
      return unwrap(await client.rpc('payroll_payout_reconciliation_detail', { p_export_id: exportId, p_page: page, p_page_size: pageSize }))
    },
    async save(input: { exportId: string; employeeId: string; status: ReconciliationStatus; paidAmount: number; paidAt: string | null; providerReference: string | null; note: string | null }): Promise<string> {
      return unwrap(await client.rpc('payroll_payout_reconciliation_save', {
        p_export_id: input.exportId, p_employee_id: input.employeeId, p_status: input.status,
        p_paid_amount: input.paidAmount, p_paid_at: input.paidAt,
        p_provider_reference: input.providerReference, p_note: input.note,
      }))
    },
  }
}
