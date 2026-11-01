# Golden Baobab HR V2

Golden Baobab HR V2 (PeopleOS) is a React, TypeScript and Vite application backed by Supabase Authentication, PostgreSQL and Row Level Security. It provides multi-company HR, attendance, leave, payroll and reporting workflows for Zambian businesses.

## Local development

```sh
npm install
npm run dev
```

Set `VITE_DATA_MODE=LIVE`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` in a private local environment file. The publishable key is intended for browser use; never put a Supabase service-role key in a `VITE_` variable.

## Verify

```sh
npm run typecheck
npm run build
```

```sh
npm test -- --maxWorkers=1 --pool=threads
```

The application includes company and branch administration, employee onboarding, attendance, leave, payroll, payslips, reports, user management, audit logs and settings. Access depends on authenticated role assignments and database policies. A screen or local test alone does not prove a live workflow is authorized or operational; see `docs/handover/QA_TEST_REPORT.md` and `docs/handover/KNOWN_ISSUES.md` for the latest verified scope.

Payment-provider transfers and statutory submissions are not performed by the application. Payroll exports and contribution schedules are files for authorized review and processing.
