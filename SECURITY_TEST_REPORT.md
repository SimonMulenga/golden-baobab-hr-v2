# Security Test Report

**Scope:** local source/tests, migration 049 contract tests, isolated PostgreSQL 18 restore, and read-only post-migration checks on development project `jssuaebiizjcoqmngxzk`. No production testing, invitations, payments, statutory filings, or payroll finalization occurred.

## Completed checks

- Full local Vitest suite: 268 passed, 0 failed, 0 skipped (59 files, one worker).
- Focused administrator/service tests: 36 passed; migration 049 contract tests: 6 passed.
- TypeScript and production build passed.
- Migration 049 applied to development via the linked Supabase migration workflow. Remote history now includes version 049.
- Post-apply read-only checks confirmed: administrator permission mapping exists; checked authenticated RPC execute grant is present and anonymous execute is absent; last-active-admin guards exist; payroll self-review guard remains; leave carry-forward behavior remains; RLS is enabled on all 52 public tables.
- Pre/post company, branch, employee, compensation, attendance, leave and payroll aggregates matched (all zero at backup/check time); audit count remained one. Storage had 3 bucket metadata rows and 0 object rows.
- Local isolated PostgreSQL restore through migrations 048 and 049 passed schema, role-grant simulation, preservation and audit-fingerprint checks.

## Not tested

- No signed-in PostgREST/RLS tests for the portfolio or company administrator identities.
- No cross-portfolio/company denial test using real Auth sessions; no branch-manager scope test.
- No live Storage authorization attempt or storage-byte restore (there were no objects at backup time).
- No account invitation/email delivery, session recovery, password reset, or account revocation timing test.
- No authenticated browser E2E or desktop/mobile visual pass. Browser tooling was unavailable in this run.
- Current Vercel environment values were not inspected because available tools could not provide names-only results safely.

## Security posture and release gates

- Migration 049 shares administrator capability mappings while retaining membership/resource scope and RLS. It adds last-administrator guards and does not grant service-role access to the frontend.
- UI visibility is not an authorization boundary; trusted RPC checks and RLS remain authoritative.
- The archive was EFS-encrypted on the local workstation, but EFS key recovery/export and full Supabase-managed restoration are not verified. No external automated backup is operating.
- The source repository is public; do not upload employee/payroll backup artifacts to GitHub Actions artifacts or repository storage.
- Because signed-in tenant/branch behavior remains unverified and the NHIMA FAQ wording conflicts with the Gazette schedule, security and production acceptance are incomplete. The implementation uses SI 63's basic-salary base; test that effective configuration before release.
