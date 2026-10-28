# Golden Baobab HR V2 implementation status

## Payroll trial calculation increment (28 October 2026)

- Added and applied forward-only migration `20261028001500_payroll_trial_calculation.sql` to the verified development project. It adds an RLS-protected, append-only-by-application trial snapshot table and the `payroll_calculate_trial` SECURITY DEFINER RPC. It reads authorized approved inputs, derives numeric candidate breakdowns in PostgreSQL, stores an idempotent snapshot, and writes an audit event. It never creates `payroll_run_items`, changes run state, posts deduction transactions, or enables submission/approval/finalization.
- LIVE Payroll now creates/returns a draft and can calculate/recalculate a persisted trial snapshot. The screen displays gross, PAYE, NAPSA/NHIMA candidate values, due approved deductions, candidate net, employee blockers and global blockers. NAPSA/NHIMA numbers are clearly unverified candidates; non-monthly inputs, missing/ambiguous compensation/attendance, unpaid-leave formulas and overtime inputs surface blockers.
- Hosted rollback smoke was extended to assert the K6,000 synthetic salary candidate breakdown, scoped authorization denial, same-key idempotency, snapshot single-write behavior, unchanged DRAFT status, zero payroll items and no posted repayments. First assertion run exposed an employee-ordering assumption; the test was corrected to select by synthetic employee number. The rerun passed. Post-test counts: 1 existing Auth user, 0 smoke companies, 0 persisted trial snapshots.
- Catalog verification confirms RLS enabled, `anon` has no SELECT/EXECUTE, authenticated SELECT is gated by `payroll.view`, and the calculator is SECURITY DEFINER with `search_path=pg_catalog` and `row_security=off`.
- Finalizable payroll is not operational: trial snapshots are non-payable; NAPSA 2026 application details and NHIMA base are unresolved; overtime/bonus/commission and unpaid-leave calculation inputs/rules are incomplete; no verified net-pay line items, submit/review/approval/finalization, or repayment posting are exposed. The existing finalization gate remains unchanged.
- Local verification passed: typecheck; full Vitest 99 tests / 26 files on the standalone rerun; changed payroll/service files lint clean (two existing warnings remain in mock `PayrollScreens.tsx`); production build passed with the existing ~910 kB bundle advisory. The first concurrent test/build run had a Vitest worker-start timeout, resolved by running the suite alone.
- Commit `2674980dc260f60af17f33289a403c9e270e3bc7` is on `feature/supabase-auth`; Vercel Preview is READY at `https://golden-baobab-hr-v2-ccahqqgts-simon-mulengas-projects.vercel.app`. `/auth/login` and `/payroll` returned HTTP 200. This is an HTTP route smoke check, not authenticated browser testing.
- No production changes, invitation emails, or real payroll data were used.

Updated: 28 October 2026

## 28 October 2026 statutory/payroll review increment

