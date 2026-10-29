# Golden Baobab HR frontend progress

Last updated: 28 October 2026

## Current LIVE screen audit update (28 October 2026)

- `App.tsx` now routes `/payslips` to a LIVE read-only payslip screen. It reads the exact finalized payroll run version and line items under existing payroll/employee permissions, pages 100 items at a time, and provides print/save-to-PDF in the browser.
- `/reports` and `/statutory` now render an internal register/contribution summary from selected finalized payroll runs. They support branch filtering, per-page employee filtering, 100-row table pagination, CSV/XLSX export, and print. The page states these outputs are not official regulator submissions.
- `/audit` now uses the persisted RLS-protected audit log with company/branch/date/action filters, 50-row pagination and a read-only event detail drawer. Permission errors show an error state without demo data.
- The payslip view is not a persisted PDF artifact, and no private Storage bucket, employee self-service payslip access, email delivery, retry queue, or delivery history is implemented. The screen discloses this; no email is sent.
- Current LIVE routes still show `LiveModuleUnavailable` for statutory-rule administration, notifications, workspace settings, departments, and job roles. Those routes must not be mistaken for completed modules.
- The existing LIVE company screens are backed by `live-company-services`; however, employee totals are not populated by that service, company logo upload is not persisted, and company+branch edits are not atomic across their multiple API calls.
- The employee spreadsheet importer parses locally and submits sequential 20-row batches. It is not an atomic import job with durable history or whole-file retry/idempotency; a later batch failure can follow earlier successful rows.
- Browser automation was attempted using the installed Playwright wrapper and available browser bridge. WSL reports `/bin/bash` is unavailable; the browser bridge timed out. No authenticated browser workflow is claimed. Local Vite is running on port 5174 for review.
- Read-only migration history verification found local and development Supabase histories match through migration 025. No migration or remote data change was made in this update.
- Final local checks after the new screens: TypeScript passed; 117 Vitest tests across 31 files passed; Oxlint exited 0 with six pre-existing warnings; production build passed with a 911.85 kB main entry chunk advisory. Local Vite HTTP smoke for `/payslips` returned 200; authenticated browser testing remains unavailable due WSL `/bin/bash` absence and CUA timeout.

## Persistent LIVE payroll workflow (28 October 2026)

- LIVE payroll now supports approved-input loading, persistent draft creation, trusted persistent calculation, employee-level earnings/statutory/net breakdowns, calculation history, submit/review/approval/return/reject, atomic finalization, and immutable payout-instruction CSV preparation.
- Source-reviewed, effective-dated 2026 PAYE/NAPSA/NHIMA versions are used by the trusted calculation RPC. A K19,619.60 example produced PAYE K4,885.25, NAPSA K980.98 per side, NHIMA K150.92 per side, net K13,602.45 before other deductions, and employer cost K20,751.50.
- Payout instructions contain payment details and are only available through the authorized finalizer RPC; CSV generation does not send money. No banking/mobile-money provider is connected.
- Latest hosted rollback-only payroll-input and payroll workflow smoke passed after migrations 019–023. It verified overtime, bonus, paid leave preserving monthly pay, unpaid leave reducing earnings before statutory bases, advance deductions, and auditable source snapshots; all smoke records rolled back. TypeScript, 102 Vitest tests, lint and production build passed. Authenticated browser testing and refreshed Preview verification remain outstanding.

## Prior LIVE payroll trial increment (superseded 28 October 2026)

- The LIVE payroll screen now stores and displays persistent per-employee trial calculations from the trusted PostgreSQL NUMERIC RPC. It includes client-approved 2026 PAYE/NAPSA/NHIMA configuration, rule version and separate `UNVERIFIED` regulatory status, earnings and allowance breakdowns, employee statutory deductions, employer contributions/cost, validation blockers, and calculation history.
- Migration 016 is applied to the authorized development database. Hosted rollback-only RLS/workflow plus payroll rule tests passed, including the exact K19,619.60 owner example and NAPSA cap boundaries. All test data rolled back; only the versioned client-approved policy remains seeded.
- This remains a trial calculator. It cannot submit, approve, finalize, create payable items, or post deduction repayments. Finalization remains blocked for independent statutory verification and incomplete input/rule coverage.

