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
  employment_status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
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
  calculations?: PayrollCalculationSnapshot | null;
};

export type FinalizedPayslipRunRecord = {
  id: string; company_id: string; branch_id: string; payroll_period_id: string;
  status: 'FINALIZED'; version: number; finalized_at: string;
  payroll_periods: { period_start: string; period_end: string };
};
export type FinalizedPayslipItemRecord = {
  id: string; payroll_run_id: string; employee_id: string; version: number;
  basic_pay: number; housing_allowance: number; meal_allowance: number;
  transport_allowance: number; other_allowances: number; overtime: number;
  bonuses_and_other_earnings: number; attendance_deduction: number;
  gross_pay: number; statutory_deductions: Record<string, unknown>;
  voluntary_deductions: number; net_pay: number; calculation_breakdown: Record<string, unknown>;
  paye_taxable_income: number; napsa_employee: number; napsa_employer: number;
  nhima_employee: number; nhima_employer: number; total_employer_cost: number;
};
export type PayslipDeliveryRecord = {
  id: string; document_id: string; status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number; last_error_code: string | null; created_at: string; updated_at: string; sent_at: string | null;
};
export type AuditLogRecord = {
  id: number; portfolio_id: string; company_id: string | null; branch_id: string | null;
  actor_id: string; action: string; module: string; record_id: string;
  details: Record<string, unknown>; occurred_at: string;
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
  overtime_monthly_hours_divisor: 176 | 208 | 240 | null;
  unpaid_leave_deduction_method: 'BLOCK' | 'BASIC_PER_SCHEDULED_WORKDAY' | 'GROSS_PER_SCHEDULED_WORKDAY';
  allowance_tax_treatment: Record<string, unknown> | null;
  approved_earnings: Array<{ earning_input_id: string; earning_type: string; amount: number; taxable_for_paye: boolean; source_reference: string }>;
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
  attendance_period_id: string; attendance_approved_at: string; items: PayrollPreviewItem[]; earning_inputs: PayrollEarningInputRecord[];
};

export type PayrollEarningInputRecord = {
  id: string; employee_id: string; employee_number: string; employee_name: string;
  earning_type: 'OVERTIME' | 'BONUS' | 'COMMISSION' | 'OTHER_EARNING'; amount: number;
  taxable_for_paye: boolean; source_reference: string; description: string;
  overtime_hours?: number | null; overtime_day_type?: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | null;
  overtime_work_date?: string | null; overtime_week_start?: string | null; overtime_weekly_hours?: number | null;
  overtime_hourly_divisor?: 176 | 208 | 240 | null; overtime_hourly_rate?: number | null;
  overtime_multiplier?: number | null; overtime_watchperson?: boolean | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED'; created_by: string; approved_by: string | null; created_at: string;
};

export type PayrollCalculationItem = {
  employee_id: string;
  employee_number: string;
  employee_name: string;
  basic_salary: number;
  taxable_allowances: number;
  non_taxable_allowances: number;
  overtime: number;
  taxable_overtime?: number;
  bonuses_and_other_earnings: number;
  taxable_bonuses_and_other_earnings?: number;
  attendance_deduction: number;
  gross_earnings: number;
  paye_taxable_income: number;
  paye: number;
  napsa_employee: number;
  napsa_employer: number;
  nhima_employee: number;
  nhima_employer: number;
  other_approved_deductions: number;
  net_pay: number | null;
  total_employer_cost: number;
  due_deduction_items?: PayrollPreviewItem['due_approved_deductions'];
};

export type PayrollCalculationSnapshot = {
  status: 'CALCULATED';
  payroll_run_id: string;
  payroll_run_version: number;
  company_id: string;
  branch_id: string;
  period_start: string;
  period_end: string;
  calculation_version: string;
  calculation_rule_version_id: string;
  statutory_rule_version_ids: string[];
  source_verification_status: string;
  rounding: string;
  totals: {
    employee_count: number;
    gross_earnings: number;
    paye: number;
    napsa_employee: number;
    napsa_employer: number;
    nhima_employee: number;
    nhima_employer: number;
    net_pay: number;
    total_employer_cost: number;
  };
  items: PayrollCalculationItem[];
};

export type PayrollCalculationHistoryEntry = {
  id: string;
  payroll_version: number;
  calculation_version: string;
  calculation_rule_version_id: string;
  created_at: string;
};

