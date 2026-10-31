# Golden Baobab HR V2 — Final Development Report

**Assessment date:** 1 November 2026
**Repository:** `C:\Project\golden-baobab`
**Branch:** `feature/supabase-auth-synced`
**Development Supabase project:** `jssuaebiizjcoqmngxzk`

## Release decision

**NO-GO for client handover and production deployment.** Migration 049 is applied to the authorized development project, its database-level structural checks passed, and local automated checks pass. Release remains blocked by missing authenticated end-to-end authorization tests. The current Vercel production deployment was not changed.

## Repository and deployment state

- Local HEAD: `d1c32c9b81ee42dcd291cbfcaebc3be7b8c49b05` on `feature/supabase-auth-synced`; configured upstream is `origin/feature/supabase-auth`.
- The tracked application edits, migration 049, migration tests and seven handover documents remain uncommitted. The supplied original workbook is untracked and must stay out of Git.
- The latest Vercel production deployment inspected is commit `d1c32c9` on `feature/supabase-auth`; no new build, deployment, alias change or production configuration change was made.
- Development project identity verified as `golden-baobab-hr-v2`, PostgreSQL 17.11, ref `jssuaebiizjcoqmngxzk`.

## Migration 049

`20261031004900_unified_administrator_capabilities.sql` was applied to the existing development project after migration history through 048, a successful dry run, and a fresh backup. The supported Supabase migration command applied only 049. Remote history now includes version 049.

Post-apply read-only checks confirmed the administrator permission mapping, authenticated execute grants, no anonymous execute grant, security-definer RPC status, both last-administrator guards, retained payroll self-review protection, retained leave carry-forward behavior, and RLS enabled on all 52 public tables. No memberships or business records were changed. Company/branch count and payroll/audit aggregates matched the pre-migration baseline.

## Backup and restore evidence

- Pre-migration archive: `%LOCALAPPDATA%\GoldenBaobab\database-backups\gbhr-dev-20261031-234707.dump`.
- Size: 1,202,084 bytes; `pg_restore --list`: 1,469 entries; SHA-256: `8CBCB91B7CCAEFBCD7BF800B00F9F71A5E3646AF634B7A43647B24C2868368B7`.
- PostgreSQL 17.11 source; the archive restored into an isolated PostgreSQL 18 environment. Application, Auth and Storage metadata schemas restored, and representative schema/migration checks passed.
- The restore is **partial Supabase recovery evidence**, not a complete project recovery. It excludes Supabase-managed credentials/roles, Vault secrets, Auth provider/project settings, Edge Function deployment settings, and Storage object bytes. At backup time the project had 3 buckets and 0 Storage objects. The local Windows backup directory was EFS-encrypted and archive attributes checked; EFS key export/recovery was not verified.
- The archive reflected migration 048 and was made immediately before applying 049. No external encrypted backup workflow is operational. The public GitHub repository must not be used to store backup artifacts.

## Verification results

- Full Vitest: 268 passed, 0 failed, 0 skipped across 59 files, one worker.
- Current NHIMA/payroll verification: 89 payroll tests passed across 18 files; the database rollback-only payroll rule test passed for the K5,000, K6,500 and K12,500 cases.
- Focused admin/business tests: 36 passed; migration 049 contract tests: 6 passed.
- TypeScript check and Vite production build passed. Vite reports a non-blocking large-chunk warning.
- Local PostgreSQL 18 restore validation through 049 passed, including unchanged pre-existing aggregates and audit fingerprint.
- Remote migration 049 post-apply read-only structural/security checks passed.
- Authenticated Supabase/PostgREST role tests and browser E2E were **not run**. The project currently has one Auth user, no companies/branches, and no authenticated browser session available. No QA identities or business data were created.

## Functional and statutory readiness

- The app has extensive implemented workflows and automated coverage; this does not establish that every workflow has passed signed-in live integration testing.
- PAYE bands are consistent with current ZRA 2026 information. NAPSA's year-specific 2026 notice supports the stored K37,236 ceiling and K1,861.80 per-party cap, with 5% each side; its remittance deadline is the 10th of the following month.
- NHIMA is configured at 1% employee plus 1% employer on formal-sector basic salary under SI 63 of 2019, Third Schedule. This excludes allowances from the NHIMA base. The current NHIMA FAQ wording for employee “declared income” conflicts with the statutory schedule; monitor for a later Gazette amendment or authoritative filing instruction. Unit and rollback-only PostgreSQL tests pass for K5,000, K6,500 and K12,500 basic salaries.
- No real payroll was calculated or finalized. External payment transfers and statutory submissions are not connected.

## Remaining release blockers

1. Run the NHIMA regression and payroll test suites and verify the active effective-dated database rule matches the tested 1% / 1% basic-salary basis.
2. Provision controlled QA identities/memberships through authorized workflows and execute signed-in administrator parity, company/branch isolation, Storage, invitation, and HR/payroll browser tests.
3. Establish an owner-recoverable encrypted backup process outside public GitHub; verify key recovery and the required Supabase-managed recovery scope.
4. Review and commit the worktree, push to the existing feature branch, build a Vercel preview, verify it, and only then schedule production release after blockers pass.

No production deployment is recommended until these gates pass.
