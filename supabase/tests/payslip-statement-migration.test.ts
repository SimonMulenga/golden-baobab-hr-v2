import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261101005200_payslip_statement_details_and_delivery.sql'), 'utf8')

describe('payslip statement migration contract', () => {
  it('limits statement balances to authenticated payroll-view scope and finalized runs', () => {
    expect(migration).toMatch(/create or replace function public\.payslip_statement_details[\s\S]*?security definer[\s\S]*?set row_security = off/i)
    expect(migration).toMatch(/auth\.uid\(\) is null/i)
    expect(migration).toMatch(/r\.status = 'FINALIZED'/i)
    expect(migration).toMatch(/has_permission\([\s\S]*?'payroll\.view'/i)
    expect(migration).toMatch(/grant execute on function public\.payslip_statement_details\(uuid,uuid\) to authenticated/i)
    expect(migration).toMatch(/revoke all on function public\.payslip_statement_details\(uuid,uuid\) from public, anon/i)
  })

  it('derives leave from applicable effective policies and ledger entries through the payroll period end', () => {
    expect(migration).toMatch(/lp\.effective_from <= v_period_end/i)
    expect(migration).toMatch(/lp\.effective_to is null or lp\.effective_to >= v_period_end/i)
    expect(migration).toMatch(/l\.period_start <= v_period_end/i)
    expect(migration).toMatch(/lp\.accrual_days_per_month/i)
  })

  it('derives outstanding approved advance balances from repayment transactions without changing payroll totals', () => {
    expect(migration).toMatch(/d\.approved_at is not null/i)
    expect(migration).toMatch(/t\.transaction_type = 'REVERSAL' then -t\.amount/i)
    expect(migration).toMatch(/d\.principal_amount - recovered\.amount_recovered/i)
    expect(migration).not.toMatch(/update public\.payroll_run_items|delete from public\.payroll_run_items/i)
  })
})