- Payroll screen now persists a draft and invokes the trusted `payroll_calculate_trial` database RPC, which stores an idempotent employee-by-employee trial snapshot. The UI presents gross, official 2026 PAYE candidate, NAPSA/NHIMA candidates, due approved deductions, and candidate net with explicit non-payable labeling.
- Trial calculation uses database numeric arithmetic and authorization/RLS. It does not create actual payroll items, change DRAFT status, post deduction repayments, or allow submit/approve/finalize. Statutory and missing-input blockers are displayed.
- Migration 015 and hosted rollback-only synthetic assertions passed. Local typecheck, full Vitest (99 tests / 26 files), targeted lint, and build passed. Authenticated browser tests remain outstanding.

## Statutory/payroll review (28 October 2026)

- Added `ZAMBIA_STATUTORY_RULES_2026.md` with official-source findings and unresolved NAPSA/NHIMA blockers.
- The illustrative PAYE helper now uses integer cents/basis points and includes band checkpoint and cent-rounding tests. It remains browser-side preview logic, not the payroll authority.
- LIVE payroll remains input preview and persistent draft creation only. No calculation, approval, finalization, or payslip delivery is represented as operational.
- Local check results: TypeScript passed; full Vitest passed 98 tests / 26 files; full Oxlint completed with six existing legacy warnings; production build passed with the existing large-bundle advisory. The READY Preview for commit `aa031c1` returned HTTP 200 for `/auth/login` and `/payroll`; this was an HTTP smoke check only. Authenticated browser automation could not start because WSL lacks `/bin/bash` and CUA timed out.

## Latest LIVE admin and import increment (28 October 2026)

- LIVE Users & Permissions adds scoped portfolio membership listing and audited branch-role assignment/replacement/revocation. The `invite-user` Supabase Edge Function is deployed with JWT checks and a server origin allowlist restricted to `http://localhost:5173`; no invitation email was sent. Confirm `/auth/activate` in Supabase Auth's allowed redirect URLs before sending invitations.
- Invitation activation now requires an authenticated invite session and sets the password through Supabase Auth. CSV and XLSX imports are parsed in-browser, support flexible mappings and full-file validation, and submit valid records in bounded batches to Supabase for HR review.
- Full Vitest passed: 89 tests / 26 files. TypeScript and production build passed. Authenticated browser validation remains blocked by unavailable browser automation and lack of an approved synthetic test account; no account credentials were inspected.
- Payroll is still not an operational LIVE workflow: input preview and draft persistence are connected, but trusted calculation and persisted payroll items are missing. Submit/review/finalization database primitives exist, but cannot run correctly without the calculation step. Finalization stays gated on verified effective statutory rules.
- The latest hosted Vercel Preview still points to a prior commit. These new local changes have not been published or deployed.

## Latest LIVE admin and employment-status increment (28 October 2026)

- Migration `20261028001300` is applied to the authorized development project and migration history aligns through 013. Hosted rollback-only checks passed for company administrator scope/escalation denials and employment status history/payroll preview exclusion; baseline records were preserved.
- LIVE Users & Permissions now manages existing, activated Company Administrator accounts via company-scoped audited RPCs. Email invitations/account activation and branch-manager assignment are not included in this screen.
- LIVE employee profiles show employment status and status history with reason-required suspend/reactivate/terminate actions. Termination cannot be reversed through the current workflow.
- Full Vitest passed: 84 tests / 25 files; focused regression: 15 / 15; typecheck and build passed. New LIVE files lint clean. Existing legacy lint warnings and main bundle size warning remain.
- Browser verification was attempted but blocked by missing WSL `/bin/bash` for the Playwright wrapper and a timeout from the native browser bridge. Authenticated browser checks are not claimed.

