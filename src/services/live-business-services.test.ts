import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLiveBusinessServices } from './live-business-services';

describe('live Supabase business service adapter', () => {
  it('submits imports through one idempotent atomic server workflow', async () => {
    const response = { id: 'job-1', status: 'COMPLETED', total_rows: 1, imported_rows: 0, updated_rows: 1, errors: [], replayed: false }
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: response, error: null }))
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient)
    await expect(services.employees.importBatch({
      portfolioId: 'portfolio-1', companyId: 'company-1', branchId: 'branch-1', idempotencyKey: 'synthetic-import-123',
      rows: [{ line: 2, operation: 'SAFE_UPSERT_DRAFT', employee: { employee_number: 'SYN-1' }, privateDetails: { phone: 'synthetic' }, compensation: { basic_pay: 1000 } }],
    })).resolves.toMatchObject({ id: 'job-1', status: 'COMPLETED', imported_rows: 0, updated_rows: 1 })
    expect(rpc).toHaveBeenCalledWith('employee_import_atomic', expect.objectContaining({
      p_idempotency_key: 'synthetic-import-123', p_rows: [{ line: 2, operation: 'SAFE_UPSERT_DRAFT', employee: { employee_number: 'SYN-1' }, private_details: { phone: 'synthetic' }, compensation: { basic_pay: 1000 } }],
    }))
  })

  it('enables controlled draft updates only when the scoped database capability confirms them', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: true, error: null }))
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient)
    await expect(services.employees.supportsDraftImportUpdates('portfolio-1', 'company-1', 'branch-1')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('employee_import_supports_draft_updates', {
      p_portfolio_id: 'portfolio-1', p_company_id: 'company-1', p_branch_id: 'branch-1',
    })
  })

  it('keeps controlled draft updates disabled when the database capability is absent', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: new Error('function not found') }))
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient)
    await expect(services.employees.supportsDraftImportUpdates('portfolio-1', 'company-1', 'branch-1')).resolves.toBe(false)
  })

  it('reads payslip delivery history through a redacted permission-checked RPC', async () => {
    const delivery = { id: 'delivery-1', document_id: 'document-1', status: 'FAILED', attempts: 1,
      last_error_code: 'SYNTHETIC_FAILURE', created_at: '2026-10-28T12:00:00Z', updated_at: '2026-10-28T12:01:00Z', sent_at: null }
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: [delivery], error: null }))
    const from = vi.fn()
    const services = createLiveBusinessServices({ rpc, from } as unknown as SupabaseClient)
    await expect(services.payslips.deliveryHistory('document-1')).resolves.toEqual([delivery])
    expect(rpc).toHaveBeenCalledWith('payslip_email_history', { p_document_id: 'document-1' })
    expect(from).not.toHaveBeenCalled()
    expect(delivery).not.toHaveProperty('recipient_email')
  })

  it('filters and paginates payroll runs using the live scoped table query', async () => {
    const range = vi.fn(async () => ({ data: [{ id: 'run-26' }], count: 26, error: null }))
    const filters = vi.fn()
    const builder: any = { eq: filters, order: vi.fn(() => builder), range }
    const query = { select: vi.fn(() => builder) }
    filters.mockImplementation((column: string, value: string) => {
      expect(['company_id', 'branch_id', 'status']).toContain(column)
      expect(value).toBeTruthy()
      return builder
    })
    const from = vi.fn(() => query)
    const services = createLiveBusinessServices({ from } as unknown as SupabaseClient)
    await expect(services.payroll.list({ companyId: 'company-1', branchId: 'branch-1', status: 'FINALIZED', page: 2, pageSize: 25 }))
      .resolves.toEqual({ items: [{ id: 'run-26' }], total: 26 })
    expect(from).toHaveBeenCalledWith('payroll_runs')
    expect(filters.mock.calls).toEqual([['company_id', 'company-1'], ['branch_id', 'branch-1'], ['status', 'FINALIZED']])
    expect(range).toHaveBeenCalledWith(25, 49)
  })

  it('filters employee pages by a selected company department within RLS-visible rows', async () => {
    const range = vi.fn(async () => ({ data: [], count: 0, error: null }))
    const filter = vi.fn()
    const builder: any = { eq: filter, ilike: vi.fn(() => builder), order: vi.fn(() => builder), range }
    const query = { select: vi.fn(() => builder) }
    filter.mockImplementation(() => builder)
    const from = vi.fn(() => query)
    const services = createLiveBusinessServices({ from } as unknown as SupabaseClient)
    await services.employees.list({ page: 1, pageSize: 25, search: '', departmentId: 'department-qa' })
    expect(from).toHaveBeenCalledWith('employees')
    expect(filter).toHaveBeenCalledWith('department_id', 'department-qa')
    expect(range).toHaveBeenCalledWith(0, 24)
  })

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

  it('routes payroll approver administration through company-scoped RPCs', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: null }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);
    await services.companyPayrollApprovers.assign('portfolio-1', 'qa-company', 'qa-approver');
    await services.companyPayrollApprovers.list('portfolio-1', 'qa-company');
    await services.companyPayrollApprovers.revoke('portfolio-1', 'qa-company', 'qa-approver', 'QA teardown');
    expect(rpc.mock.calls).toEqual([
      ['assign_company_payroll_approver', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company', p_user_id: 'qa-approver' }],
      ['company_payroll_approver_members', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company' }],
      ['revoke_company_payroll_approver', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company', p_user_id: 'qa-approver', p_reason: 'QA teardown' }],
    ]);
  });

  it('routes payroll preparer administration through company-scoped RPCs', async () => {
    const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: null }));
    const services = createLiveBusinessServices({ rpc } as unknown as SupabaseClient);
    await services.companyPayrollPreparers.assign('portfolio-1', 'qa-company', 'qa-preparer');
    await services.companyPayrollPreparers.list('portfolio-1', 'qa-company');
    await services.companyPayrollPreparers.revoke('portfolio-1', 'qa-company', 'qa-preparer', 'QA teardown');
    expect(rpc.mock.calls).toEqual([
      ['assign_company_payroll_preparer', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company', p_user_id: 'qa-preparer' }],
      ['company_payroll_preparer_members', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company' }],
      ['revoke_company_payroll_preparer', { p_portfolio_id: 'portfolio-1', p_company_id: 'qa-company', p_user_id: 'qa-preparer', p_reason: 'QA teardown' }],
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
    await expect(services.payroll.submitForApproval('run-1')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.previewInputs({ companyId: 'company-1', branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31' })).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.createOvertimeInput({ companyId: 'company-1', branchId: 'branch-1', employeeId: 'employee-1',
      periodStart: '2026-10-01', periodEnd: '2026-10-31', workDate: '2026-10-20', weekStart: '2026-10-19',
      hours: 4, dayType: 'ORDINARY', weeklyHours: 52, outsideNormalWorkWeek: false,
      sourceReference: 'SYN-TIMESHEET-1', description: 'Synthetic overtime', idempotencyKey: 'overtime-idempotency-1' })).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.setOvertimeDivisor('employee-1', '2026-10-01', 176)).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.createDraft({ companyId: 'company-1', branchId: 'branch-1', periodStart: '2026-10-01', periodEnd: '2026-10-31', frequency: 'MONTHLY', idempotencyKey: 'payroll-request-1' })).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.calculate('run-1', 'payroll-calculation-1')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.reviewSubmission('run-1', 'APPROVE', 4)).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.finalize('run-1')).resolves.toBe('synthetic-record-id');
    await expect(services.payroll.preparePayoutInstructions('run-1')).resolves.toBe('synthetic-record-id');

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'employee_create_draft',
      'employee_submit_for_hr_approval',
      'deduction_create_request',
      'deduction_review_request',
      'attendance_save_entry',
      'attendance_submit_period',
      'attendance_review_period',
      'payroll_submit_for_approval',
      'payroll_preview_inputs',
      'payroll_overtime_input_create',
      'employee_compensation_set_overtime_divisor',
      'payroll_create_draft',
      'payroll_calculate',
      'payroll_review_submission',
      'payroll_finalize',
      'payroll_prepare_payout_instructions',
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

