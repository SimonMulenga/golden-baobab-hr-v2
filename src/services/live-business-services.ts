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

export type PayrollPreviewItem = {
  employee_id: string;
  employee_number: string;
  employee_name: string;
  contract_type: string;
  employment_type: string;
  salary_frequency: string | null;
  compensation_effective_from: string | null;
  basic_pay: number | null;
  housing_allowance: number | null;
  meal_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  overtime_eligible: boolean | null;
  allowance_tax_treatment: Record<string, unknown> | null;
  attendance: {
    scheduled_working_days: number; actual_days_worked: number; paid_leave_days: number;
    unpaid_leave_days: number; other_payable_absence_days: number;
  } | null;
  approved_leave_requests: Array<{
    leave_request_id: string; leave_type: string; pay_classification: 'PAID' | 'UNPAID';
    start_date: string; end_date: string; leave_days: number;
  }>;
  due_approved_deductions: Array<{
    deduction_id: string; installment_id: string; deduction_type: string; reason: string;
    scheduled_amount: number; due_period: string; outstanding_balance: number;
  }>;
  input_warnings: string[];
};

export type PayrollPreviewInputs = {
  portfolio_id: string; company_id: string; branch_id: string; period_start: string; period_end: string;
  attendance_period_id: string; attendance_approved_at: string; items: PayrollPreviewItem[];
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

export type AttendancePeriodRecord = {
  id: string; portfolio_id: string; company_id: string; branch_id: string;
  period_start: string; period_end: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED_FOR_CORRECTION' | 'LOCKED';
  created_by: string; reviewed_by: string | null; reviewed_at: string | null; review_reason: string | null;
};
export type AttendanceEntryRecord = {
  id: string; attendance_period_id: string; employee_id: string;
  scheduled_working_days: number; actual_days_worked: number; paid_leave_days: number;
  unpaid_leave_days: number; other_payable_absence_days: number; contract_type: string;
  correction_note: string | null;
};
export type AttendanceEntryInput = {
  portfolioId: string; companyId: string; branchId: string; periodStart: string; periodEnd: string;
  employeeId: string; scheduledDays: number; workedDays: number; paidLeaveDays: number;
  unpaidLeaveDays: number; payableAbsenceDays: number; contractType: string; correctionNote?: string;
};
export type LeaveRequestRecord = {
  id: string; portfolio_id: string; company_id: string; branch_id: string; employee_id: string;
  leave_type: string; pay_classification: 'PAID' | 'UNPAID'; start_date: string; end_date: string;
  leave_days: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';
  requested_by: string; reviewed_by: string | null; reviewed_at: string | null; reason: string | null;
};
export type LeavePolicyRecord = {
  id: string; portfolio_id: string; company_id: string; leave_type: string;
  pay_classification: 'PAID' | 'UNPAID'; accrual_days_per_month: number; maximum_balance_days: number | null;
  effective_from: string; effective_to: string | null; enabled: boolean;
};
export type LeaveBalanceRecord = {
  portfolio_id: string; company_id: string; branch_id: string; employee_id: string; leave_policy_id: string;
  leave_type: string; pay_classification: 'PAID' | 'UNPAID'; accrual_days_per_month: number;
  available_days: number;
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
  attendance: {
    periods(request?: PageRequest & { periodStart?: string }): Promise<PageResult<AttendancePeriodRecord>>;
    entries(periodId: string): Promise<AttendanceEntryRecord[]>;
    saveEntry(input: AttendanceEntryInput): Promise<string>;
    submitPeriod(periodId: string): Promise<string>;
    reviewPeriod(periodId: string, decision: 'APPROVE' | 'RETURN', reason?: string): Promise<string>;
  };
  leave: {
    requests(request?: PageRequest): Promise<PageResult<LeaveRequestRecord>>;
    policies(companyId: string): Promise<LeavePolicyRecord[]>;
    balances(companyId: string): Promise<LeaveBalanceRecord[]>;
    savePolicy(input: Omit<LeavePolicyRecord, 'id' | 'portfolio_id' | 'company_id' | 'enabled'> & { portfolioId: string; companyId: string }): Promise<string>;
    accrueMonth(policyId: string, periodStart: string): Promise<number>;
    createRequest(input: { portfolioId: string; companyId: string; branchId: string; employeeId: string; leaveType: string; payClassification: 'PAID' | 'UNPAID'; startDate: string; endDate: string; days: number; reason: string; idempotencyKey: string }): Promise<string>;
    reviewRequest(requestId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<string>;
  };
  payroll: {
    list(request?: PageRequest): Promise<PageResult<PayrollRunRecord>>;
    previewInputs(input: { companyId: string; branchId: string; periodStart: string; periodEnd: string }): Promise<PayrollPreviewInputs>;
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
    attendance: {
      async periods(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('attendance_periods')
          .select('id,portfolio_id,company_id,branch_id,period_start,period_end,status,created_by,reviewed_by,reviewed_at,review_reason', { count: 'exact' })
          .order('period_start', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        if (request.periodStart) query = query.eq('period_start', request.periodStart);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as AttendancePeriodRecord[], total: result.count ?? 0 };
      },
      async entries(periodId) {
        const result = await client.from('attendance_entries')
          .select('id,attendance_period_id,employee_id,scheduled_working_days,actual_days_worked,paid_leave_days,unpaid_leave_days,other_payable_absence_days,contract_type,correction_note')
          .eq('attendance_period_id', periodId);
        if (result.error) throw result.error;
        return (result.data ?? []) as AttendanceEntryRecord[];
      },
      async saveEntry(input) {
        return unwrap(await client.rpc('attendance_save_entry', {
          p_portfolio_id: input.portfolioId, p_company_id: input.companyId, p_branch_id: input.branchId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd, p_employee_id: input.employeeId,
          p_scheduled_days: input.scheduledDays, p_worked_days: input.workedDays,
          p_paid_leave_days: input.paidLeaveDays, p_unpaid_leave_days: input.unpaidLeaveDays,
          p_payable_absence_days: input.payableAbsenceDays, p_contract_type: input.contractType,
          p_correction_note: input.correctionNote ?? null,
        }));
      },
      async submitPeriod(periodId) { return unwrap(await client.rpc('attendance_submit_period', { p_period_id: periodId })); },
      async reviewPeriod(periodId, decision, reason) {
        return unwrap(await client.rpc('attendance_review_period', { p_period_id: periodId, p_decision: decision, p_reason: reason ?? null }));
      },
    },
    leave: {
      async requests(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('leave_requests')
          .select('id,portfolio_id,company_id,branch_id,employee_id,leave_type,pay_classification,start_date,end_date,leave_days,status,requested_by,reviewed_by,reviewed_at,reason', { count: 'exact' })
          .order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as LeaveRequestRecord[], total: result.count ?? 0 };
      },
      async policies(companyId) {
        const result = await client.from('leave_policies')
          .select('id,portfolio_id,company_id,leave_type,pay_classification,accrual_days_per_month,maximum_balance_days,effective_from,effective_to,enabled')
          .eq('company_id', companyId).eq('enabled', true).order('effective_from', { ascending: false });
        if (result.error) throw result.error;
        return (result.data ?? []) as LeavePolicyRecord[];
      },
      async balances(companyId) {
        const result = await client.from('leave_balances')
          .select('portfolio_id,company_id,branch_id,employee_id,leave_policy_id,leave_type,pay_classification,accrual_days_per_month,available_days')
          .eq('company_id', companyId);
        if (result.error) throw result.error;
        return (result.data ?? []) as LeaveBalanceRecord[];
      },
      async savePolicy(input) {
        return unwrap(await client.rpc('leave_policy_save', {
          p_portfolio_id: input.portfolioId, p_company_id: input.companyId, p_leave_type: input.leave_type,
          p_pay_classification: input.pay_classification, p_accrual_days_per_month: input.accrual_days_per_month,
          p_maximum_balance_days: input.maximum_balance_days, p_effective_from: input.effective_from,
          p_effective_to: input.effective_to,
        }));
      },
      async accrueMonth(policyId, periodStart) {
        return unwrap(await client.rpc('leave_accrue_month', { p_policy_id: policyId, p_period_start: periodStart }));
      },
      async createRequest(input) {
        return unwrap(await client.rpc('leave_create_request', {
          p_portfolio_id: input.portfolioId, p_company_id: input.companyId, p_branch_id: input.branchId,
          p_employee_id: input.employeeId, p_leave_type: input.leaveType, p_pay_classification: input.payClassification,
          p_start_date: input.startDate, p_end_date: input.endDate, p_leave_days: input.days,
          p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
        }));
      },
      async reviewRequest(requestId, decision, reason) {
        return unwrap(await client.rpc('leave_review_request', { p_leave_request_id: requestId, p_decision: decision, p_reason: reason ?? null }));
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
      async previewInputs(input) {
        return unwrap(await client.rpc('payroll_preview_inputs', {
          p_company_id: input.companyId, p_branch_id: input.branchId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd,
        })) as PayrollPreviewInputs;
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