## Latest LIVE employee correction slice (28 October 2026)

- Correction route now loads authorized DRAFT/RETURNED_FOR_CORRECTION records through the creator-scoped Supabase RPC, displays protected private fields only after authorization, preserves company/branch assignment, and writes changes through the trusted update RPC before resubmission.
- Employee directory exposes edit/resubmit links for drafts and returned submissions. A failed reload hides the correction form; a failed resubmission does not claim success or discard the saved correction.
- Focused correction/profile tests and the full 80-test Vitest suite pass. TypeScript and production build pass. Existing Oxlint warnings and the main-bundle size advisory remain.
- Hosted synthetic correction/resubmission/approval RLS smoke passed transactionally. Employee and private-data tables remain empty after rollback. Authenticated browser testing remains outstanding.
- LIVE employee profiles and approval timelines now use RLS-scoped, paginated backend reads. The view intentionally does not request NRC, bank, salary, or compensation data.
- LIVE-mode shell, login note and dashboard labels now describe connected persistent modules accurately and state that payroll is draft-only while calculations, approvals/finalization and reports remain unavailable.

## Backend transition note (28 October 2026)

- MOCK mode remains synthetic. LIVE mode is connected for companies/branches, employee directory/onboarding/review/corrections/profile history, deductions, attendance and leave workflows, plus payroll input previews and persistent draft creation. Payroll calculation, approval/finalization and other gated modules remain unavailable.
- Fourteen forward-only company-first/domain migrations are applied to the authorized development project. Recent hosted SQL workflow tests are rollback-only; no employee or payroll fixtures persist.
- This file retains historical mock-mode implementation notes below. For current LIVE scope and verification, see the latest checkpoint in `IMPLEMENTATION_STATUS.md` and `BACKEND_SETUP.md`.

## Scope and constraints

- MOCK mode uses synthetic frontend data. Explicit LIVE mode uses Supabase Auth and only the business services documented in the current backend checkpoint; unconnected modules remain unavailable rather than falling back to mock data.
- Mock records are shared through typed feature contexts; company and employee demo records persist in this browser's local storage for continuity. Old `gbhr-organizations` localStorage data is no longer read or written and may remain inert in existing browsers.
- Local browser storage is demo persistence only and is not a secure or durable data service.
- Mock-mode access and payroll status workflows are visual simulations. LIVE workflow authorization uses database RLS/trusted RPCs where implemented; payroll calculation and finalization remain disabled.

## Completed routes and useful interactions

### Foundation

- `/`: Existing Golden Baobab HR dashboard and branding, light/dark themes, responsive sidebar, mobile navigation, company switcher, charts, KPIs, activity, and calendar.
- Major feature modules are loaded with route-level `React.lazy`/`Suspense` boundaries.

### Company-first structure

- `/companies`: searchable directory, status/industry filters, grid/table views, local mock state; companies are top-level records with no parent entity.
- `/companies/new`, `/companies/:companyId/edit`: validated create/edit forms, Zambian location fields, synthetic logo preview.
- `/companies/:companyId`: profile tabs, summary, company details, branches, company switching, company delete confirmation.
- `/branches`: searchable directory, company filtering, add/edit dialogs, delete confirmation.
- `/departments`, `/job-roles`: searchable catalogs with add/edit/delete mock interactions.

### Employees

- `/employees`: 120 synthetic employee records across six demo companies; search, sort, company/branch/department/status filtering, pagination, bulk selection, masked-field CSV export preview.
- `/employees/new`: four-step form for personal, employment, compensation, statutory, and banking demo fields with required-field validation.
- `/employees/import`: browser-side CSV parsing (up to 5 MB), automatic/manual mapping, validation and duplicate preview, explicit local demo import confirmation. Excel parsing is not included.
- `/employees/:employeeId`: profile tabs for overview, personal details, employment, compensation, attendance, leave, payroll history, documents, and activity; mock edit and status-change confirmation.

