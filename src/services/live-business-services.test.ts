import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLiveBusinessServices } from './live-business-services';

describe('live Supabase business service adapter', () => {
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
});

