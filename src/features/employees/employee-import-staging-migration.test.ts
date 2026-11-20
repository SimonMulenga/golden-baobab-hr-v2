import { describe, expect, it } from 'vitest'
import migration from '../../../supabase/migrations/20261120005500_secure_employee_import_staging.sql?raw'
import pendingBranchMigration from '../../../supabase/migrations/20261120005600_allow_pending_import_branch_assignment.sql?raw'
import allowanceMigration from '../../../supabase/migrations/20261120005700_employee_import_allowance_components.sql?raw'
import departmentValidationMigration from '../../../supabase/migrations/20261120005800_validate_staged_departments.sql?raw'
import bulkApprovalMigration from '../../../supabase/migrations/20261120005900_employee_bulk_approval_and_queue_summary.sql?raw'
import approvalSummaryScopeMigration from '../../../supabase/migrations/20261120006000_refine_employee_approval_summary_scope.sql?raw'

describe('secure employee import staging migration contract', () => {
  it('is additive and retains the existing portfolio/company/branch and employee approval model', () => {
    expect(migration).toMatch(/create table public\.employee_import_batches/i)
    expect(migration).toMatch(/create table public\.employee_import_staging_records/i)
    expect(migration).toMatch(/valid_records integer not null/i)
    expect(migration).toMatch(/reviewed_records integer not null/i)
    expect(migration).toMatch(/ready_records integer not null/i)
    expect(migration).toMatch(/approved_records integer not null/i)
    expect(migration).toMatch(/foreign key \(portfolio_id, company_id, branch_id\) references public\.branches/i)
    expect(migration).toMatch(/public\.employee_import_atomic\(/i)
    expect(migration).toMatch(/employee_import_submit_staged/i)
    expect(migration).toMatch(/SUBMITTED_FOR_APPROVAL/i)
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table|schema|function)\b/i)
  })

  it('enforces RLS, denies direct client writes, and checks private-detail permission for staged data', () => {
    expect(migration).toMatch(/alter table public\.employee_import_staging_records enable row level security/i)
    expect(migration).toMatch(/employee\.private\.view/i)
    expect(migration).toMatch(/employee_import_batch_read_authorized/i)
    expect(migration).toMatch(/not app_private\.has_permission\('employee\.private\.view'/i)
    expect(migration).toMatch(/revoke all on public\.employee_import_batches, public\.employee_import_staging_records/i)
    expect(migration).toMatch(/grant select on public\.employee_import_batches, public\.employee_import_staging_records/i)
    expect(migration).toMatch(/grant execute on function public\.employee_import_stage_batch[\s\S]*?to authenticated/i)
  })

  it('pins security-definer procedures to pg_catalog and row-security-off checks', () => {
    const functions = ['employee_import_stage_batch','employee_import_stage_review','employee_import_submit_staged','employee_import_sync_approval_status']
    for (const name of functions) {
      const body = migration.slice(migration.indexOf(`function public.${name}`))
      expect(body.slice(0, body.indexOf('as $$'))).toMatch(/security definer[\s\S]*?set search_path = pg_catalog set row_security = off/i)
    }
    expect(migration).toMatch(/app_private\.has_permission\('employee\.create'/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.import'/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.submit'/i)
    expect(migration).toMatch(/app_private\.has_permission\('employee\.reject'/i)
  })

  it('keeps employee updates and compensation approval in the existing workflow', () => {
    expect(migration).toMatch(/'operation','CREATE'/i)
    expect(migration).toMatch(/review_status='SUBMITTED_FOR_APPROVAL'/i)
    expect(migration).toMatch(/employee_review_submission/i) // status synchronization is driven by that existing employee approval transition
    expect(migration).toMatch(/after update of approval_status on public\.employees/i)
    expect(migration).not.toMatch(/update public\.employee_compensation/i)
  })

  it('permits a scoped company assignment while the branch is unresolved but blocks readiness until branch selection', () => {
    expect(pendingBranchMigration).toMatch(/check \(branch_id is null or company_id is not null\)/i)
    expect(pendingBranchMigration).toMatch(/has_permission\('employee\.private\.view',p_portfolio_id,c\.id,null\)/i)
    expect(pendingBranchMigration).toMatch(/p_company_id is not null and p_branch_id is not null then v_status:='READY_FOR_APPROVAL'/i)
    expect(pendingBranchMigration).not.toMatch(/\bdrop\s+(table|schema)\b|\btruncate\b/i)
  })

  it('adds optional medical compensation without changing payroll calculations and enforces housing review server-side', () => {
    expect(allowanceMigration).toMatch(/add column medical_allowance numeric\(14,2\) check \(medical_allowance is null or medical_allowance >= 0\)/i)
    expect(allowanceMigration).toMatch(/employee_compensation_preserve_medical_allowance/i)
    expect(allowanceMigration).toMatch(/medical_allowance.*nullif\(p_compensation ->> 'medical_allowance'/is)
    expect(allowanceMigration).toMatch(/'medical_allowance',nullif\(v_data->>'medical_allowance'/i)
    expect(allowanceMigration).toMatch(/create trigger employee_import_allowance_guard/i)
    expect(allowanceMigration).toMatch(/resolve the housing allowance discrepancy before marking this record ready/i)
    expect(allowanceMigration).toMatch(/grant execute on function public\.employee_import_submit_staged[\s\S]*?to authenticated/i)
    expect(allowanceMigration).not.toMatch(/\b(drop|truncate)\s+(table|schema)\b/i)
    expect(allowanceMigration).not.toMatch(/insert into public\.(payroll_runs|payroll_items|payroll_input_items)/i)
  })

  it('validates active department membership server-side without preventing incomplete staging', () => {
    expect(departmentValidationMigration).toMatch(/create or replace function app_private\.employee_import_department_guard/i)
    expect(departmentValidationMigration).toMatch(/security definer[\s\S]*?set search_path = pg_catalog[\s\S]*?set row_security = off/i)
    expect(departmentValidationMigration).toMatch(/d\.company_id = new\.company_id[\s\S]*?d\.status = 'ACTIVE'[\s\S]*?lower\(btrim\(d\.name\)\) = lower\(v_department\)/i)
    expect(departmentValidationMigration).toMatch(/new\.review_status = 'READY_FOR_APPROVAL'[\s\S]*?raise exception/i)
    expect(departmentValidationMigration).toMatch(/new\.review_status := 'NEEDS_INFORMATION'/i)
    expect(departmentValidationMigration).toMatch(/create trigger employee_import_department_guard/i)
    expect(departmentValidationMigration).not.toMatch(/\b(drop|truncate)\s+(table|schema)\b/i)
    expect(departmentValidationMigration).not.toMatch(/insert into public\.(employees|employee_compensation|payroll_runs|payroll_items)/i)
  })

  it('keeps bulk approval within the authoritative per-employee permission, validation, and audit workflow', () => {
    expect(bulkApprovalMigration).toMatch(/perform public\.employee_review_submission\(v_id, p_decision/i)
    expect(bulkApprovalMigration).toMatch(/p_decision = 'REJECT' and nullif\(btrim\(p_reason\),''\) is null/i)
    expect(bulkApprovalMigration).toMatch(/grant execute on function public\.employee_review_submissions[\s\S]*?to authenticated/i)
    expect(bulkApprovalMigration).toMatch(/app_private\.has_permission\('employee\.import'/i)
    expect(bulkApprovalMigration).toMatch(/app_private\.has_permission\('employee\.private\.view'/i)
    expect(bulkApprovalMigration).toMatch(/revoke all on function public\.employee_approval_queue_summary/i)
    expect(bulkApprovalMigration).not.toMatch(/\b(drop|truncate)\s+(table|schema)\b/i)
    expect(bulkApprovalMigration).not.toMatch(/insert into public\.(payroll_runs|payroll_items|payroll_input_items)/i)
  })

  it('keeps final approval counts permission-scoped and the refinement forward-only', () => {
    expect(approvalSummaryScopeMigration).toMatch(/has_permission\('employee\.approve'/i)
    expect(approvalSummaryScopeMigration).toMatch(/has_permission\('employee\.reject'/i)
    expect(approvalSummaryScopeMigration).toMatch(/has_permission\('employee\.import'/i)
    expect(approvalSummaryScopeMigration).toMatch(/has_permission\('employee\.private\.view'/i)
    expect(approvalSummaryScopeMigration).toMatch(/revoke all on function public\.employee_approval_queue_summary\(uuid\) from public, anon/i)
    expect(approvalSummaryScopeMigration).not.toMatch(/\b(drop|truncate)\s+(table|schema)\b/i)
    expect(approvalSummaryScopeMigration).not.toMatch(/insert into public\.(employees|payroll_runs|payroll_items)/i)
  })
})