### Human resources and payroll preview

- `/attendance`: daily synthetic register, date/company/branch/department/status/search filters, manual correction dialog.
- `/leave`: request queue, configurable illustrative balance preview, leave request dialog with duration preview, approve/reject interactions.
- `/payroll`: four-step synthetic preview run wizard, employee review, illustrative estimate, run status queue, simulated approval/status changes.
- `/statutory`: configurable illustrative PAYE/NAPSA/NHIMA/withholding preview inputs, effective date, breakdown explanation. Values are not legally verified or production calculations.

### Administration and prototypes

- `/reports`: selectable report types, company/period filters, employee register preview, CSV export. Other report choices currently reuse employee register fields.
- `/users`: mock user directory, invite dialog, company access, visual role/permission matrix.
- `/audit`: synthetic event filters and event details dialog.
- `/notifications`: mock categories, unread filters, mark read/unread and mark-all-read.
- `/settings`: workspace/company preferences and HR/payroll preview sections; settings save is local page state only.
- `/auth/login`, `/auth/forgot`, `/auth/reset`, `/auth/callback`, `/auth/unauthorized`, `/auth/expired`, `/auth/invitation`: visual prototypes in MOCK; LIVE supports email/password sign-in, password recovery/reset, callback handling, safe error states, protected-route redirects, and logout. Public signup is absent.
- LIVE session state is centralized in `AuthProvider`, restored on page refresh, observed through a cleaned-up Supabase auth subscription, and sourced from Supabase Auth. Company, employee, and payroll views remain synthetic and are marked as demo data.

### Company-first refactor (Phase 4B)

- Organizations were removed from routes, navigation, local state, types, mock data, company forms and filters, and service contracts. The `/organizations` URL no longer maps to an organization screen.
- Companies now stand alone; each company owns its synthetic branch list. Company creation and switching remain local demo interactions, with no company membership authorization.
- Simulated roles use Platform Super Admin and Company Administrator labels. These mock profiles are separate from Supabase identities; platform privileges are never inferred from login.
- `PHASE4_ARCHITECTURE_REVIEW.md` intentionally retains historical references while describing the approved removal and company-first model.

### Employee approval workflow (frontend simulation, partial)

- New employee records enter `SUBMITTED_FOR_HR_APPROVAL`; approve, return and reject actions append reviewer/time/reason history in local mock state.
- Employee email must be valid or have a documented unavailable reason.
- The employee approval queue is at `/employee-approvals`. Its notice explains that these actions are simulations and are not backed by authenticated role authorization.
- New unapproved employees are excluded from the existing illustrative payroll preview.
- Configurable retirement eligibility is displayed as a model helper only and does not change NAPSA/NHIMA treatment or automatically retire staff.
- CSV import now requires explicit company and workplace-branch selection, allows basic column mapping, previews duplicates and keeps unknown personal/contract/banking fields blank. Import adds rows only to the current demo session for simulated HR review.
- Automated tests cover employee review transitions/reasons, payroll eligibility, retirement date preview, unknown import values and workplace branch assignment.
- Remaining: secure role enforcement, correction/resubmission, complete employee data validation, XLSX parsing/template mapping, chunked import persistence, activity history presentation and compensation history.

### Deductions and advances (local demo slice)

- Added `/deductions` with a repayment preview for one-time, fixed-amount and equal-installment requests, plus a session-only simulated approval queue.
- A pure integer-cent schedule helper supports monthly/weekly/fortnightly periods and manual schedules; remaining cents go into the final installment.
- Shortfall handling is explicit and does not carry balances forward implicitly. A pure helper rejects non-finalized payroll payments and demonstrates balance caps/idempotency per run; it is not connected to payroll or persistent storage.
- Demo UI and calculation tests verify the preview and simulated approval. Real consent records, trusted approvals, pause/resume, settlement/reversal, persistent ledger, concurrency control and payroll posting remain unimplemented.

