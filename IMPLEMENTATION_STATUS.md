# Golden Baobab HR V2 implementation status

Updated: 28 October 2026  
Branch: `feature/supabase-auth`

## Current state

Eight company-first and HR/payroll migrations are applied to the explicitly authorized development Supabase project `golden-baobab-hr-v2` (ref `jssuaebiizjcoqmngxzk`). The latest rollback-only hosted smoke test covers company/branch isolation, employee onboarding review, K6,000 deduction scheduling and approval, attendance submission/return/correction/reapproval, paid-leave accrual/idempotency/balance debit, policy scope, and revoked-access behavior. Every fixture rolled back. The existing Auth user remains present. Company/branch CRUD, employee directory/onboarding/review, deduction workflows, monthly attendance, and leave request/policy workflows now use LIVE Supabase services; unconnected modules remain unavailable in LIVE mode rather than showing synthetic business records.

This is a development integration slice, not an operational payroll system. No employee, deduction, or payroll data is persisted after the smoke tests.

## Database completed

- Migrations `20261028000100` through `20261028000800` are applied and match remote history.
- Added company-first portfolio, company, branch, membership, and explicit platform-admin tables.
- Added employee/private-detail/compensation, attendance/leave, deduction/installment/ledger, payroll period/run/item, statutory-version, approval, and audit tables with composite tenant foreign keys and indexes.
- RLS is enabled on all 27 public business tables. Direct HR business writes are closed; attendance and leave mutations use SECURITY DEFINER RPCs with tenant, role, branch, transition, and review checks. `leave_balances` is a security-invoker aggregate over the RLS-protected leave ledger.
- Trusted RPCs cover employee draft creation/submission/review, deduction creation/review and schedule generation, attendance entry save/submit/review, leave policy save/accrual/request/review, payroll submit/review/finalize, and portfolio membership assignment/revocation.
- RPC catalog checks confirm `SECURITY DEFINER`, pinned `search_path=pg_catalog`, `row_security=off`, no `anon` execute, and `authenticated` execute where intended.
- Finalization requires a version-bound approval, approved employees, due/balance-valid deduction installments, and active/effective/verified Zambian PAYE, NAPSA, and NHIMA rule versions. It is not a usable payroll engine because trusted run creation/calculation and verified rules are not present.
- New Auth users receive a profile via trigger. The migration backfilled profiles with conflict-safe inserts.

## Development data and existing account

- Pre-migration check found zero application tables/rows and no remote migration history; Auth contained one user and one identity.
- The existing Auth account was preserved and not inspected for email/password/metadata. It now has a profile and `PORTFOLIO_ADMIN` access to a clearly named synthetic development portfolio.
- One synthetic company and branch are persistent for UI development. Their registration, TPIN, phone, email, contact, and address values are clearly demo placeholders.
- Current remote counts: 1 Auth user, 1 profile, 1 portfolio, 1 membership, 1 company, 1 branch, 0 employees, 0 deductions, 0 payroll runs, 0 attendance periods, 0 leave requests, and 0 leave ledger rows. Two temporary synthetic browser-test Auth accounts were removed after the Auth endpoint returned a schema-query error; no related memberships or data remain.
- No employee or payroll personal/financial data, emails, storage objects, or production data were created.

## Executed verification

- TypeScript check passed after LIVE attendance and leave route changes.
- Vitest: 74 tests across 23 files passed, including LIVE attendance and leave screens, LIVE deduction screens, and a projection test ensuring deduction employee labels use a non-private RLS-scoped query.
- Focused LIVE company adapter tests: 2 passed; they verify RLS-visible row mapping and no mock fallback on query failure.
- Oxlint completed with six existing warnings in legacy `App.tsx`, mock People Ops, and mock Payroll screens. No warnings remain in new LIVE attendance/leave files. There is no `lint` npm script; Oxlint was run directly.
- Production build passed after LIVE attendance and leave integration. Vite reports the main JavaScript chunk exceeds 500 kB.
- Supabase CLI reports migrations `20261028000100` through `20261028000800` aligned locally and remotely.
- Hosted PostgreSQL smoke test passed through the authenticated Supabase Management SQL API in one rollback-only transaction. It exercises database roles/JWT claims and trusted RPCs; it is not an HTTP Auth/PostgREST test.
- Post-test counts confirm fixtures rolled back and the existing Auth count remains one.
- Browser automation reached the LIVE login page, verified the Golden Baobab HR title, and confirmed unauthenticated `/companies` redirects to `/auth/login`. Browser console errors are now zero after adding a favicon.
- Browser sign-in and authenticated CRUD remain unverified. Playwright CLI package retrieval stalled under restricted network access; the native browser bridge timed out. Temporary SQL-created synthetic accounts received HTTP 500 (`Database error querying schema`) on Auth sign-in and were removed. The existing test login was not modified. Database role/RLS simulation is not equivalent to Auth/PostgREST browser testing.
- Latest Vercel Preview `dpl_HZyfAANTdPHd2PHLph6xGrQH8FgG` is `READY`: `https://golden-baobab-hr-v2-kdlkmxo7w-simon-mulengas-projects.vercel.app`. The uploaded source build used the `feature/supabase-auth` Preview environment. Protected Preview page was opened through Vercel's expiring share link; browser verified the Golden Baobab HR login, LIVE workflow notice, SPA fallback, unauthenticated `/companies` redirect to `/auth/login`, and zero console errors. Authenticated company CRUD and Supabase user flows remain unverified in-browser.
- No full payroll finalization or duplicate-posting test has run against hosted Supabase.

