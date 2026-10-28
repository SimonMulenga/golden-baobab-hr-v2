# Golden Baobab HR V2 implementation status

Updated: 28 October 2026  
Branch: `feature/supabase-auth`

## Current state

The six company-first and HR/payroll migrations are applied to the explicitly authorized development Supabase project `golden-baobab-hr-v2` (ref `jssuaebiizjcoqmngxzk`). Remote RLS/RPC smoke tests pass using rollback-only synthetic identities and data. The existing Auth user remains present. Company/branch CRUD, employee directory reads, employee onboarding, employee review actions, and deduction request/review screens now use LIVE Supabase services; remaining unconnected HR/payroll modules display an unavailable notice instead of synthetic business records.

This is a development integration slice, not an operational payroll system. No employee, deduction, or payroll data is persisted after the smoke tests.

## Database completed

- Migrations `20261028000100` through `20261028000600` are applied and match remote history.
- Added company-first portfolio, company, branch, membership, and explicit platform-admin tables.
- Added employee/private-detail/compensation, attendance/leave, deduction/installment/ledger, payroll period/run/item, statutory-version, approval, and audit tables with composite tenant foreign keys and indexes.
- RLS is enabled on all 25 public business tables. Direct business writes are closed except the company/branch operations explicitly granted with RLS checks. Sensitive employee details have narrower read policies.
- Trusted RPCs cover employee draft creation/submission/review, deduction creation/review and schedule generation, payroll submit/review/finalize, and portfolio membership assignment/revocation.
- RPC catalog checks confirm `SECURITY DEFINER`, pinned `search_path=pg_catalog`, `row_security=off`, no `anon` execute, and `authenticated` execute where intended.
- Finalization requires a version-bound approval, approved employees, due/balance-valid deduction installments, and active/effective/verified Zambian PAYE, NAPSA, and NHIMA rule versions. It is not a usable payroll engine because trusted run creation/calculation and verified rules are not present.
- New Auth users receive a profile via trigger. The migration backfilled profiles with conflict-safe inserts.

## Development data and existing account

- Pre-migration check found zero application tables/rows and no remote migration history; Auth contained one user and one identity.
- The existing Auth account was preserved and not inspected for email/password/metadata. It now has a profile and `PORTFOLIO_ADMIN` access to a clearly named synthetic development portfolio.
- One synthetic company and branch are persistent for UI development. Their registration, TPIN, phone, email, contact, and address values are clearly demo placeholders.
- Current remote counts: 1 Auth user, 1 profile, 1 portfolio, 1 membership, 1 company, 1 branch, 0 employees, 0 deductions, 0 payroll runs.
- No employee or payroll personal/financial data, emails, storage objects, or production data were created.

## Executed verification

- TypeScript check passed after LIVE deductions and route changes.
- Vitest: 68 tests across 21 files passed, including three LIVE deduction screen tests and a projection test ensuring deduction employee labels use a non-private RLS-scoped query.
- Focused LIVE company adapter tests: 2 passed; they verify RLS-visible row mapping and no mock fallback on query failure.
- Oxlint completed with six existing warnings: one mobile navigation state effect in `App.tsx`, three People Ops hook dependency warnings, and two legacy Payroll render-purity warnings. There is no `lint` npm script; Oxlint was run directly.
- Production build passed after LIVE deductions integration. Vite reports the main JavaScript chunk exceeds 500 kB.
- Supabase CLI reports six local and remote migration IDs aligned.
- Hosted database smoke test passed through the authenticated Supabase Management SQL API in a single rollback-only transaction. It tested RLS reads, branch and portfolio boundaries, private detail denial, company/branch inserts, role self-escalation denial, membership assign/revoke, employee draft/submission/HR approval, and six K1,000 installments for a K6,000 advance.
- Post-test counts confirm every smoke fixture rolled back and the existing Auth count remains one.
- Browser automation reached the LIVE login page, verified the Golden Baobab HR title, and confirmed unauthenticated `/companies` redirects to `/auth/login`. Browser console errors are now zero after adding a favicon.
- Browser sign-in and authenticated company screen interactions were not tested because the test account credentials were not provided to this session. Database role/RLS simulation is not equivalent to an Auth/PostgREST browser session.
- Latest Vercel Preview `dpl_HZyfAANTdPHd2PHLph6xGrQH8FgG` is `READY`: `https://golden-baobab-hr-v2-kdlkmxo7w-simon-mulengas-projects.vercel.app`. The uploaded source build used the `feature/supabase-auth` Preview environment. Protected Preview page was opened through Vercel's expiring share link; browser verified the Golden Baobab HR login, LIVE workflow notice, SPA fallback, unauthenticated `/companies` redirect to `/auth/login`, and zero console errors. Authenticated company CRUD and Supabase user flows remain unverified in-browser.
- No full payroll finalization or duplicate-posting test has run against hosted Supabase.