### Payroll calculation core (pure helper preview)

- Added a pure integer-cent calculator that keeps earnings, employee deductions, employer contributions, net pay and employer cost separate.
- It accepts effective-dated, versioned statutory lines as input; no rates are hardcoded. Missing/unverified/out-of-period rules or deductions above gross prevent a finalizable result.
- Calculation tests use illustrative synthetic lines only. The helper is not connected to the payroll screen or a trusted server and does not verify legal rules.
- A tested workflow helper models branch-assigned submission, preparer/reviewer separation, reasoned review outcomes, approval bound to an exact version, idempotent finalization keys and compensating reversal events. It is not wired to payroll records and does not provide transactional guarantees.

### Monthly attendance payability helper (pure preview)

- Added a tested monthly day summary for salaried, fixed-term monthly, daily-rated, part-time daily and casual daily contracts.
- Paid leave and approved payable absences preserve pay. Unpaid leave for monthly contracts requires an explicitly supplied daily rate; unclassified scheduled days are not automatically deducted.
- Duplicate attendance/leave days and unscheduled dates are rejected. This helper is not yet connected to the attendance or leave screens or payroll.

## Verification performed

### Connected employee, deduction, and payroll demo flow

- `/employees/:employeeId/correct` opens only returned/rejected records, preloads their current fields and HR reason, validates corrections, and resubmits the same record with appended approval history.
- Employee onboarding captures separate allowance amounts and overtime eligibility, checks that the selected branch belongs to the selected company, validates retirement-age range, and requires bank details for bank transfer. Retirement eligibility is shown separately from retirement status.
- `/deductions` and `/payroll` now share in-memory mock state. Requests include employee/company/branch, simulated initiator and Overall HR reviewer, principal, schedule, balance, and posting history. Overall HR approval/rejection and pause/resume are available; only approved active deductions scheduled for a run are selected.
- `/payroll` now uses approved monthly employee records, compensation components, a manual monthly attendance snapshot through the existing attendance helper, and scheduled approved advances. Pending employees are excluded. The HR queue supports review, return/reject with reason, resubmission, approval, and a clearly labelled simulated finalization. The synthetic branch manager is limited to the fixture Kitwe branch.
- Finalized demo runs reduce scheduled outstanding balances at most once per run. No actual payment or payroll filing occurs. A negative net preview is blocked; there is no implicit unpaid absence deduction.
- `ZAMBIA_PAYROLL_SPEC.md` describes the progressive 2026 PAYE example, requested NHIMA 1%/1%, proposed NAPSA and employment formulas, and what still requires authority/legal confirmation. Employee-level breakdowns are labelled demo and cannot represent a verified calculation.
- UI integration test covers pending-record exclusion and a K6,000 / six-month / K1,000 repayment after mock HR finalization. Pure tests cover correction/resubmission, payroll calculation, statutory example, schedule cents, and finalization-only posting.

Known: access roles are only visual simulations. Attendance is not yet sourced from attendance/leave screen records, and the mock store is not persisted. Only monthly salary frequency is included in the connected preview. No RLS changes were applied remotely; the draft permission helper was statically tightened so a platform super-admin does not automatically gain customer company access.

- Phase 4B: TypeScript check passed; all 21 tests passed (7 files); Oxlint completed with six pre-existing warnings; production build passed with the pre-existing large entry-chunk advisory. No remote Supabase or deployment operations were performed.

- Latest local checks: TypeScript passed; 51 tests passed (15 files); Oxlint passed with six warnings in App, People Ops and Payroll; production build passed with the ~900 kB entry-chunk advisory. SQL/RLS scripts remain unexecuted.