## Latest local verification checkpoint

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- --run --maxWorkers=1`: 74 tests passed across 23 files, including LIVE attendance and leave tests.
- `npm.cmd exec oxlint -- .`: completed with six legacy warnings; no new LIVE attendance/leave warnings.
- `npm.cmd run build`: passed; large-main-chunk warning remains.
- `git diff --check`: passed (Git reports expected LF-to-CRLF notices for several edited files).
- Hosted rollback-only synthetic smoke passed after migrations 007 and 008. Remote post-test counts match baseline.
- Browser smoke could not be run this increment: Playwright CLI fetch stalled and the native browser bridge timed out. No authenticated browser test is claimed.

## LIVE frontend coverage

- Company directory, company details, switcher, and branch views load records from Supabase under RLS.
- Company/branch forms call Supabase through `live-company-services`; branch removals are soft deactivation. This write path still needs authenticated browser verification.
- Employee directory reads use the RLS-filtered service with pagination and only non-private directory fields. LIVE onboarding calls the draft and submit RPCs with company, branch, personal, private, and compensation details; the form does not persist to local storage. LIVE employee review actions call the trusted review RPC and require a reason for return/rejection. Corrections/resubmission UI, employee profile/editing, and import remain unconnected.
- LIVE deductions list RLS-visible requests and persisted installments, create through `deduction_create_request`, and approve/reject through `deduction_review_request`. Only trusted payroll finalization can post repayments. The dashboard reports the real visible company count and clearly marks employee/payroll figures unavailable.
- LIVE attendance supports company/branch/month selection, approved employee paging, monthly schedule/worked/paid-leave/unpaid-leave/payable-absence entry, audited corrections, period submission, HR return, and approval. It uses `attendance_save_entry`, `attendance_submit_period`, and `attendance_review_period`; a submitter cannot review their own period.
- LIVE leave supports persistent requests, configurable effective-dated leave policies, ledger balances, explicit paid/unpaid classification, monthly accrual, approval/rejection, idempotent accrual, overlap prevention, and paid-balance validation. Policy management and accrual are limited to Portfolio Admin and Overall HR; branch managers remain branch-scoped. Leave accrual amounts are configurable assumptions, not legal guidance.
- Attendance/leave data are not yet consumed by a live payroll calculation. Payroll run creation, calculation, and finalization remain unavailable.
- Attendance, leave, payroll, statutory, users, audit, reports, notifications, and settings remain gated in LIVE mode until their UI operations are persistently connected. Deduction pause/resume, settlement, and reversal are not exposed yet.
- Existing mock workflows remain available in MOCK mode.

## Current employee LIVE integration increment

- Added LIVE employee directory pagination/search using RLS-filtered Supabase queries; the query omits date of birth, nationality, and private details.
- Added company/branch-bound onboarding that calls `employee_create_draft` then `employee_submit_for_hr_approval`, including personal fields, identity document type, emergency contact, statutory references, payment method details, and compensation components. The form data is not written to local storage. If submission fails after draft creation, the UI says the draft remains saved.
- Added LIVE review queue actions through `employee_review_submission`; return and rejection require a reason. Backend errors do not show success feedback.
- Four focused UI tests cover the LIVE employee directory, review query/action, rejection/error behavior, and onboarding payload. The final 68-test suite, typecheck, lint, and production build have been rerun after the form refinement and deductions integration.
- Added `supabase/.temp/` to `.gitignore` so local project linkage metadata is not staged. Removed the UTF-8 BOM from `vercel.json`; JSON parses successfully.
- Vercel project found through its connector; encrypted `VITE_DATA_MODE=LIVE`, project URL, and publishable key are Preview-only and branch-scoped to `feature/supabase-auth`. The latest uploaded-source Preview deployment is READY and browser-smoke-tested (deployment id above). An earlier dist-only API attempt failed because Vercel invoked the project Vite build without a package manifest; no production settings were changed.

## Remaining engineering work

1. Diagnose Auth provisioning and run authenticated PostgREST/browser tests; the temporary SQL-created accounts hit an Auth schema-query error and were removed.
2. Connect approved attendance and leave to trusted payroll inputs and the calculation/finalization workflow.
3. Complete employee correction/resubmission, profiles, compensation, and CSV/XLSX imports.
4. Complete live company/branch browser CRUD, role/branch assignment UI, trusted invitations, and role administration.
5. Implement deduction pause/resume/settlement/reversal and ledger correction workflows.
6. Build trusted payroll run creation/calculation, version-bound approvals, finalization, payslips, and duplicate-posting tests.
7. Verify NAPSA/NHIMA bases, rates, ceilings, and exemptions against authoritative sources before allowing real payroll finalization.
8. Implement private documents/payslips, PDF generation, authorized email, reports/exports, audit UI, and settings.
9. Run authenticated RLS/PostgREST integration, browser acceptance, and performance testing above 2,500 employees.
10. READY Preview for commit `f1dee366d45474c57d109c1f82d656c63b807053` has HTTP login-route smoke verification; authenticated browser testing remains outstanding.

## Git and deployment

The previous workspace checkpoint was `54b3c49ad22dccfe5e7cab33ba6f2ba0adb1252e`. Attendance/leave source changes were preserved through the authorized GitHub connector as `781c2a39c4a07ef089cfab790d93a79c0521ad42`; the Vercel source-transfer truncation defect was corrected with `f1dee366d45474c57d109c1f82d656c63b807053`. Local `.git` remains read-only; no lock bypass or direct local Git write was attempted. No force push, merge, production deployment, or production database operation was attempted.

## 28 October 2026 connector repair checkpoint

- The existing local source changes were preserved on `feature/supabase-auth` through the authorized GitHub connector. Commit `781c2a39c4a07ef089cfab790d93a79c0521ad42` contains the verified 74-test attendance/leave increment. No local Git writes, lock bypass, force update, or production action was used.
- The first automatic Preview for that commit failed because source transfer inserted output-truncation text into `src/features/employees/EmployeeScreens.tsx`. Replaced only that remote file with the exact complete local bytes through the GitHub blob/tree APIs; repair commit `f1dee366d45474c57d109c1f82d656c63b807053` advanced the feature branch normally.
- Vercel Preview deployment `dpl_BAEF3wb5NDDUg42k6ETmKaWw2Y4U` is READY at `https://golden-baobab-hr-v2-rdndub5yv-simon-mulengas-projects.vercel.app`. The protected `/auth/login` request returned HTTP 200 and the Golden Baobab HR document title. This is an HTTP smoke check, not authenticated browser/CRUD verification.
- Re-ran TypeScript via `npm.cmd run build` (includes `tsc -b`) successfully; `npm.cmd test -- --run --maxWorkers=1 --reporter=dot` passed all 74 tests across 23 files. Vite still reports the ~909 kB main chunk warning. Authenticated Playwright testing remains blocked by unavailable browser tooling and the earlier Auth test-account schema-query failure.
- The live attendance/leave database workflows remain persistent and hosted rollback tests pass. Payroll still has no trusted run-creation/calculation operation; attendance and leave are not yet payroll inputs, and statutory verification/finalization remain blocked.
- No credentials, local environment files, Supabase linkage metadata, local Git metadata, or browser artifacts were added to the connector commits.
## 28 October 2026 payroll-input increment

