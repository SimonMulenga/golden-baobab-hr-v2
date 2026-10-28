# Golden Baobab HR frontend progress

Last updated: 28 October 2026

## Backend transition note (28 October 2026)

- The frontend continues to use synthetic business state in both MOCK mode and the current LIVE-auth shell. A typed Supabase service adapter now covers employee directory reads/draft creation/review, deduction reads/request creation/review, and payroll reads/submission/review/finalization RPCs. The existing screens are not yet connected; failures in this adapter propagate and never silently return mock data.
- Employee, compensation, attendance, leave, deduction, payroll, approval, and audit schema/RLS migrations plus trusted workflow RPCs are local source only. Local PostgreSQL/RLS tests passed; no hosted migration or business record has been applied.
- See `BACKEND_SETUP.md` and `IMPLEMENTATION_STATUS.md` for target verification, SQL test scope, and remaining integration work.

## Scope and constraints

- Synthetic frontend with Supabase email/password authentication available only in explicitly selected LIVE mode. Business data remains mock-only; no database schema, domain backend, tenant authorization, real payroll processing, or deployment is included.
- Mock records are shared through typed feature contexts; company and employee demo records persist in this browser's local storage for continuity. Old `gbhr-organizations` localStorage data is no longer read or written and may remain inert in existing browsers.
- Local browser storage is demo persistence only and is not a secure or durable data service.
- Access and payroll status workflows are visual simulations, not enforced security or financial workflows.

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