- Prior auth automated suite: 15 tests passed across configuration validation, service, provider, screens, and route-gate behavior using mocked Supabase responses. No real test accounts or emails were used.
- Phase 4B company screen tests cover top-level company creation, active company switching, branch association, absent organization route/form, and lists beyond the prior six-company fixture size.
- `npm run typecheck` passed after authentication changes.
- `npm run build` passed after authentication changes. Main entry chunk remains above Vite's 500 kB advisory threshold; feature routes are split into chunks.
- Oxlint completed. Existing warnings remain in `App.tsx` and People Ops / Payroll components; auth code introduced no lint warnings.
- Supabase dashboard configuration, remote sign-in, and email delivery have not been tested or changed.
- No browser automation was run in this stage. Earlier CUA browser inventory was unavailable.

## Known limitations and next implementation tasks

- Global search, notification dropdown, and user profile dropdown in the application shell still need fully functional interactions.
- Branch profile and branch-specific employee listing need a dedicated route/view; current branch management lives in the directory and company profile.
- Dedicated company dashboards/settings and branch profile routes remain incomplete.
- Department/job-role catalog lacks branch associations and a reporting-tree view; catalogs are component-local mock state.
- Allowances, recurring/one-time adjustments, deductions, overtime configuration, payslip directory and print-ready payslip remain to be implemented.
- Payroll workflow covers a synthetic preview but not a detailed per-employee earnings/deductions table, approvals history, or full review/reject workflow.
- Attendance calendar/history/correction queue and leave calendar/policies/history/entitlement configuration remain partial.
- Reports beyond the employee register, print layout, and broader analytics remain incomplete.
- Settings currently cover only selected workspace/company preferences and do not share persisted settings state.
- Import supports CSV only; XLSX parsing, duplicate resolution, and rollback are not implemented.
- Import is linked from the employee directory and imports valid mapped CSV rows into the local demo employee store only.
- Authentication requires an explicitly configured V2 Supabase URL and publishable key in LIVE mode; no credentials are present in the repository and no remote project was contacted for verification.
- Authentication establishes identity only; tenant/company permissions and all business data services remain unimplemented.
- Browser interaction/responsive/theme verification remains outstanding. No claim of browser verification is made.
- The dashboard retains its original fixed synthetic figures, which do not yet derive from the new 120-record employee dataset.

## Current LIVE integration update (28 October 2026)

- Six migrations (`20261028000100`–`20261028000600`) are applied to the authorized V2 development Supabase project; see `IMPLEMENTATION_STATUS.md` for the remote preflight, migration history, data counts, and hosted rollback-only RLS results.
- The existing Auth test user was preserved and provisioned as Portfolio Administrator for a synthetic development portfolio. That portfolio contains one clearly synthetic company and branch; no employee or payroll rows exist.
- Added a live company/branch Supabase service and test coverage. LIVE App state no longer loads mock company/employee records from localStorage. The LIVE dashboard shows the real visible company count and marks unconnected metrics unavailable.
- LIVE company/branch routes display database records. Employee directory reads, onboarding draft/submit, and HR review decisions now call the live Supabase service/RPCs; sensitive fields are excluded from directory reads. Other unconnected HR/payroll routes remain gated instead of presenting mock data as real. MOCK workflows remain intact.
- New LIVE employee screen tests cover RLS service list calls, approval RPC actions, required review reasons/error handling, and company/branch-bound onboarding payloads.
- Browser check verified the LIVE login page, page title, unauthenticated protected-route redirect, and zero console errors. Authenticated browser CRUD was not tested because test-account credentials were not provided.
- Supabase Management API rollback tests exercised company/branch writes, tenant scoping, private-detail denial, membership assignment/revocation, employee approval RPCs, and a K6,000/six-month schedule. This is hosted PostgreSQL role simulation, not full Supabase Auth/PostgREST integration.
- The Vercel project was located through the connected Vercel integration. Encrypted LIVE environment values are scoped only to Preview for `feature/supabase-auth`. Its last failed deployment reported invalid `vercel.json`; the local UTF-8 BOM was removed and JSON validated, but no preview redeployment occurred because current changes are not pushed.
- Git remains blocked by the execution sandbox's read-only `.git` mount; no commit or push was made. No deployment occurred.