- Created `ZAMBIA_STATUTORY_RULES_2026.md` with official source links and an explicit verification state. ZRA's 2026 ordinary PAYE bands, taxable-emoluments guidance, pension-contribution treatment and K15,000 example are confirmed from ZRA. NAPSA publishes 5% employee + 5% employer and a K28,920.30 ceiling, but Act 72/SI 62 of 2026 changed the legal framework during the year and the current published ceiling/threshold/basis was not reconciled against the new instruments. NHIMA publishes 1% per side but its official FAQ conflicts on employee/employer contribution bases. These unresolved rules remain blockers for production payroll finalization.
- Updated `ZAMBIA_PAYROLL_SPEC.md` and `BACKEND_SETUP.md` to reflect the verification and to avoid describing the existing illustrative client helper as an authoritative or live payroll calculator.
- Changed the existing illustrative PAYE helper to use integer-cent and basis-point arithmetic (no floating-point percentage arithmetic). Added ordinary band checkpoints and rounding tests. This helper remains client-side, configurable/illustrative, and always prohibits production finalization; it does **not** satisfy the trusted server calculation requirement.
- Validation: `npm.cmd run typecheck` passed; full Vitest passed (98 tests / 26 files); full Oxlint completed with six existing warnings in legacy `App.tsx`, mock People Ops, and mock Payroll screens; production build passed with the existing ~910 kB entry-chunk advisory. Payroll helper tests include K4,500, K5,500, K6,500, K7,100, K9,200, K12,500, K25,000 and cent rounding.
- Source scan found no credential values or service-role key literals in published files; the service-role variable name appears only in server-side Edge Function environment access and validation/documentation. `.env*` and `supabase/.temp/` are ignored; neither was included in the commit.
- Commit `aa031c1bab4de7aeb6930a54532cf0bb3f59f4cd` was created and advanced `feature/supabase-auth` normally through the GitHub connector from `c23608b6`; no force update or local `.git` write was used. Vercel Preview `dpl_BG8y9Zjg8c8ps3XED7k19JLNX1hK` is READY for that commit at `https://golden-baobab-hr-v2-1ii4pm3ki-simon-mulengas-projects.vercel.app`; `/auth/login` and `/payroll` both return HTTP 200 and the branded SPA document.
- Browser automation remains unverified: the Playwright wrapper fails because WSL has no `/bin/bash`; the CUA surface timed out. No authenticated login/CRUD/browser workflow is claimed. No dedicated synthetic browser account or password was used.
- No migration was added or applied, no remote schema/data changed, and no finalization gate changed in this increment. Production and main were untouched. The statutory blockers above remain; an authoritative trusted database calculation engine and persistently calculated payroll items are still unfinished.

Updated: 28 October 2026

## Latest checkpoint - invitations, branch-role administration, and spreadsheet import (28 October 2026)

- Added and applied forward-only migration `20261028001400_membership_directory_and_branch_roles.sql` to the authorized development project. A fresh `supabase migration list --linked` confirmed local and hosted history align through 014.
- Deployed the `invite-user` Supabase Edge Function with JWT verification enabled. It verifies the caller, checks the scoped invitation authorization RPC, uses a fixed same-origin `/auth/activate` redirect, and assigns only the requested authorized role. The server origin allowlist is currently restricted to `http://localhost:5173`. No invitation email was sent; Supabase Auth's allowed redirect URL for `/auth/activate` still needs confirmation before sending invitations.
- LIVE Users & Permissions now lists authorized portfolio memberships and supports invitations plus assignment, branch-scope replacement, and revocation for Portfolio Administrator, Overall HR Manager, Branch Manager, and Payroll Processor. Company Administrator management remains available. Database RPCs enforce role/scope restrictions and audit assignment changes.
- Added an authenticated invitation activation screen that requires a valid Supabase invitation session, validates password confirmation, updates the password through Supabase Auth, and signs out to the login screen.
- Added browser-local CSV/XLSX parsing, flexible header mapping, local validation/preview, company/workplace-branch selection, and bounded 20-row persistence submissions through employee draft and HR submission RPCs. Spreadsheet files are not uploaded. Row outcomes distinguish HR-submitted records, saved drafts, and failures.
- Added activation and role-administration tests and import mapping tests. Full Vitest: 89 tests across 26 files passed. TypeScript check and production build passed. Build retains the existing large-entry-chunk advisory. Targeted live user/import/service tests passed (11/11); auth-screen tests passed (5/5).
- Browser automation could not be completed: the Playwright wrapper depends on WSL bash unavailable in this Windows host; Node browser runtime discovery timed out; CUA browser surface timed out. No authenticated browser test is claimed. The existing test-account password was not accessed, and no synthetic account or invitation email was created.
- Payroll remains preview/draft only. The hosted schema has submission/review/finalization transition RPCs but has no trusted calculation operation that persists payroll line items. No calculated payroll or approval workflow was executed. Finalization remains blocked pending complete server-side rule computation and effective-dated statutory configuration verification.
- Latest Vercel Preview still serves the previous remote commit and does not contain these uncommitted local changes. No commit, push, Vercel deployment, production change, or email delivery was performed.