## Latest local verification checkpoint

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- --run --maxWorkers=1`: 68 tests passed across 21 files, including 3 LIVE deduction tests.
- `npm.cmd exec oxlint -- .`: completed with the six warnings listed above.
- `npm.cmd run build`: passed; large-main-chunk warning remains.
- `git diff --check`: passed (Git reports expected LF-to-CRLF notices for several edited files).
- Browser smoke test on the local LIVE server verified the login title, unauthenticated protected-route redirect, favicon, and zero console errors. The test server was stopped after verification.

## LIVE frontend coverage

- Company directory, company details, switcher, and branch views load records from Supabase under RLS.
- Company/branch forms call Supabase through `live-company-services`; branch removals are soft deactivation. This write path still needs authenticated browser verification.
- Employee directory reads use the RLS-filtered service with pagination and only non-private directory fields. LIVE onboarding calls the draft and submit RPCs with company, branch, personal, private, and compensation details; the form does not persist to local storage. LIVE employee review actions call the trusted review RPC and require a reason for return/rejection. Corrections/resubmission UI, employee profile/editing, and import remain unconnected.
- LIVE deductions list RLS-visible requests and persisted installments, create through `deduction_create_request`, and approve/reject through `deduction_review_request`. Only trusted payroll finalization can post repayments. The dashboard reports the real visible company count and clearly marks employee/payroll figures unavailable.
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

1. Add account invitation/provisioning through a trusted server operation; no email invitation was sent.
2. Complete live company/branch browser CRUD and role/branch assignment UI.
3. Connect employee creation/edit/correction, private information, compensation, approvals, and CSV/XLSX import to persistent services.
4. Implement attendance and leave writes/reviews and connect them to payroll.
5. Implement deduction pause/resume/settlement/reversal and ledger correction workflows.
6. Build trusted payroll run creation/calculation, versioned approvals, finalization, and end-to-end idempotency tests.
7. Verify current NAPSA/NHIMA bases, rates, ceilings, and exemptions from authoritative sources; production finalization must remain blocked until confirmation.
8. Implement private document/payslip storage, PDF generation, authorized email delivery, reporting/exports, audit UI, and settings.
9. Run authenticated PostgREST/RLS tests with multiple real synthetic Auth accounts; run browser acceptance and performance tests above 2,500 synthetic employees.
10. The Preview deployment is READY, but authenticated browser CRUD, role-permission flows, and hosted Auth/PostgREST tests remain outstanding. Continue connecting remaining modules and rerun the full synthetic acceptance scenario.

## Git and deployment

The Windows ACLs grant the user write access, but this execution sandbox mounts `.git` read-only. There was no active Git process or stale `index.lock`; Git staging cannot update the index in this environment. No supported permission-elevation path is available in this run, and sandbox protections were not bypassed. Changes remain uncommitted and unpushed. The current tree was uploaded through the authorized Vercel connector and deployed to a Preview-only URL. No force push, merge, production deployment, or production database operation was attempted.
