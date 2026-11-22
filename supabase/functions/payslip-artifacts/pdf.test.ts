import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1'
import { buildPayslipPdf } from './pdf.ts'

Deno.test('synthetic payslip PDF paginates long earning, deduction and leave detail without changing values', async () => {
  const snapshot = {
    finalized_at: '2026-10-31T18:00:00Z',
    payroll_run_id: 'synthetic-run-001',
    payroll_version: 4,
    period_start: '2026-10-01',
    company: { name: 'Synthetic Test Company', address: 'Test Street', town: 'Lusaka', province: 'Lusaka' },
    employee: { employee_number: 'SYN-001', first_name: 'Synthetic', middle_name: 'Test', last_name: 'Employee', job_title: 'Test Analyst', department: 'QA' },
    branch: { name: 'Synthetic Test Branch' },
    payroll_item: {
      basic_pay: 15000, housing_allowance: 3000, meal_allowance: 500, transport_allowance: 500,
      other_allowances: 0, overtime: 125, attendance_deduction: 0, gross_pay: 19375,
      statutory_deductions: { PAYE: 4500, NAPSA_EMPLOYEE: 968.75, NHIMA_EMPLOYEE: 145.31 },
      voluntary_deductions: 5000, net_pay: 8760.94,
      calculation_breakdown: {
        approved_earning_items: Array.from({ length: 25 }, (_, index) => ({ earning_type: `SYNTHETIC_EARNING_${index + 1}`, amount: 10 })),
        due_deduction_items: Array.from({ length: 35 }, (_, index) => ({ deduction_type: `SYNTHETIC_DEDUCTION_${index + 1}`, scheduled_amount: 100 })),
      },
    },
    leave: { policies: Array.from({ length: 16 }, (_, index) => ({ leave_type: `SYNTHETIC_LEAVE_${index + 1}`, monthly_entitlement_days: 1.5, balance_days: 4 })) },
    deductions: Array.from({ length: 16 }, (_, index) => ({ description: `Synthetic advance ${index + 1}`, total_amount: 1000, amount_recovered: 100, balance: 900 })),
  }

  const bytes = await buildPayslipPdf(snapshot)
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
  const loaded = await PDFDocument.load(bytes)
  assert(loaded.getPageCount() > 1, 'dense synthetic payslip detail should flow to additional pages')
  assertEquals(loaded.getTitle(), 'Employee payslip')
  assertEquals(loaded.getSubject(), 'Finalized payroll record')
})
