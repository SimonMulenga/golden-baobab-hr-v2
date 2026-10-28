import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLiveBusinessServices } from './live-business-services';

describe('live Supabase business service adapter', () => {
  it('routes company administrator changes and employee status transitions through scoped RPCs', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: null }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);
    await services.companyAdmins.assign('portfolio-1', 'company-1', 'user-2');
    await services.companyAdmins.revoke('portfolio-1', 'company-1', 'user-2', 'Synthetic review');
    await services.companyAdmins.list('portfolio-1', 'company-1');
    await services.employees.setEmploymentStatus('employee-1', 'SUSPENDED', 'Synthetic review');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'assign_company_admin', 'revoke_company_admin', 'company_admin_members', 'employee_set_employment_status',
    ]);
  });

  it('routes branch-role assignment and replacement through trusted portfolio RPCs', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: null }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);
    await services.portfolioUsers.list('portfolio-1');
    await services.portfolioUsers.assign('portfolio-1', 'user-2', 'BRANCH_MANAGER', ['branch-1']);
    await services.portfolioUsers.replaceBranchAssignments('portfolio-1', 'company-1', 'user-2', 'BRANCH_MANAGER', ['branch-2']);
    await services.portfolioUsers.revoke('portfolio-1', 'user-2', 'BRANCH_MANAGER', 'Synthetic scope update');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'portfolio_membership_directory', 'assign_portfolio_membership', 'replace_branch_role_assignments', 'revoke_portfolio_membership',
    ]);
  });

  it('routes privileged workflows through named database RPCs', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: 'synthetic-record-id', error: null }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);

    await expect(services.employees.createDraft({
      portfolioId: 'portfolio-1', companyId: 'company-1', branchId: 'branch-1',
      employee: { employee_number: 'SYN-1' }, privateDetails: { payment_method: 'CASH' },
      compensation: { basic_pay: 6000, payment_method: 'CASH' },
    })).resolves.toBe('synthetic-record-id');
    await expect(services.employees.submitForHrApproval('employee-1')).resolves.toBe('synthetic-record-id');
    await expect(services.deductions.createRequest({
      portfolioId: 'portfolio-1', companyId: 'company-1', branchId: 'branch-1', employeeId: 'employee-1',
      idempotencyKey: 'request-1', details: { principal_amount: 6000, repayment_method: 'EQUAL_INSTALLMENTS', requested_installments: 6 },
      schedule: [],
    })).resolves.toBe('synthetic-record-id');
    await expect(services.deductions.reviewRequest('deduction-1', 'APPROVE')).resolves.toBe('synthetic-record-id');
    await expect(services.attendance.saveEntry({ portfolioId: 'portfolio-1', companyId: 'company-1', branchId: 'branch-1',
      periodStart: '2026-10-01', periodEnd: '2026-10-31', employeeId: 'employee-1', scheduledDays: 22,
      workedDays: 20, paidLeaveDays: 1, unpaidLeaveDays: 1, payableAbsenceDays: 0, contractType: 'MONTHLY' })).resolves.toBe('synthetic-record-id');
    await expect(services.attendance.submitPeriod('attendance-period-1')).resolves.toBe('synthetic-record-id');
    await expect(services.attendance.reviewPeriod('attendance-period-1', 'APPROVE')).resolves.toBe('synthetic-record-id');
    await expect(services.leave.createRequest({ portfolioId: 'portfolio-1', companyId: 'company-1', branchId: 'branch-1',
      employeeId: 'employee-1', leaveType: 'Annual leave', payClassification: 'PAID', startDate: '2026-11-02',
      endDate: '2026-11-03', days: 2, reason: 'Synthetic request', idempotencyKey: 'leave-key-1' })).resolves.toBe('synthetic-record-id');
    await expect(services.leave.reviewRequest('leave-1', 'APPROVE')).resolves.toBe('synthetic-record-id');
    await expect(services.leave.accrueMonth('leave-policy-1', '2026-10-01')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.submitForApproval('run-1')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.previewInputs({ companyId: 'company-1', branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31' })).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.createDraft({ companyId: 'company-1', branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31', frequency: 'MONTHLY', idempotencyKey: 'payroll-request-1' })).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.calculateTrial('run-1', 'trial-request-1')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.reviewSubmission('run-1', 'APPROVE', 4)).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.finalize('run-1')).resolves.toBe('synthetic-record-id');

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'employee_create_draft',
      'employee_submit_for_hr_approval',
      'deduction_create_request',
      'deduction_review_request',
      'attendance_save_entry',
      'attendance_submit_period',
      'attendance_review_period',
      'leave_create_request',
      'leave_review_request',
      'leave_accrue_month',
      'payroll_submit_for_approval',
      'payroll_preview_inputs',
      'payroll_create_draft',
      'payroll_calculate_trial',
      'payroll_review_submission',
      'payroll_finalize',
    ]);
  });

  it('propagates backend failures and does not fall back to mock results', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: new Error('RLS denied') }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);

    await expect(services.payroll.finalize('run-1')).rejects.toThrow('RLS denied');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('loads deduction employee labels through an RLS-scoped non-private projection', async () => {
    const syntheticRecord = { id: 'employee-1', first_name: 'Demo', last_name: 'Employee' };
    const inFilter = vi.fn(async (_column: string, _ids: string[]) => ({ data: [syntheticRecord], error: null }));
    const select = vi.fn((_columns: string) => ({ in: inFilter }));
    const from = vi.fn((_table: string) => ({ select }));
    const services = createLiveBusinessServices({ from } as unknown as SupabaseClient);

    await expect(services.employees.byIds(['employee-1', 'employee-1'])).resolves.toEqual([syntheticRecord]);
    expect(from).toHaveBeenCalledWith('employees');
    expect(select.mock.calls[0][0]).not.toMatch(/date_of_birth|nrc|account_number|basic_pay|salary/i);
    expect(inFilter).toHaveBeenCalledWith('id', ['employee-1']);
  });

  it('reads a non-private employee profile and caps its approval history to fifty events', async () => {
    const profile = { id: 'employee-1', first_name: 'Demo', last_name: 'Employee' };
    const history = [{ id: 1, action: 'SUBMITTED', reason: null, occurred_at: '2026-10-28T07:00:00Z', actor_id: 'actor-1' }];
    const profileMaybeSingle = vi.fn(async () => ({ data: profile, error: null }));
    const profileEq = vi.fn(() => ({ maybeSingle: profileMaybeSingle }));
    const profileSelect = vi.fn((_columns: string) => ({ eq: profileEq }));
    const range = vi.fn(async () => ({ data: history, error: null }));
    const order = vi.fn(() => ({ range }));
    const historyEq = vi.fn(() => ({ order }));
    const historySelect = vi.fn((_columns: string) => ({ eq: historyEq }));
    const from = vi.fn((table: string) => ({ select: table === 'employees' ? profileSelect : historySelect }));
    const services = createLiveBusinessServices({ from } as unknown as SupabaseClient);

    await expect(services.employees.byId('employee-1')).resolves.toEqual(profile);
    await expect(services.employees.history('employee-1')).resolves.toEqual(history);
    expect(profileSelect.mock.calls[0][0]).not.toMatch(/date_of_birth|nrc|account_number|basic_pay|salary/i);
    expect(historySelect.mock.calls[0][0]).toBe('id,action,reason,occurred_at,actor_id');
    expect(range).toHaveBeenCalledWith(0, 49);
  });
});