# Payroll inputs and HR integration (28 October 2026)

- LIVE payroll now lets authorized payroll preparers submit sourced overtime, bonuses, commissions and other earnings for separate HR approval; rejected/pending values do not enter payroll, and creators cannot approve their own records.
- Approved attendance and leave are reconciled before calculation. Missing attendance, unapproved/pending earnings, overlapping or cross-period leave, leave totals that disagree with attendance, ambiguous compensation, and unsupported frequency block the run with warnings.
- Unpaid leave remains blocked by default until HR sets an effective-dated basic-pay or recurring-gross per scheduled workday method. Paid leave preserves monthly salary. Deductions, attendance adjustment, earnings, gross-to-net, statutory amounts and employer cost display as separate line items.
- Added responsive period earnings and unpaid-leave rule controls to the LIVE payroll screen; success notices remain visible after the page refreshes its records.
- Hosted rollback-only Supabase smoke covers overtime/bonus approval, unpaid-leave calculation, advance installment input, stale-input locking, versioned calculation and idempotent finalization. Full Vitest: 102 tests / 26 files; typecheck, lint and build passed.
- Limitations: overtime amount is entered from an approved supporting record rather than derived from hours and a contract multiplier; no bank/mobile-money provider or real disbursement is connected; no authenticated browser run was performed.

# Overtime screen update

The LIVE payroll input screen now captures overtime from hours and category and uses a PostgreSQL RPC to determine the amount. The employee's effective compensation divisor (176, 208 or 240) is displayed and managed through an audited compensation action. Ordinary, rest-day and public-holiday premiums are shown separately. Unit tests cover the displayed 150%/200% estimates; hosted rollback smoke verified persisted 150%/200% amounts and the integrated payroll snapshot. No UI confirmation suggests funds were transferred.

## Payslip and employee-import reliability increment (28 October 2026)

- Added LIVE controls for server-issued payslip PDF, short-lived private download link, email queue, masked delivery history and bounded retries. This frontend requires pending migration 026 and the `payslip-artifacts` Edge Function to be deployed before those actions work against Supabase.
- Replaced 20-row client-side employee writes with one idempotent `employee_import_atomic` service request, durable import-history view and all-or-none database workflow (pending migration 027). CSV/XLSX parsing and manual mapping remain browser-side.
- Typecheck and production build passed. The first parallel full test run showed two UI test failures under concurrent load; all six affected report/payslip tests passed on isolated rerun. Full serial suite verification is recorded in `IMPLEMENTATION_STATUS.md`.
- Windows Edge smoke: LIVE login screen, protected route redirect while unauthenticated, 390 px viewport with no horizontal overflow, zero runtime exceptions. No login credentials were used; this is not an authenticated business-workflow test.
- No migration was applied: linked history is at 025 and CLI dry-run could not connect because a DB password for its temporary login role is not configured. No Edge deployment or email send occurred.
- Final local checks after the privacy and import-retry refinements: Vitest 122/122 across 31 files, TypeScript passed, production build passed, Oxlint exited 0 with six legacy warnings and no new warnings in changed payslip/import code or the Edge Function. Delivery history omits recipient email and uses a scoped RPC. Import idempotency keys persist in session storage by company/branch and rotate after a definitive response. A Windows-native TS compile validated the Edge source with temporary runtime/import declarations; Deno itself was blocked by Windows application policy. Edge smoke verified LIVE login, protected-route redirect and 390px layout; authenticated business paths were not tested.

