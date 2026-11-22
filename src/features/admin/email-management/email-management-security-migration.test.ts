import { describe, expect, it } from 'vitest'
import migration from '../../../../supabase/migrations/20261122006600_email_management_diagnostic_status.sql?raw'
import diagnosticMigration from '../../../../supabase/migrations/20261122006500_one_time_resend_diagnostic.sql?raw'
import config from '../../../../supabase/config.toml?raw'

describe('owner-only email management backend contract', () => {
  it('keeps diagnostic claim and status rows inaccessible to ordinary API roles', () => {
    expect(diagnosticMigration).toMatch(/alter table public\.payslip_resend_diagnostic_claims enable row level security/i)
    expect(diagnosticMigration).toMatch(/revoke all on public\.payslip_resend_diagnostic_claims from public, anon, authenticated/i)
    expect(migration).toMatch(/alter table public\.payslip_resend_diagnostic_status enable row level security/i)
    expect(migration).toMatch(/revoke all on public\.payslip_resend_diagnostic_status from public, anon, authenticated/i)
    expect(migration).not.toMatch(/grant (?:select|insert|update|delete|all).*payslip_resend_diagnostic_status.*to authenticated/i)
  })

  it('restricts atomic claim, result, and webhook status RPCs to the service role', () => {
    for (const fn of ['claim_once', 'record_result', 'apply_event']) {
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.payslip_resend_diagnostic_${fn}\\(`, 'i'))
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.payslip_resend_diagnostic_${fn}\\([^;]+ to service_role`, 'i'))
    }
    expect(migration).toMatch(/auth\.role\(\) <> 'service_role'/i)
    expect(migration).toMatch(/revoked_at is null/i)
    expect(migration).toMatch(/p_provider_event_id.*p_provider_message_id.*p_event_type/s)
  })

  it('keeps browser JWT validation enabled for admin functions and disabled only for the signed webhook', () => {
    expect(config).toMatch(/\[functions\.payslip-resend-diagnostic\][\s\S]*?verify_jwt = true/i)
    expect(config).toMatch(/\[functions\.payslip-email-admin-status\][\s\S]*?verify_jwt = true/i)
    expect(config).toMatch(/\[functions\.resend-payslip-webhook\][\s\S]*?verify_jwt = false/i)
  })

  it('does not add employee, payroll, or payslip row mutations to the admin status migration', () => {
    expect(migration).not.toMatch(/\b(?:insert into|update|delete from) public\.(?:employees|payroll_runs|payroll_items|payslip_documents|payslip_email_deliveries)\b/i)
  })
})
