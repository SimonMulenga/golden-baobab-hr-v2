import type { SupabaseClient } from '@supabase/supabase-js'

export type FilingAuthority = 'PAYE' | 'NAPSA' | 'NHIMA'
export type FilingStatus = 'NOT_STARTED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED'
export type RemittanceStatus = 'UNPAID' | 'PARTIAL' | 'PAID'
export type StatutoryFilingRecord = {
  id: string; payroll_run_id: string; payroll_version: number; authority: FilingAuthority
  period_start: string; period_end: string; due_date: string; liability_amount: number
  filing_status: FilingStatus; submitted_at: string | null; submission_reference: string | null
  remittance_status: RemittanceStatus; remitted_amount: number; remitted_at: string | null
  remittance_reference: string | null; note: string | null; updated_at: string
}
export type FilingPage = { items: StatutoryFilingRecord[]; total: number; page: number; page_size: number }
export type FilingUpdate = {
  filingStatus: FilingStatus; submittedAt: string | null; submissionReference: string | null
  remittanceStatus: RemittanceStatus; remittedAmount: number; remittedAt: string | null
  remittanceReference: string | null; note: string | null
}

function unwrap<T>(response: { data: unknown; error: unknown }): T {
  if (response.error) throw response.error
  return response.data as T
}

export function createLiveStatutoryFilingServices(client: SupabaseClient) {
  return {
    async list(companyId: string, branchId: string, page = 1, pageSize = 25): Promise<FilingPage> {
      return unwrap(await client.rpc('statutory_filing_list', {
        p_company_id: companyId, p_branch_id: branchId, p_page: page, p_page_size: pageSize,
      }))
    },
    async prepare(payrollRunId: string, authority: FilingAuthority, dueDate: string): Promise<string> {
      return unwrap(await client.rpc('statutory_filing_prepare', {
        p_payroll_run_id: payrollRunId, p_authority: authority, p_due_date: dueDate,
      }))
    },
    async update(filingId: string, input: FilingUpdate): Promise<string> {
      return unwrap(await client.rpc('statutory_filing_update', {
        p_filing_id: filingId, p_filing_status: input.filingStatus,
        p_submitted_at: input.submittedAt, p_submission_reference: input.submissionReference,
        p_remittance_status: input.remittanceStatus, p_remitted_amount: input.remittedAmount,
        p_remitted_at: input.remittedAt, p_remittance_reference: input.remittanceReference,
        p_note: input.note,
      }))
    },
  }
}