## Phase C and D local completion increment (29 October 2026)

- Phase C LIVE payroll covers sourced payroll inputs, separate review/approval, authoritative calculation, submission/review/finalization, statutory reporting and payslip/payment-instruction exports. Bank exports prepare instructions only; they do not transmit funds. No real payroll run was performed in this increment.
- Phase D user/role administration and audit-log views were already present. Added a per-user private workflow notification inbox and company-scoped workspace defaults (time zone, date format, ZMW currency, planned cut-off day). Notifications are status-only database triggers for employee, leave, attendance and payroll changes; they do not send email. Settings writes use a permission-checked, audited RPC.
- Added local migration `20261029003000_workspace_notifications_and_settings.sql`; it has not been applied. Notifications/settings require this migration before LIVE use. Saved date order and time zone now drive LIVE payroll, employee, attendance-history, payslip/report, audit, and user-assignment timestamps. The payroll cut-off remains informational.
- The notification bell and administration link now show the current RLS-visible unread count, refresh after read-state changes, and poll every minute while authenticated. Saved company date order and timezone are loaded into the workspace context and used for operational timestamps and date displays.
- Added the LIVE payout reconciliation screen for finalized payout instruction batches. Authorized payroll finalizers can record statement outcomes by employee (paid, partial, failed, returned, pending, or zero-payment due); the screen stores only amounts, dates, references and notes, never bank account data. Records are audited and branch-scoped; this workflow does not initiate or independently verify transfers.
- Added local migration `20261029003100_payroll_payout_reconciliation.sql`, which provides private reconciliation storage and permission-checked, paginated batch/detail/save RPCs. Migrations 030 and 031 remain unapplied; no hosted reconciliation data or real statement was used.
- Added rollback-only SQL regression assertions for anonymous, payroll preparer, branch-manager and cross-portfolio denials, exact-branch access, amount validation, recipient scoping, bank-detail omission and audit redaction. They were added but not executed because the new migration is unapplied.
- Verification: full Vitest 130/130 across 35 files; focused Phase D regressions 38/38 across 11 files; TypeScript and production build passed. Oxlint exited 0 with warnings, including effect-state warnings in the new screens. The production build retains the >500 kB bundle advisory. No hosted migration, deployment, real email or payment action occurred.

## Phase C/D payroll and compliance continuation (29 October 2026; local only)

- Reviewed the preceding Phase A/B status before work: HR configuration and attendance/leave migrations 028/029 remain local and unapplied, so those workflows are not hosted-integrated yet. The hosted RLS assertions for the newer Phase A/B migrations were not executed.
- Fresh read-only Supabase CLI verification confirmed project linkage/history through `20261028002700`; migrations `20261029002800`–`20261029003200` are pending. A final linked dry run listed exactly 028–032 and applied nothing.
- Existing LIVE payroll calculations, approval/finalization, statutory summaries, payslip artifacts, payout exports, and payout reconciliation were extended rather than replaced. Payroll run history now filters by status and has server-side pagination using the current company/branch scope.
- Added `LiveStatutoryFilings` and `statutory_filing_records` migration 032. The database RPCs expose only permission-checked branch records, derive liabilities from immutable finalized payroll versions, and audit manual filing/remittance changes. This records evidence only; there is no agency submission or payment integration. Due dates are entered against the company's approved filing calendar.
- Migration 032 is local and unapplied. Database function execution, RLS and SQL assertion tests were not run against PostgreSQL or Supabase. It must be reviewed/applied in the development project before the new LIVE register can work.
- Local verification: final serial Vitest passed 139/139 across 39 files. The focused service test passed 9/9. TypeScript and production build passed. Oxlint exited 0 with React hook/compiler warnings. Production build reports a >500 kB main-chunk advisory.
- No statutory rates or bases were changed. No migration was applied, no Edge Function deployed, no data was written remotely, and no real email, payment, filing, production or Vercel action occurred.