Updated: 28 October 2026  
Branch: `feature/supabase-auth-synced` (tracks `feature/supabase-auth`; local Git metadata is read-only in this session)

## Latest checkpoint - company admin access and employee employment status

- Reviewed and applied forward-only migration `20261028001300_company_admin_and_employment_status.sql` to the authorized development project `jssuaebiizjcoqmngxzk`. Migration history is aligned through 013.
- Hosted rollback-only smoke passed with company-admin isolation, scoped `users.manage`, denial of self-assignment and portfolio-role escalation, employment status transitions/history, and exclusion of suspended employees from payroll input previews. Post-test counts remain 1 Auth user, 1 synthetic company, 0 company-admin memberships, 0 employees, and 0 employment-history events. Existing user and company were preserved.
- LIVE `/users` now lists and assigns/revokes company-scoped `COMPANY_ADMIN` memberships through audited RPCs. The target account must already be activated. This UI does not send invitations and cannot grant portfolio, HR, payroll, or platform roles; branch-manager assignment remains separate.
- LIVE employee profiles now show employment status and status history. Authorized status changes require a reason and call `employee_set_employment_status`; termination is terminal in this workflow. The payroll input RPC excludes suspended and terminated employees.
- Full Vitest: 84 tests across 25 files passed; focused regression rerun: 15/15 passed. `npm.cmd run typecheck` passed. Updated LIVE files pass Oxlint. Production build passed with the existing ~910 kB entry-chunk advisory.
- Browser automation could not run in this Windows session: the prescribed Playwright wrapper cannot launch because WSL has no `/bin/bash`, and the native browser bridge timed out. Direct installed headless-browser attempts did not return rendered DOM. No authenticated browser test is claimed; hosted rollback SQL is PostgreSQL/JWT-role simulation, not HTTP Auth/PostgREST proof.
- No invitation email, database reset, production change, commit, push, or deployment was performed. Local `.git` remains read-only.

## Latest verified increment - employee corrections and profile history

- Added migration `20261028001200_employee_corrections.sql`, reviewed and applied to the authorized development project `jssuaebiizjcoqmngxzk`. It adds creator-scoped, audited RPCs to retrieve and update only DRAFT or HR-returned employee records and allows a `CORRECTED` approval-history event. It does not modify company assignment or approval state.
- Hosted preflight verified the project ref, migration history through 011, one existing Auth user, and zero employee, private-detail, compensation, attendance, leave, deduction, or payroll records. Migration 012 is now aligned locally/remotely. Post-smoke counts remain at the same baseline; no persistent synthetic fixtures remain.
- LIVE employee directory links authorized users to an RLS-filtered profile and approval timeline, and links creators to edit drafts or correct/resubmit returned submissions. The correction form fetches private details only through the creator-authorized audited RPC, keeps branch/company assignment fixed, saves through a transaction-backed RPC, then invokes the existing submit workflow. If resubmission fails after save, the UI explicitly says corrections were saved but not resubmitted. Unauthorized load errors hide the sensitive form. Profile queries exclude private identifiers, bank fields, salary and compensation.
- Added correction service methods and UI tests for private-field hydration, compensation correction, trusted resubmission and denied access; added profile/timeline RLS-scoped tests and verification that sensitive fields are not selected. The hosted rollback-only synthetic RLS workflow now covers other-portfolio denial, creator-scoped private data, correction, audit/history, resubmission and HR approval.
- `npm.cmd run typecheck` passed. Full Vitest: 80 tests across 24 files passed. Production build passed. Oxlint completed before the profile effect was refined; that newly identified set-state-in-effect warning has since been removed. Six existing legacy warnings remain. Existing ~910 kB entry-chunk advisory remains.
- Hosted `synthetic_rollback_smoke.sql` passed through linked Supabase Management SQL query; all fixtures rolled back. This is database-role/JWT-claim simulation, not HTTP Auth/PostgREST or authenticated-browser proof. Authenticated browser login, invitations, company/branch role administration and persistence after browser refresh remain unverified.
- LIVE global notices and dashboard labels now accurately distinguish connected HR services and payroll draft-only support from gated payroll calculation/finalization and reports.
- No commit, push, merge, Vercel deployment, production operation or email was performed. Existing backup branch and stash were not touched.

