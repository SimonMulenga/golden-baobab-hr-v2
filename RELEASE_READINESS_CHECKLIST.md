# Release Readiness Checklist

> Historical baseline: this checklist predates the current migration-053 deployment and final QA pass. Use [`docs/handover/HANDOVER_CHECKLIST.md`](docs/handover/HANDOVER_CHECKLIST.md) for the current release gates.

**Decision: NO-GO for client handover and production deployment as of 1 November 2026.** Migration 049 is active on development; the remaining gates are listed below.

## Repository and build

- [x] Branch, HEAD, upstream and production deployment inspected.
- [x] Full Vitest suite: 268 passed / 0 failed / 0 skipped (59 files, one worker).
- [x] TypeScript check passed.
- [x] Production build passed; large-chunk warning remains.
- [x] `git diff --check` passed.
- [ ] Review and commit only approved files; exclude the supplied original employee workbook.
- [ ] Push a reviewed commit to the existing feature branch and verify Vercel preview.

## Database and recovery

- [x] Linked development project verified: `jssuaebiizjcoqmngxzk` (`golden-baobab-hr-v2`, PostgreSQL 17.11).
- [x] Remote migration history verified through 049.
- [x] Migration 049 applied using the supported linked Supabase workflow; post-apply structural checks passed.
- [x] Fresh pre-049 archive checksum, TOC and isolated PostgreSQL 18 restore verified.
- [ ] Verify recoverable EFS encryption key and full Supabase-managed recovery requirements.
- [ ] Configure external encrypted backups outside public GitHub and verify scheduled restore drills.
- [ ] Confirm future Storage-object backup and Supabase Auth/Vault/project configuration recovery procedures.

## Payroll and statutory rules

- [x] PAYE bands cross-checked against ZRA information.
- [x] NAPSA 2026 year-specific ceiling/cap cross-checked; contribution deadline is the 10th of the following month.
- [x] NHIMA 1% employee + 1% employer basic-salary base verified against SI 63 of 2019, Third Schedule; current NHIMA FAQ inconsistency documented.
- [x] K5,000, K6,500 and K12,500 NHIMA calculation/payslip tests passed; rollback-only development SQL verified the effective-dated 1%/1% basic-salary rule.
- [ ] Complete signed-in synthetic payroll lifecycle tests before client payroll use.

## Authorization and workflows

- [x] Migration 049 structural checks: permission catalog mapping, grants, RLS coverage, last-admin guards and payroll self-review guard.
- [ ] Test both administrator roles with separate authenticated sessions on identical authorized resources.
- [ ] Verify cross-company and branch denial, account changes, invitation delivery, Storage access and revocation with real scoped test sessions.
- [ ] Complete signed-in company, employee/import, attendance, leave, payroll draft/review/approval, payslip and report workflows using synthetic data.
- [ ] Perform desktop and mobile browser smoke tests for administrator, HR and branch-manager navigation.

## Deployment and handover

- [x] Existing production alias and deployed commit identified (`d1c32c9`).
- [ ] Confirm Vercel production environment points to the intended project without printing secret values.
- [ ] Push only after all release gates pass; verify preview build and critical workflows.
- [ ] Promote/deploy to production only after payroll regression, recovery and authenticated QA gates pass.
- [ ] Complete client-specific accounts, sender configuration, backup arrangements and training.
