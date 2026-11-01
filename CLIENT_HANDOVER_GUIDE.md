# Client Handover Guide

## Current status

**Do not begin production handover yet.** Database migrations 049 and 050 are active on the authorized development Supabase project. Migration 050 fixes portfolio-wide Overall HR employee reviews and adds audited user-assignment lifecycle RPCs. Local tests and build pass, but authenticated post-migration browser verification and the new application deployment are still pending.

## Release gates

1. Obtain written NHIMA confirmation of the 2026 formal-sector employee contribution base and allowance treatment; see `PAYROLL_VALIDATION_REPORT.md`.
2. Provision controlled QA accounts through the supported administrator process and verify role parity, company/branch isolation, Storage access, and the complete HR/payroll workflow with authenticated sessions.
3. Establish a recoverable encrypted backup process outside the public GitHub repository. The existing local archive restored application, Auth and Storage metadata into isolated PostgreSQL, but it is not a complete Supabase project restore. Preserve and test EFS key recovery if relying on that local copy.
4. Keep the original employee workbook out of Git, commit and push the reviewed application changes to the configured feature branch, then verify the preview build and critical flows.
5. Promote to production only after statutory, recovery and signed-in QA gates pass.

## Administrator and company setup after release

- Verify the authorized initial administrator's Auth identity and assign access only through the audited bootstrap/admin workflow.
- Create a company profile and private logo, then add branches.
- Add HR and Branch Manager accounts with the least required role and exact company/branch assignments.
- Verify each user's permitted company and branch context after sign-in; do not rely on navigation visibility alone.
- Import a sanitized employee workbook: map columns, preview, resolve row-level issues, validate branch scope, then explicitly confirm the import.

## Operating workflow

1. Review approved employees, employment details, effective-dated compensation and private-field access.
2. Record attendance, leave, approved deductions and earnings for the period; resolve missing-input warnings.
3. Create a payroll draft and inspect calculation details and statutory rule versions.
4. Submit for an independent reviewer; confirm the submitter cannot approve their own run.
5. Generate payslips and reports only after approved release steps.

Do not finalize production payroll until NHIMA rules have been confirmed and signed-in testing passes. Payment transfers and statutory submissions are not connected.

## Training checklist

- Sign-in, account activation and recovery.
- Company/branch selection and role-specific access.
- Employee onboarding, bulk import, approvals and private documents.
- Monthly attendance entry/correction and audit history.
- Leave requests, balances, policy and reconciliation.
- Payroll preparation warnings, review, independent approval and payslips.
- Reports, exports, audit logs, account revocation and support escalation.