### Stage 1 gaps still open

- Company-scoped `COMPANY_ADMIN` membership and audited assignment/revocation are implemented in migration 013. Migration 014 and the local LIVE UI now cover invitations, account activation, portfolio membership directory, and branch-role assignment/replacement/revocation; hosted email delivery and authenticated browser validation remain unverified.
- Employment status is separate from onboarding approval and is now persisted with audited transitions. Retirement eligibility is still an independent configured field; no statutory contribution exemption is inferred from age.
- CSV/XLSX import is implemented locally in the LIVE route, but no authenticated import run has been executed against persistent employee records. Employee document storage and authenticated Auth/PostgREST/browser CRUD remain incomplete. Browser execution is unavailable in the current host; a dedicated synthetic test account/mailbox is needed for authenticated session and email-flow verification.
- Attendance and leave persistence/approval are hosted-smoke-tested, but the Stage 1 integration did not perform an authenticated browser reload check. Payroll remains input preview/draft only; calculation, review, approval and finalization are disabled.

## Current state

Fourteen company-first and HR/payroll migrations are applied to the explicitly authorized development Supabase project `golden-baobab-hr-v2` (ref `jssuaebiizjcoqmngxzk`). The latest rollback-only hosted smoke test also covers company/branch isolation, employee onboarding review/correction/resubmission, K6,000 deduction scheduling and approval, attendance submission/return/correction/reapproval, paid-leave accrual/idempotency/balance debit, policy scope, revoked access, branch-role replacement, and invitation authorization. Every fixture rolled back. The existing Auth user remains present. Company/branch CRUD, employee directory/onboarding/review/corrections/profile history, deduction workflows, monthly attendance, leave request/policy workflows, membership administration, and payroll input/draft creation use LIVE Supabase services; unconnected modules remain unavailable in LIVE mode rather than showing synthetic business records.

This is a development integration slice, not an operational payroll system. No employee, deduction, or payroll data is persisted after the smoke tests.

## Database completed

- Migrations `20261028000100` through `20261028001300` are applied and match remote history.
- Migration `20261028001200` adds creator-scoped audited RPCs for returned/draft employee corrections and private-field hydration, plus the `CORRECTED` approval-history action.
- Added company-first portfolio, company, branch, membership, and explicit platform-admin tables.
- Added employee/private-detail/compensation, attendance/leave, deduction/installment/ledger, payroll period/run/item, statutory-version, approval, and audit tables with composite tenant foreign keys and indexes.
- RLS is enabled on all 27 public business tables. Direct HR business writes are closed; attendance and leave mutations use SECURITY DEFINER RPCs with tenant, role, branch, transition, and review checks. `leave_balances` is a security-invoker aggregate over the RLS-protected leave ledger.
- Trusted RPCs cover employee draft creation/submission/review, deduction creation/review and schedule generation, attendance entry save/submit/review, leave policy save/accrual/request/review, payroll submit/review/finalize, and portfolio membership assignment/revocation.
- RPC catalog checks confirm `SECURITY DEFINER`, pinned `search_path=pg_catalog`, `row_security=off`, no `anon` execute, and `authenticated` execute where intended.
- Finalization requires a version-bound approval, approved employees, due/balance-valid deduction installments, and active/effective/verified Zambian PAYE, NAPSA, and NHIMA rule versions. It is not a usable payroll engine because trusted payroll calculation and verified effective statutory rules are not present; idempotent draft creation is available.
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
- Attendance and approved leave evidence are included in a permission-checked live payroll input preview. No payroll calculation is available; finalization remains blocked by missing verified effective rules.
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
4. Complete authorized browser validation for live company/branch CRUD, invitations, activation, branch-role assignment, and employee import.
5. Implement deduction pause/resume/settlement/reversal and ledger correction workflows.
6. Build trusted payroll calculation, version-bound approvals, finalization, payslips, and duplicate-posting tests; draft creation is already persistent.
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
- The live attendance/leave database workflows remain persistent and hosted rollback tests pass. Payroll has trusted input preview, draft, submit/review, and finalization primitives, but no trusted calculation RPC that persists payroll items. Approval/finalization therefore cannot be reached through a live calculated workflow; statutory rule-version gates remain in place.
- No credentials, local environment files, Supabase linkage metadata, local Git metadata, or browser artifacts were added to the connector commits.
## 28 October 2026 payroll-input increment

