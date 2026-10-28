import type { SupabaseClient } from '@supabase/supabase-js';
import type { PageRequest, PageResult } from './contracts';

export type EmployeeDirectoryRecord = {
  id: string;
  portfolio_id: string;
  company_id: string;
  workplace_branch_id: string;
  employee_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  job_title: string;
  department: string;
  employment_type: string;
  contract_type: string;
  contract_start_date: string;
  contract_end_date: string | null;
  retirement_age: number;
  retirement_status: 'NOT_RETIRED' | 'RETIRED';
  approval_status: 'DRAFT' | 'SUBMITTED_FOR_HR_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION';
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type PayrollRunRecord = {
  id: string;
  company_id: string;
  branch_id: string;
  payroll_period_id: string;
  status: string;
  version: number;
  created_by: string;
  created_at: string;
};

export type DeductionRecord = {
  id: string;
  portfolio_id: string;
  company_id: string;
  branch_id: string;
  employee_id: string;
  deduction_type: string;
  principal_amount: number;
  amount_deducted: number;
  status: string;
  start_period: string;
  reason: string;
  initiated_by: string;
};

export type DeductionInstallmentRecord = {
  id: string;
  deduction_id: string;
  sequence_number: number;
  due_period: string;
  scheduled_amount: number;
};

export type EmployeeReviewDecision = 'APPROVE' | 'REJECT' | 'RETURN';
export type PayrollReviewAction = 'START_REVIEW' | 'APPROVE' | 'RETURN' | 'REJECT';
export type EmployeeApprovalFilter = EmployeeDirectoryRecord['approval_status'];
export type JsonObject = Record<string, string | number | boolean | null>;
export type EmployeeDraftInput = {
  portfolioId: string;
  companyId: string;
  branchId: string;
  employee: JsonObject;
  privateDetails: JsonObject;
  compensation: JsonObject;
};
export type DeductionRequestInput = {
  portfolioId: string;
  companyId: string;
  branchId: string;
  employeeId: string;
  idempotencyKey: string;
  details: JsonObject;
  schedule: Array<{ sequence_number: number; due_period: string; scheduled_amount: number }>;
};

export interface LiveBusinessServices {
  employees: {
    list(request?: PageRequest & { approvalStatus?: EmployeeApprovalFilter }): Promise<PageResult<EmployeeDirectoryRecord>>;
    byIds(ids: string[]): Promise<EmployeeDirectoryRecord[]>;
    createDraft(input: EmployeeDraftInput): Promise<string>;
    submitForHrApproval(employeeId: string): Promise<string>;
    reviewSubmission(employeeId: string, decision: EmployeeReviewDecision, reason?: string): Promise<string>;
  };
  deductions: {
    list(request?: PageRequest): Promise<PageResult<DeductionRecord>>;
    installments(deductionId: string): Promise<DeductionInstallmentRecord[]>;
    createRequest(input: DeductionRequestInput): Promise<string>;
    reviewRequest(deductionId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<string>;
  };
  payroll: {
    list(request?: PageRequest): Promise<PageResult<PayrollRunRecord>>;
    submitForApproval(runId: string): Promise<string>;
    reviewSubmission(runId: string, action: PayrollReviewAction, expectedVersion: number, reason?: string): Promise<string>;
    finalize(runId: string): Promise<string>;
  };
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  if (result.data === null) throw new Error('The live business service returned no result.');
  return result.data;
}

/**
 * Live, tenant-scoped data access. PostgreSQL RLS filters list queries and
 * SECURITY DEFINER RPCs validate actor, role, branch scope, transition state,
 * and audit writes. This adapter never switches to mock data after an error.
 */
export function createLiveBusinessServices(client: SupabaseClient): LiveBusinessServices {
  return {
    employees: {
      async list(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('employees')
          .select('id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,job_title,department,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,retirement_status,approval_status,submitted_at,reviewed_at,created_at', { count: 'exact' })
          .order('last_name', { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('workplace_branch_id', request.branchId);
        if (request.approvalStatus) query = query.eq('approval_status', request.approvalStatus);
        if (request.search?.trim()) query = query.ilike('last_name', `%${request.search.trim()}%`);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as EmployeeDirectoryRecord[], total: result.count ?? 0 };
      },
      async byIds(ids) {
        if (ids.length === 0) return [];
        const result = await client.from('employees')
          .select('id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,job_title,department,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,retirement_status,approval_status,submitted_at,reviewed_at,created_at')
          .in('id', [...new Set(ids)]);
        if (result.error) throw result.error;
        return (result.data ?? []) as EmployeeDirectoryRecord[];
      },
      async createDraft(input) {
        return unwrap(await client.rpc('employee_create_draft', {
          p_portfolio_id: input.portfolioId,
          p_company_id: input.companyId,
          p_branch_id: input.branchId,
          p_employee: input.employee,
          p_private_details: input.privateDetails,
          p_compensation: input.compensation,
        }));
      },
      async submitForHrApproval(employeeId) {
        return unwrap(await client.rpc('employee_submit_for_hr_approval', { p_employee_id: employeeId }));
      },
      async reviewSubmission(employeeId, decision, reason) {
        return unwrap(await client.rpc('employee_review_submission', {
          p_employee_id: employeeId, p_decision: decision, p_reason: reason ?? null,
        }));
      },
    },
    deductions: {
      async list(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('employee_deductions')
          .select('id,portfolio_id,company_id,branch_id,employee_id,deduction_type,principal_amount,amount_deducted,status,start_period,reason,initiated_by', { count: 'exact' })
          .order('start_period', { ascending: false })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as DeductionRecord[], total: result.count ?? 0 };
      },
      async installments(deductionId) {
        const result = await client.from('deduction_installments')
          .select('id,deduction_id,sequence_number,due_period,scheduled_amount')
          .eq('deduction_id', deductionId)
          .order('sequence_number', { ascending: true });
        if (result.error) throw result.error;
        return (result.data ?? []) as DeductionInstallmentRecord[];
      },
      async createRequest(input) {
        return unwrap(await client.rpc('deduction_create_request', {
          p_portfolio_id: input.portfolioId,
          p_company_id: input.companyId,
          p_branch_id: input.branchId,
          p_employee_id: input.employeeId,
          p_idempotency_key: input.idempotencyKey,
          p_details: input.details,
          p_schedule: input.schedule,
        }));
      },
      async reviewRequest(deductionId, decision, reason) {
        return unwrap(await client.rpc('deduction_review_request', {
          p_deduction_id: deductionId, p_decision: decision, p_reason: reason ?? null,
        }));
      },
    },
    payroll: {
      async list(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('payroll_runs')
          .select('id,company_id,branch_id,payroll_period_id,status,version,created_by,created_at', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as PayrollRunRecord[], total: result.count ?? 0 };
      },
      async submitForApproval(runId) {
        return unwrap(await client.rpc('payroll_submit_for_approval', { p_payroll_run_id: runId }));
      },
      async reviewSubmission(runId, action, expectedVersion, reason) {
        return unwrap(await client.rpc('payroll_review_submission', {
          p_payroll_run_id: runId, p_action: action, p_expected_version: expectedVersion, p_reason: reason ?? null,
        }));
      },
      async finalize(runId) {
        return unwrap(await client.rpc('payroll_finalize', { p_payroll_run_id: runId }));
      },
    },
  };
}