export type PayrollPayoutInstructions = {
  export_id: string;
  payroll_run_id: string;
  payroll_version: number;
  status: 'INSTRUCTIONS_PREPARED_NOT_TRANSMITTED';
  manifest_sha256: string;
  instructions: Array<{
    employee_id: string;
    employee_number: string;
    employee_name: string;
    net_pay: number;
    payment_method: 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CASH';
    bank_name: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_branch_name: string | null;
    mobile_money_provider: string | null;
    mobile_money_number: string | null;
  }>;
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
export type EmployeeImportJobResult = {
  id: string; status: 'COMPLETED' | 'VALIDATION_FAILED' | 'FAILED'; total_rows: number;
  imported_rows: number; errors: Array<{ line?: number; message: string }>; replayed: boolean;
};
export type EmployeeImportJobRecord = {
  id: string; company_id: string; branch_id: string; status: EmployeeImportJobResult['status'];
  total_rows: number; imported_rows: number; errors: Array<{ line?: number; message: string }>; created_at: string;
};
export type EmployeeImportBatchInput = Omit<EmployeeDraftInput, 'portfolioId' | 'companyId' | 'branchId'> & {
  line: number;
};
export type EmployeeCorrectionDetails = {
  employee: Record<string, string | number | null>;
  private_details: Record<string, string | null>;
  compensation: Record<string, string | number | boolean | null>;
  company_id: string;
  branch_id: string;
  portfolio_id: string;
  approval_status: EmployeeDirectoryRecord['approval_status'];
};
export type EmployeeHistoryRecord = {
  id: number;
  action: string;
  reason: string | null;
  occurred_at: string;
  actor_id: string;
};
export type EmploymentHistoryRecord = {
  id: number; previous_status: EmployeeDirectoryRecord['employment_status'];
  new_status: EmployeeDirectoryRecord['employment_status']; reason: string; occurred_at: string; actor_id: string;
};
export type CompanyAdminRecord = { user_id: string; email: string; display_name: string | null; role: 'COMPANY_ADMIN'; created_at: string; revoked_at: string | null };
export type CompanyPayrollApproverRecord = Omit<CompanyAdminRecord, 'role'> & { role: 'COMPANY_PAYROLL_APPROVER' };
export type CompanyPayrollPreparerRecord = Omit<CompanyAdminRecord, 'role'> & { role: 'COMPANY_PAYROLL_PREPARER' };
export type PortfolioMemberRecord = { user_id: string; email: string; display_name: string | null; role: 'PORTFOLIO_ADMIN' | 'OVERALL_HR_MANAGER' | 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR'; created_at: string; revoked_at: string | null; branch_ids: string[] };
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
    byId(employeeId: string): Promise<EmployeeDirectoryRecord>;
    history(employeeId: string): Promise<EmployeeHistoryRecord[]>;
    employmentHistory(employeeId: string): Promise<EmploymentHistoryRecord[]>;
    setEmploymentStatus(employeeId: string, status: EmployeeDirectoryRecord['employment_status'], reason: string): Promise<void>;
    createDraft(input: EmployeeDraftInput): Promise<string>;
    correctionDetails(employeeId: string): Promise<EmployeeCorrectionDetails>;
    updateDraft(employeeId: string, input: Pick<EmployeeDraftInput, 'employee' | 'privateDetails' | 'compensation'>): Promise<string>;
    submitForHrApproval(employeeId: string): Promise<string>;
    reviewSubmission(employeeId: string, decision: EmployeeReviewDecision, reason?: string): Promise<string>;
    importBatch(input: { portfolioId: string; companyId: string; branchId: string; idempotencyKey: string; rows: EmployeeImportBatchInput[] }): Promise<EmployeeImportJobResult>;
    importHistory(companyId: string, branchId: string, page?: number): Promise<PageResult<EmployeeImportJobRecord>>;
  };
  companyAdmins: {
    list(portfolioId: string, companyId: string): Promise<CompanyAdminRecord[]>;
    assign(portfolioId: string, companyId: string, userId: string): Promise<void>;
    revoke(portfolioId: string, companyId: string, userId: string, reason: string): Promise<void>;
  };
  companyPayrollApprovers: {
    list(portfolioId: string, companyId: string): Promise<CompanyPayrollApproverRecord[]>;
    assign(portfolioId: string, companyId: string, userId: string): Promise<void>;
    revoke(portfolioId: string, companyId: string, userId: string, reason: string): Promise<void>;
  };
  companyPayrollPreparers: {
    list(portfolioId: string, companyId: string): Promise<CompanyPayrollPreparerRecord[]>;
    assign(portfolioId: string, companyId: string, userId: string): Promise<void>;
    revoke(portfolioId: string, companyId: string, userId: string, reason: string): Promise<void>;
  };
  portfolioUsers: {
    list(portfolioId: string): Promise<PortfolioMemberRecord[]>;
    assign(portfolioId: string, userId: string, role: PortfolioMemberRecord['role'], branchIds?: string[]): Promise<void>;
    replaceBranchAssignments(portfolioId: string, companyId: string, userId: string, role: 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR', branchIds: string[]): Promise<void>;
    revoke(portfolioId: string, userId: string, role: PortfolioMemberRecord['role'], reason: string): Promise<void>;
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
  payroll: {
    list(request?: PageRequest & { companyId?: string; branchId?: string; status?: string }): Promise<PageResult<PayrollRunRecord>>;
    byId(runId: string): Promise<PayrollRunRecord>;
    previewInputs(input: { companyId: string; branchId: string; periodStart: string; periodEnd: string }): Promise<PayrollPreviewInputs>;
    createEarningInput(input: { companyId: string; branchId: string; employeeId: string; periodStart: string; periodEnd: string; earningType: Exclude<PayrollEarningInputRecord['earning_type'], 'OVERTIME'>; amount: number; taxableForPaye: boolean; sourceReference: string; description: string; idempotencyKey: string }): Promise<string>;
    createOvertimeInput(input: { companyId: string; branchId: string; employeeId: string; periodStart: string; periodEnd: string; workDate: string; weekStart: string; hours: number; dayType: 'ORDINARY' | 'REST_DAY' | 'PUBLIC_HOLIDAY'; weeklyHours: number; outsideNormalWorkWeek: boolean; sourceReference: string; description: string; idempotencyKey: string }): Promise<string>;
    setOvertimeDivisor(employeeId: string, effectiveFrom: string, divisor: 176 | 208 | 240): Promise<string>;
    reviewEarningInput(inputId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<string>;
    setUnpaidLeaveMethod(employeeId: string, effectiveFrom: string, method: PayrollPreviewItem['unpaid_leave_deduction_method']): Promise<string>;
    createDraft(input: { companyId: string; branchId: string; periodStart: string; periodEnd: string; frequency: 'MONTHLY' | 'FORTNIGHTLY' | 'WEEKLY'; idempotencyKey: string }): Promise<string>;
    calculate(runId: string, idempotencyKey: string): Promise<PayrollCalculationSnapshot>;
    listCalculationHistory(runId: string): Promise<PayrollCalculationHistoryEntry[]>;
    submitForApproval(runId: string): Promise<string>;
    reviewSubmission(runId: string, action: PayrollReviewAction, expectedVersion: number, reason?: string): Promise<string>;
    finalize(runId: string): Promise<string>;
    preparePayoutInstructions(runId: string): Promise<PayrollPayoutInstructions>;
  };
  payslips: {
    finalizedRuns(companyId: string, branchId?: string): Promise<FinalizedPayslipRunRecord[]>;
    finalizedItems(payrollRunId: string, payrollVersion: number, page?: number): Promise<PageResult<FinalizedPayslipItemRecord>>;
    issueDocument(payrollRunId: string, employeeId: string): Promise<{ documentId: string; signedUrl: string }>;
    downloadDocument(documentId: string): Promise<{ signedUrl: string }>;
    sendEmail(documentId: string): Promise<{ deliveryId: string; status: string; deliveryConfigured: boolean }>;
    retryEmail(deliveryId: string): Promise<{ deliveryId: string; status: string; deliveryConfigured: boolean }>;
    deliveryHistory(documentId: string): Promise<PayslipDeliveryRecord[]>;
  };
  audit: {
    list(request: PageRequest & { companyId?: string; branchId?: string; action?: string; from?: string; to?: string }): Promise<PageResult<AuditLogRecord>>;
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
          .select('id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,job_title,department,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,retirement_status,approval_status,employment_status,submitted_at,reviewed_at,created_at', { count: 'exact' })
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
          .select('id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,job_title,department,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,retirement_status,approval_status,employment_status,submitted_at,reviewed_at,created_at')
          .in('id', [...new Set(ids)]);
        if (result.error) throw result.error;
        return (result.data ?? []) as EmployeeDirectoryRecord[];
      },
      async byId(employeeId) {
        const result = await client.from('employees')
          .select('id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,job_title,department,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,retirement_status,approval_status,employment_status,submitted_at,reviewed_at,created_at')
          .eq('id', employeeId).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('Employee record is unavailable under the current access scope.');
        return result.data as EmployeeDirectoryRecord;
      },
      async history(employeeId) {
        const result = await client.from('employee_approval_history')
          .select('id,action,reason,occurred_at,actor_id')
          .eq('employee_id', employeeId)
          .order('occurred_at', { ascending: false })
          .range(0, 49);
        if (result.error) throw result.error;
        return (result.data ?? []) as EmployeeHistoryRecord[];
      },
      async employmentHistory(employeeId) {
        const result = await client.from('employee_employment_history')
          .select('id,previous_status,new_status,reason,occurred_at,actor_id').eq('employee_id', employeeId)
          .order('occurred_at', { ascending: false }).range(0, 49);
        if (result.error) throw result.error;
        return (result.data ?? []) as EmploymentHistoryRecord[];
      },
      async setEmploymentStatus(employeeId, status, reason) {
        const result = await client.rpc('employee_set_employment_status', { p_employee_id: employeeId, p_status: status, p_reason: reason });
        if (result.error) throw result.error;
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
      async correctionDetails(employeeId) {
        return unwrap(await client.rpc('employee_correction_details', { p_employee_id: employeeId })) as EmployeeCorrectionDetails;
      },
      async updateDraft(employeeId, input) {
        return unwrap(await client.rpc('employee_update_draft', {
          p_employee_id: employeeId,
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
      async importBatch(input) {
        const rows = input.rows.map(({ line, employee, privateDetails, compensation }) => ({
          line, employee, private_details: privateDetails, compensation,
        }));
        return unwrap(await client.rpc('employee_import_atomic', {
          p_portfolio_id: input.portfolioId, p_company_id: input.companyId, p_branch_id: input.branchId,
          p_idempotency_key: input.idempotencyKey, p_rows: rows,
        })) as EmployeeImportJobResult;
      },
      async importHistory(companyId, branchId, page = 1) {
        const pageSize = 20;
        const offset = Math.max(0, page - 1) * pageSize;
        const result = await client.from('employee_import_jobs')
          .select('id,company_id,branch_id,status,total_rows,imported_rows,errors,created_at', { count: 'exact' })
          .eq('company_id', companyId).eq('branch_id', branchId)
          .order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as EmployeeImportJobRecord[], total: result.count ?? 0 };
      },
    },
    companyAdmins: {
      async list(portfolioId, companyId) {
        const result = await client.rpc('company_admin_members', { p_portfolio_id: portfolioId, p_company_id: companyId });
        if (result.error) throw result.error;
        return (result.data ?? []) as CompanyAdminRecord[];
      },
      async assign(portfolioId, companyId, userId) {
        const result = await client.rpc('assign_company_admin', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId });
        if (result.error) throw result.error;
      },
      async revoke(portfolioId, companyId, userId, reason) {
        const result = await client.rpc('revoke_company_admin', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId, p_reason: reason });
        if (result.error) throw result.error;
      },
    },
    companyPayrollApprovers: {
      async list(portfolioId, companyId) {
        const result = await client.rpc('company_payroll_approver_members', { p_portfolio_id: portfolioId, p_company_id: companyId });
        if (result.error) throw result.error;
        return (result.data ?? []) as CompanyPayrollApproverRecord[];
      },
      async assign(portfolioId, companyId, userId) {
        const result = await client.rpc('assign_company_payroll_approver', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId });
        if (result.error) throw result.error;
      },
      async revoke(portfolioId, companyId, userId, reason) {
        const result = await client.rpc('revoke_company_payroll_approver', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId, p_reason: reason });
        if (result.error) throw result.error;
      },
    },
    companyPayrollPreparers: {
      async list(portfolioId, companyId) {
        const result = await client.rpc('company_payroll_preparer_members', { p_portfolio_id: portfolioId, p_company_id: companyId });
        if (result.error) throw result.error;
        return (result.data ?? []) as CompanyPayrollPreparerRecord[];
      },
      async assign(portfolioId, companyId, userId) {
        const result = await client.rpc('assign_company_payroll_preparer', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId });
        if (result.error) throw result.error;
      },
      async revoke(portfolioId, companyId, userId, reason) {
        const result = await client.rpc('revoke_company_payroll_preparer', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId, p_reason: reason });
        if (result.error) throw result.error;
      },
    },
    portfolioUsers: {
      async list(portfolioId) {
        const result = await client.rpc('portfolio_membership_directory', { p_portfolio_id: portfolioId });
        if (result.error) throw result.error;
        return (result.data ?? []) as PortfolioMemberRecord[];
      },
      async assign(portfolioId, userId, role, branchIds = []) {
        const result = await client.rpc('assign_portfolio_membership', { p_portfolio_id: portfolioId, p_user_id: userId, p_role: role, p_branch_ids: branchIds });
        if (result.error) throw result.error;
      },
      async replaceBranchAssignments(portfolioId, companyId, userId, role, branchIds) {
        const result = await client.rpc('replace_branch_role_assignments', { p_portfolio_id: portfolioId, p_company_id: companyId, p_user_id: userId, p_role: role, p_branch_ids: branchIds });
        if (result.error) throw result.error;
      },
      async revoke(portfolioId, userId, role, reason) {
        const result = await client.rpc('revoke_portfolio_membership', { p_portfolio_id: portfolioId, p_user_id: userId, p_role: role, p_reason: reason });
        if (result.error) throw result.error;
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
    payroll: {
      async list(request = {}) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 25));
        let query = client.from('payroll_runs')
          .select('id,company_id,branch_id,payroll_period_id,status,version,created_by,created_at,calculations', { count: 'exact' })
          .order('created_at', { ascending: false });
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        if (request.status) query = query.eq('status', request.status);
        query = query.range(page * pageSize, page * pageSize + pageSize - 1);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as PayrollRunRecord[], total: result.count ?? 0 };
      },
      async byId(runId) {
        const result = await client.from('payroll_runs')
          .select('id,company_id,branch_id,payroll_period_id,status,version,created_by,created_at,calculations')
          .eq('id', runId).single();
        if (result.error) throw result.error;
        return result.data as PayrollRunRecord;
      },
      async previewInputs(input) {
        return unwrap(await client.rpc('payroll_preview_inputs', {
          p_company_id: input.companyId, p_branch_id: input.branchId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd,
        })) as PayrollPreviewInputs;
      },
      async createEarningInput(input) {
        return unwrap(await client.rpc('payroll_earning_input_create', {
          p_company_id: input.companyId, p_branch_id: input.branchId, p_employee_id: input.employeeId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd, p_earning_type: input.earningType,
          p_amount: input.amount, p_taxable_for_paye: input.taxableForPaye, p_source_reference: input.sourceReference,
          p_description: input.description, p_idempotency_key: input.idempotencyKey,
        }));
      },
      async createOvertimeInput(input) {
        return unwrap(await client.rpc('payroll_overtime_input_create', {
          p_company_id: input.companyId, p_branch_id: input.branchId, p_employee_id: input.employeeId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd, p_work_date: input.workDate,
          p_week_start: input.weekStart, p_hours: input.hours, p_day_type: input.dayType,
          p_weekly_hours: input.weeklyHours,
          p_outside_normal_work_week: input.outsideNormalWorkWeek, p_source_reference: input.sourceReference,
          p_description: input.description, p_idempotency_key: input.idempotencyKey,
        }));
      },
      async setOvertimeDivisor(employeeId, effectiveFrom, divisor) {
        return unwrap(await client.rpc('employee_compensation_set_overtime_divisor', {
          p_employee_id: employeeId, p_effective_from: effectiveFrom, p_divisor: divisor,
        }));
      },
      async reviewEarningInput(inputId, decision, reason) {
        return unwrap(await client.rpc('payroll_earning_input_review', {
          p_earning_input_id: inputId, p_decision: decision, p_reason: reason ?? null,
        }));
      },
      async setUnpaidLeaveMethod(employeeId, effectiveFrom, method) {
        return unwrap(await client.rpc('employee_compensation_set_unpaid_leave_method', {
          p_employee_id: employeeId, p_effective_from: effectiveFrom, p_method: method,
        }));
      },
      async createDraft(input) {
        return unwrap(await client.rpc('payroll_create_draft', {
          p_company_id: input.companyId, p_branch_id: input.branchId,
          p_period_start: input.periodStart, p_period_end: input.periodEnd,
          p_frequency: input.frequency, p_idempotency_key: input.idempotencyKey,
        }));
      },
      async calculate(runId, idempotencyKey) {
        return unwrap(await client.rpc('payroll_calculate', {
          p_payroll_run_id: runId, p_idempotency_key: idempotencyKey,
        })) as PayrollCalculationSnapshot;
      },
      async listCalculationHistory(runId) {
        const result = await client.from('payroll_calculation_history')
          .select('id,payroll_version,calculation_version,calculation_rule_version_id,created_at')
          .eq('payroll_run_id', runId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (result.error) throw result.error;
        return (result.data ?? []) as PayrollCalculationHistoryEntry[];
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
      async preparePayoutInstructions(runId) {
        return unwrap(await client.rpc('payroll_prepare_payout_instructions', { p_payroll_run_id: runId })) as PayrollPayoutInstructions;
      },
    },
    payslips: {
      async finalizedRuns(companyId, branchId) {
        let query = client.from('payroll_runs')
          .select('id,company_id,branch_id,payroll_period_id,status,version,finalized_at,payroll_periods!inner(period_start,period_end)')
          .eq('company_id', companyId).eq('status', 'FINALIZED')
          .order('finalized_at', { ascending: false }).range(0, 99);
        if (branchId) query = query.eq('branch_id', branchId);
        const result = await query;
        if (result.error) throw result.error;
        return (result.data ?? []) as unknown as FinalizedPayslipRunRecord[];
      },
      async finalizedItems(payrollRunId, payrollVersion, page = 1) {
        const pageSize = 100;
        const offset = Math.max(0, page - 1) * pageSize;
        const result = await client.from('payroll_run_items')
          .select('id,payroll_run_id,employee_id,version,basic_pay,housing_allowance,meal_allowance,transport_allowance,other_allowances,overtime,bonuses_and_other_earnings,attendance_deduction,gross_pay,statutory_deductions,voluntary_deductions,net_pay,calculation_breakdown,paye_taxable_income,napsa_employee,napsa_employer,nhima_employee,nhima_employer,total_employer_cost,payroll_runs!inner(status,version)', { count: 'exact' })
          .eq('payroll_run_id', payrollRunId).eq('version', payrollVersion)
          .eq('payroll_runs.status', 'FINALIZED').eq('payroll_runs.version', payrollVersion)
          .order('employee_id').range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as unknown as FinalizedPayslipItemRecord[], total: result.count ?? 0 };
      },
      async issueDocument(payrollRunId, employeeId) {
        const result = await client.functions.invoke('payslip-artifacts', { body: { action: 'issue', payrollRunId, employeeId } });
        if (result.error) throw result.error;
        const data = result.data as { documentId?: unknown; signedUrl?: unknown } | null;
        if (typeof data?.documentId !== 'string' || typeof data.signedUrl !== 'string') throw new Error('Payslip document response is invalid.');
        return { documentId: data.documentId, signedUrl: data.signedUrl };
      },
      async downloadDocument(documentId) {
        const result = await client.functions.invoke('payslip-artifacts', { body: { action: 'download', documentId } });
        if (result.error) throw result.error;
        const data = result.data as { signedUrl?: unknown } | null;
        if (typeof data?.signedUrl !== 'string') throw new Error('Payslip download response is invalid.');
        return { signedUrl: data.signedUrl };
      },
      async sendEmail(documentId) {
        const result = await client.functions.invoke('payslip-artifacts', { body: { action: 'email', documentId } });
        if (result.error) throw result.error;
        return result.data as { deliveryId: string; status: string; deliveryConfigured: boolean };
      },
      async retryEmail(deliveryId) {
        const result = await client.functions.invoke('payslip-artifacts', { body: { action: 'retry-email', deliveryId } });
        if (result.error) throw result.error;
        return result.data as { deliveryId: string; status: string; deliveryConfigured: boolean };
      },
      async deliveryHistory(documentId) {
        const result = await client.rpc('payslip_email_history', { p_document_id: documentId });
        if (result.error) throw result.error;
        return (result.data ?? []) as PayslipDeliveryRecord[];
      },
    },
    audit: {
      async list(request) {
        const page = Math.max(0, (request.page ?? 1) - 1);
        const pageSize = Math.min(100, Math.max(1, request.pageSize ?? 50));
        let query = client.from('audit_logs')
          .select('id,portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details,occurred_at', { count: 'exact' })
          .order('occurred_at', { ascending: false }).order('id', { ascending: false })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (request.companyId) query = query.eq('company_id', request.companyId);
        if (request.branchId) query = query.eq('branch_id', request.branchId);
        if (request.action?.trim()) query = query.ilike('action', `%${request.action.trim()}%`);
        if (request.from) query = query.gte('occurred_at', `${request.from}T00:00:00.000Z`);
        if (request.to) query = query.lt('occurred_at', `${request.to}T23:59:59.999Z`);
        const result = await query;
        if (result.error) throw result.error;
        return { items: (result.data ?? []) as AuditLogRecord[], total: result.count ?? 0 };
      },
    },
  };
}

