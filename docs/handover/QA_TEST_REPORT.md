# QA Test Report

**Date:** 1 November 2026
**Reviewed release:** `adb46ce715740298d352c6d2e7d9ab348b3a7468` (`feature/supabase-auth`)
**Production:** <https://golden-baobab-hr-v2.vercel.app>
**Supabase:** `jssuaebiizjcoqmngxzk`

## Executed checks

| Check | Result | Evidence/limits |
|---|---|---|
| Full Vitest | PASS, 67 files / 332 tests | `npm.cmd test -- --maxWorkers=1 --pool=threads`; no failed tests. |
| TypeScript | PASS | `npm.cmd run typecheck` completed without diagnostics. |
| Production build | PASS | `npm.cmd run build`; 2,059 modules transformed. Bundle-size warning remains. |
| Oxlint | PASS, 54 warnings, 0 errors | Existing React hook dependency/state-in-effect, render-purity and memoization diagnostics remain. |
| Supabase migration list | PASS, read-only | Local and remote migration versions match through `20261101005300`. |
| Playwright production smoke | PASS, 22/22 | Microsoft Edge, one worker: public sign-in/recovery UI, 19 signed-out protected-path redirects, and responsive sign-in checks. No credentials or forms were submitted. |
| Production deployment | PASS for reviewed baseline | Existing Vercel project deployment was READY for `adb46ce715740298d352c6d2e7d9ab348b3a7468`. |
| Production HTTP smoke | PASS | App HTML and compiled JS returned HTTP 200; bundle references the intended Supabase project. No sign-in performed. |

## Current local-only changes

Fixed mojibake in auth and application-shell loading messages, reduced the global body minimum width from 360px to 320px, corrected the root README, marked four older status reports as historical snapshots, added the Playwright smoke suite/config, and added eight sanitized handover guides. The final application source tree passed the test suite, typecheck, build and browser checks above. Playwright installation reported zero vulnerabilities.

## Module coverage

Unit/component tests cover auth, employee import and approval, companies/branches, attendance, leave, payroll calculation/workflow, payslips, statutory filings, reports, user administration, audit logs and services. Passing those tests does not establish complete live workflow acceptance.

| Module/area | Automated evidence | Live signed-in browser result |
|---|---|---|
| Auth/routing | Unit/component tests and public Playwright smoke | Sign-in/recovery and signed-out guards passed; valid-session lifecycle not run |
| Dashboard/companies/branches | Service/component tests exist | Not run |
| Employees/import/approvals | Model/component/service tests exist | Not run |
| Attendance/leave | Workflow/service/component tests exist | Not run |
| Payroll/approvals/payslips | Calculation/workflow/component tests exist | Not run; no real payroll changed |
| Compliance/payroll reports | Export-model/service/UI tests exist | Owner previously reported manual report viewing/download; this run did not repeat an authenticated export |
| User management/audit/settings | Component/service tests exist | Not run |
| RLS/cross-tenant/Storage | Migration contract and static checks exist | Not dynamically tested with authenticated principals |

## Browser and viewport coverage

The sign-in shell was checked at 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920px, plus 844x390 landscape. No page-level horizontal overflow was detected. Screenshots are at `output/playwright/sign-in-390.png` and `output/playwright/sign-in-1440.png` (local QA artifacts ignored by Git). The signed-out route check covered 19 protected paths. Authenticated module layouts, role navigation, dialogs, tables and workflows remain unverified. Testing used installed Microsoft Edge through Playwright; Docker and WSL were not used.

The browser suite is configured in `playwright.config.ts` and `e2e/public-smoke.spec.ts`. Authenticated test accounts are still required for role-specific workflow coverage; supply them through a secure local test environment, never test source, screenshots or CI logs.

## Route inventory

The application router declares Dashboard, Companies, Branches, Employees, Employee Approvals, Departments, Job Roles, Attendance, Leave Management, Payroll, Pending Payroll Approval, Payslips, Payout Reconciliation, Deductions & Advances, Statutory Deductions, Reports, Users & Permissions, Audit Logs, Notifications, Settings and Auth routes. The SPA catch-all routes unknown paths to Dashboard; unknown-route behavior should be assessed after authentication.

## Recommendation

**NO-GO for final client acceptance at this time.** Automated and unauthenticated browser checks pass, but role-authenticated workflows, RLS/Storage boundaries, responsive module checks, a current full restore point, and statutory effective-rule confirmation remain release gates. No production records were changed in this QA pass.