- Added database migration `20261028000900` with permission-checked, read-only `payroll_preview_inputs`; migration `20261028001000` minimizes returned leave/deduction detail. Both are applied to the authorized development Supabase project and migration history aligns through 010.
- The RPC requires `payroll.prepare` for the requested company/branch and an HR-approved attendance period matching the exact dates. It returns approved employees, effective compensation, approved attendance, approved leave-period evidence, and active due installments. It performs no calculation or writes. Attendance day totals remain the payroll adjustment source to prevent double-counting leave; health-sensitive leave type and deduction reason are omitted from the returned snapshot.
- LIVE `/payroll` now displays an input-preview screen and uses the RPC. It clearly indicates that no payroll calculation/run/approval/finalization occurs. A branch manager without `payroll.prepare` is denied by the hosted smoke assertion.
- Hosted rollback-only smoke test passed after migration 010, including a synthetic K6,000 employee with approved attendance and compensation and the negative branch-manager permission case. All test fixtures are rolled back. Migration history and original test account/data counts are unchanged from the prior baseline except for the two migration records.
- Local verification: TypeScript check passed; 76 tests across 24 files passed; production build passed; Oxlint completed with the six existing legacy warnings. Browser authenticated role workflows remain outstanding.
## 28 October 2026 persistent payroll draft increment

- Added migration `20261028001100_payroll_draft_creation.sql` to the authorized development project after checking linked migration history and a dry run. It adds an exact-period uniqueness index and `payroll_create_draft`, a SECURITY DEFINER function pinned to `pg_catalog`, with explicit `payroll.prepare` permission and approved-attendance checks.
- Draft creation is idempotent by period/run uniqueness and locks the period/run rows; repeated calls return the existing run. The function creates an audit event and no payroll items or repayment transactions.
- LIVE payroll input preview now offers persistent draft creation and reports the saved run ID. It disables draft creation if any approved employee input is missing compensation/attendance. No calculation, submission, approval, finalization, or payment processing is implied.
- Hosted rollback-only synthetic smoke passed the preview snapshot, exact-period DRAFT creation, idempotent retry, no-item assertion, and branch-manager denial. All records rolled back.
- TypeScript passed; the full 76-test suite passed across 24 files; Oxlint completed with six existing legacy warnings; production build passed. The latest Vercel Preview for this draft increment is not yet verified.