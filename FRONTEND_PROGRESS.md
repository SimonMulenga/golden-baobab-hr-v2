# Golden Baobab HR frontend progress

Last updated: 28 October 2026

## Scope and constraints

- Frontend-only prototype with synthetic data. No backend, database, Supabase, authentication, external services, real payroll processing, or deployment.
- Mock records are shared through typed feature contexts; company, organization, and employee demo records persist in this browser's local storage for continuity.
- Local browser storage is demo persistence only and is not a secure or durable data service.
- Access and payroll status workflows are visual simulations, not enforced security or financial workflows.

## Completed routes and useful interactions

### Foundation

- `/`: Existing Golden Baobab HR dashboard and branding, light/dark themes, responsive sidebar, mobile navigation, company switcher, charts, KPIs, activity, and calendar.
- Major feature modules are loaded with route-level `React.lazy`/`Suspense` boundaries.

### Organizations and company structure

- `/organizations`: organization overview, create/edit dialogs, company links.
- `/companies`: searchable directory, status/industry/organization filters, grid/table views, CSV-independent mock state.
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
- `/auth/login`, `/auth/forgot`, `/auth/reset`, `/auth/unauthorized`, `/auth/expired`, `/auth/invitation`: authentication design prototypes with all actions explicitly inactive.

## Verification performed

- `npm run typecheck` passed after the standalone auth shell adjustment.
- `npm run build` passed after the standalone auth shell adjustment. Main entry chunk remains above Vite's 500 kB advisory threshold; feature routes are split into chunks.
- No browser automation was run in this stage. Earlier CUA browser inventory was unavailable.

## Known limitations and next implementation tasks

- Global search, notification dropdown, and user profile dropdown in the application shell still need fully functional interactions.
- Branch profile and branch-specific employee listing need a dedicated route/view; current branch management lives in the directory and company profile.
- Company dashboard/settings, organization directory/profile/settings/registration/contact/admin fields, and richer organization edit model are incomplete.
- Department/job-role catalog lacks branch associations and a reporting-tree view; catalogs are component-local mock state.
- Allowances, recurring/one-time adjustments, deductions, overtime configuration, payslip directory and print-ready payslip remain to be implemented.
- Payroll workflow covers a synthetic preview but not a detailed per-employee earnings/deductions table, approvals history, or full review/reject workflow.
- Attendance calendar/history/correction queue and leave calendar/policies/history/entitlement configuration remain partial.
- Reports beyond the employee register, print layout, and broader analytics remain incomplete.
- Settings currently cover only selected workspace/company preferences and do not share persisted settings state.
- Import supports CSV only; XLSX parsing, duplicate resolution, and rollback are not implemented.
- Import is linked from the employee directory and imports valid mapped CSV rows into the local demo employee store only.
- Authentication prototypes are standalone pages, but do not provide real account or session behavior.
- Automated tests and browser interaction/responsive/theme verification remain outstanding. No claim of browser verification is made.
- The dashboard retains its original fixed synthetic figures, which do not yet derive from the new 120-record employee dataset.