- Added database migration `20261028000900` with permission-checked, read-only `payroll_preview_inputs`; migration `20261028001000` minimizes returned leave/deduction detail. Both are applied to the authorized development Supabase project and migration history aligns through 010.
- The RPC requires `payroll.prepare` for the requested company/branch and an HR-approved attendance period matching the exact dates. It returns approved employees, effective compensation, approved attendance, approved leave-period evidence, and active due installments. It performs no calculation or writes. Attendance day totals remain the payroll adjustment source to prevent double-counting leave; health-sensitive leave type and deduction reason are omitted from the returned snapshot.
- LIVE `/payroll` now displays an input-preview screen and uses the RPC. It clearly indicates that no payroll calculation, submission, approval, or finalization occurs. A branch manager without `payroll.prepare` is denied by the hosted smoke assertion.
- Hosted rollback-only smoke test passed after migration 010, including a synthetic K6,000 employee with approved attendance and compensation and the negative branch-manager permission case. All test fixtures are rolled back. Migration history and original test account/data counts are unchanged from the prior baseline except for the two migration records.
- Local verification: TypeScript check passed; 76 tests across 24 files passed; production build passed; Oxlint completed with the six existing legacy warnings. Browser authenticated role workflows remain outstanding.
## 28 October 2026 persistent payroll draft increment

- Added migration `20261028001100_payroll_draft_creation.sql` to the authorized development project after checking linked migration history and a dry run. It adds an exact-period uniqueness index and `payroll_create_draft`, a SECURITY DEFINER function pinned to `pg_catalog`, with explicit `payroll.prepare` permission and approved-attendance checks.
- Draft creation is idempotent by period/run uniqueness and locks the period/run rows; repeated calls return the existing run. The function creates an audit event and no payroll items or repayment transactions.
- LIVE payroll input preview now offers persistent draft creation and reports the saved run ID. It disables draft creation if any approved employee input is missing compensation/attendance. No calculation, submission, approval, finalization, or payment processing is implied.
- Hosted rollback-only synthetic smoke passed the preview snapshot, exact-period DRAFT creation, idempotent retry, no-item assertion, and branch-manager denial. All records rolled back.
- TypeScript passed; the full 76-test suite passed across 24 files; Oxlint completed with six existing legacy warnings; production build passed. The latest Vercel Preview for this draft increment is not yet verified.
## 28 October 2026 deployment verification

- Vercel Preview for commit `a1caab4f9f7b4536c8feb2ca0a68a9cecf219cda` is READY: `https://golden-baobab-hr-v2-md16hmwop-simon-mulengas-projects.vercel.app` (deployment `dpl_CkPtLyp9TQq1v1hCeZKF5ymycvn3`). Both `/auth/login` and `/payroll` return HTTP 200 and SPA HTML with the Golden Baobab HR title. This does not execute browser JavaScript or prove Auth/PostgREST CRUD.
- The CUA browser surface timed out during initialization. Playwright is not installed locally and prior CLI package retrieval stalled. No authenticated browser test is claimed.
- Supabase linked migration history now aligns locally/remotely through `20261028001100`. Rollback-only role/JWT claim tests passed; they do not substitute for real Auth/PostgREST user sessions.
