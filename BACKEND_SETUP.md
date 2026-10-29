# Golden Baobab HR V2 backend foundation

## Current workflow boundary (28 October 2026)

The development Supabase project is at migration 025. Read-only `supabase migration list --linked` confirmed local and hosted history match. The current backend has trusted payroll calculation, approval/finalization and payout-instruction functions, but it does not send payouts.

The LIVE payslip screen added in the current source checkpoint reads the finalized, version-matched `payroll_run_items` record. It supports browser print/save-to-PDF only. It does not create an artifact, upload to private Storage, send email or record delivery status. Do not describe the browser print action as secure server-side PDF generation or email delivery.

The LIVE report screens now read the selected finalized payroll register and employee/employer statutory contribution totals directly from existing RLS-protected rows, with bounded 100-row pages and CSV/XLSX export. This is an internal report only; there is no official filing integration or server-side aggregate endpoint. A read-only LIVE audit viewer reads the existing RLS-protected audit log; it adds no write path. Statutory-rule administration, notifications and general settings still need backend routes/services. The current employee XLSX/CSV flow uses local parsing and bounded REST RPC batches; it does not yet use a server-side atomic import job. These gaps need reviewed migrations/RPCs and isolated synthetic tests before being described as operational.

The overtime engine accepts explicitly configured divisors (176, 208, 240). The Employment Code Act section 75(4) states 208 hours for full-time employees except guards and 240 for guards. 176 is the explicit five-day schedule example on ZamCalc and must not be represented as the Act's default divisor. All divisors remain effective-dated compensation settings, not inferred from user-supplied schedule labels.

Local verification for this checkpoint: typecheck passed; 117 Vitest tests passed; Oxlint completed with six existing warnings outside the new payslip/report/audit components; production build passed (main entry chunk 911.85 kB, warning threshold 500 kB). The Supabase migration list was read-only and matched migrations 001–025. No remote migrations, data changes, Edge Function deployments, or Vercel deployments were performed. Authenticated browser and hosted RLS tests were not run for the new screens.

## Current development checkpoint (28 October 2026)

- Migrations `20261028001700` and `20261028001800` add the trusted persistent 2026 payroll calculation and retire stale trial status labels. PAYE, NAPSA and NHIMA ordinary monthly rules are source-reviewed, active and effective-dated in the authorized development database. See `ZAMBIA_STATUTORY_RULES_2026.md` and `ZAMBIA_PAYROLL_SPEC.md`.
- Hosted rollback-only smoke exercised calculation, rule-version storage, separate reviewer approval, finalization, single K1,000 repayment posting, and idempotent payout instructions. All fixtures rolled back; the existing Auth user remains and no synthetic employee/payroll/payout rows remain persisted.
- Latest payroll-input verification: migrations 019–023 are applied to the authorized development project; the hosted rollback-only payroll/HR smoke passed and retained no fixtures; TypeScript and all 102 Vitest tests passed; production build passed with the existing large-bundle advisory; Oxlint passed with six existing unrelated warnings. This was not an authenticated browser test.

- The reviewed forward-only migration set now aligns through `20261028001400` on development project ref `jssuaebiizjcoqmngxzk`. Migration 014 adds the scoped portfolio membership directory, invitation authorization check, and atomic branch-role assignment replacement. The previous migrations add company-scoped Company Administrator membership and employee employment status/history. Hosted rollback-only smoke passed; baseline Auth/company records were preserved.
- LIVE Users & Permissions now supports company admins and portfolio/branch roles; the invitation Edge Function and account activation UI are implemented. Invitation email delivery has not been tested and the `/auth/activate` Auth redirect URL is not verified.

- Linked development project ref: `jssuaebiizjcoqmngxzk`. Migrations `20261028000100` through `20261028001400` are applied and aligned. The existing single Auth user was preserved.
- Migration 012 adds audited creator-scoped employee correction/detail RPCs. A hosted rollback-only synthetic workflow passed correction, resubmission, HR approval, and cross-portfolio denial. No employee/private/compensation test rows remain.
- Database-role/RPC smoke is not Auth HTTP/PostgREST or authenticated browser proof. Invitations, role assignment and import are implemented but have not been run with a dedicated synthetic authenticated browser account; no invitation email was sent.
- Latest local verification: 98 Vitest tests passed across 26 files; TypeScript and production build passed; full Oxlint completed with six existing legacy warnings. READY Vercel Preview `dpl_BG8y9Zjg8c8ps3XED7k19JLNX1hK` for commit `aa031c1` returned HTTP 200 on `/auth/login` and `/payroll`. Authenticated browser tests did not run (WSL bash unavailable; CUA timed out). No production database or production deployment was touched.

This repository uses Supabase Auth for email/password authentication when `VITE_DATA_MODE=LIVE`. Twenty-five company-first schema/RLS/workflow migrations have been applied to the authorized V2 development project. LIVE company and HR workflows plus the ordinary monthly payroll calculation-to-finalization path use persistent data and trusted operations. Overtime now uses a trusted hours-based RPC and effective compensation divisor. Payout output is an auditable instruction file only; no bank/mobile-money transfer is integrated. Read this alongside the latest checkpoint in `IMPLEMENTATION_STATUS.md`.

### Invitations and branch-scoped roles (28 October 2026)

- Migration `20261028001400_membership_directory_and_branch_roles.sql` adds a permission-scoped membership directory and atomic branch-role assignment replacement. It is applied to the authorized development project and `supabase migration list --linked` confirmed local/remote history through 014.
- `supabase/functions/invite-user/index.ts` is deployed as `invite-user` with platform JWT verification left on. The Edge Function independently validates the caller session, checks `authorize_member_invitation`, restricts redirect origins, creates an Auth invitation using the server-side service key, and applies the authorized membership through existing database RPCs.
- The Edge Function's `APPROVED_APP_ORIGINS` server secret currently permits only `http://localhost:5173`. The Supabase Auth allowed redirect URL for `http://localhost:5173/auth/activate` was not changed or verified. Do not send invitations until that redirect is confirmed in Auth URL Configuration. No invitation or recovery email was sent by this work.
- The LIVE user interface supports account activation, membership listing, branch assignment/replacement/revocation, and company administrator access. Automated tests cover screen behavior and service RPC routing; hosted rollback smoke covers invitation authorization and branch assignment logic. Real Auth email delivery and authenticated browser role tests have not run.

### Employee spreadsheet import (28 October 2026)

- LIVE employee import parses CSV/XLSX on the browser, provides flexible column mapping and local validation, and submits valid records in 20-row bounded request batches through the existing employee draft and HR submission RPCs. Files are not uploaded to Supabase Storage. Row-level outcomes distinguish submission, draft-save, and failure.
- No authenticated import has been performed against persistent employee records. Browser preview and unit tests do not establish successful hosted CRUD or role enforcement for a real import. Import authorization continues to be enforced by the trusted employee RPCs.

## Architecture

- The React/Vite UI uses mock contexts in MOCK mode. In LIVE mode, companies, branches, the employee directory, employee onboarding, and employee review actions use Supabase; unconnected business views are intentionally unavailable rather than showing mock records.
- `src/lib/data-mode.ts` selects `MOCK` or `LIVE`; the default is `MOCK`.
- `src/lib/supabase/client.ts` exposes a typed Supabase client only in `LIVE` mode, after validating browser-safe configuration. It does not create a client in `MOCK` mode.
- `src/features/auth/auth-service.ts` wraps Supabase Auth email/password, session, recovery, and password-update APIs. `AuthProvider` restores and observes the Supabase session and cleans up its listener.
- `src/services/contracts.ts` defines feature contracts. `src/services/live-company-services.ts` loads and persists companies/branches. `src/services/live-business-services.ts` provides typed employee, deduction, attendance, leave, and payroll input operations. LIVE employee directory/onboarding/review/correction/profile history and connected HR modules use these services. A failed LIVE request never silently switches to mock data.
- LIVE routes use Supabase Auth as the session source. Authentication does not grant company authorization.
- Live requests must surface errors to the caller. Do not add implicit fallback to mock data when a live request fails.
- `20261028000100`–`20261028000200` establish portfolio/company/branch membership, roles, grants and tenant policies.
- `20261028000300` defines employees, separately protected private details, effective-dated compensation, attendance, leave, advances/installments/transactions, payroll periods/runs/items, statutory rule references, approvals and audit logs.
- `20261028000400` adds tenant- and branch-filtered read policies and keeps domain-table writes closed to browser table operations.
- `20261028000500` adds trusted RPCs for draft employee creation, employee submission/review, deduction request creation/review, payroll submission/review, and atomic finalization. `20261028000900`–`01100` add approved input preview and persistent draft creation. Finalization requires active, verified, effective PAYE, NAPSA, and NHIMA rule versions. A trusted persistent calculation operation and approved rule versions are still absent, so payroll calculation, submission, approval, and finalization are not an operational live UI flow.
- `20261028000600` adds profile creation on Auth user insert plus audited portfolio membership assignment/revocation RPCs. Direct membership table writes remain closed to browser clients.

## Company-first roles and tenancy

- Companies are top-level business entities in the product. `client_portfolios` is an internal customer-account boundary only; no organization table, route, or relationship is planned.
- `portfolio_memberships` supports multiple roles per user: `PORTFOLIO_ADMIN`, `OVERALL_HR_MANAGER`, `BRANCH_MANAGER`, and `PAYROLL_PROCESSOR`. Portfolio roles cover companies added later to the same portfolio.
- Branch roles also require an active explicit `branch_assignments` row. Composite foreign keys prevent assignments from pointing to a branch under another company or portfolio.
- `platform_administrators` is separate from portfolio membership and has no browser grant/policy. Authentication, profile metadata, and mock UI do not grant platform access.
- Browser users cannot write memberships, branch assignments, or platform-admin grants directly. Authenticated users with `users.manage` may use the scoped, audited assignment/revocation RPCs. Invitation delivery and platform-admin provisioning still require a trusted operator/server operation.
- `app_private.has_permission` resolves supplied company/branch IDs against stored tenant relationships and active roles. The role matrix is currently fixed SQL; the UI role preview remains synthetic.

## Environment variables

Copy `.env.example` to `.env.local` for local configuration. `.env` and `.env.*` are ignored by Git, with `.env.example` explicitly allowed.

```dotenv
VITE_DATA_MODE=MOCK
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Keep `VITE_DATA_MODE=MOCK` for the current demo. To enable authentication, set `VITE_DATA_MODE=LIVE` and provide a Supabase project URL and a browser-safe publishable key (or legacy anon key). Missing or invalid values stop startup with a clear error. Never use `service_role`, `sb_secret_`, or other secret keys in a Vite `VITE_*` variable: Vite embeds these values in browser assets.

No actual project URL or key is present in this repository. This setup does not connect to a project by itself.

## Local development

1. Install dependencies with the repository package manager (`npm install`).
2. Leave backend variables empty and use MOCK mode for ordinary frontend development.
3. Start with `npm run dev`.
4. For development LIVE mode, use only the authorized V2 project and browser-safe local values. `.env.local` is ignored by Git.

In LIVE mode, login/logout/session/recovery use Supabase Auth. Companies and branches are loaded from Supabase and mutations go through the RLS-protected client service. Employee directory/onboarding/review call RLS-protected queries and trusted RPCs. Attendance, leave, deductions, payroll, reports, and other unconnected business routes display an unavailable state and do not show synthetic records. Errors never fall back to mock data. Authenticated browser CRUD still needs verification.

## Vercel environment configuration

For a development preview, configure `VITE_DATA_MODE=LIVE`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` only in Vercel Preview using the authorized V2 development project. Add only the exact preview callback/reset URLs to Supabase. Do not change Production variables or put service-role credentials in frontend configuration.

## Security boundaries

- Publishable/anon keys are expected to be visible in browser code; they are not authorization controls.
- Never ship service-role or secret keys to the browser, repository, CI logs, or Vercel frontend variables.
- Authentication provides identity/session. Company authorization is enforced for migrated tables by PostgreSQL RLS and trusted RPCs; UI role simulations are not security boundaries.
- Tenant identifiers supplied by the browser must never be trusted without checking membership and policy.
- Do not use real employee, bank, payroll, or statutory data in demos.

The earlier Phase 4A review used an organization-first draft in its dependency notes. The approved Phase 4B direction removes that layer; companies are the top-level business entities, with an internal portfolio boundary for customer isolation.

## Initial database migration checkpoint (historical)

The details below document the original six-migration setup. The current remote migration state is thirteen migrations through `20261028001300`; see the checkpoint at the start of this file and `IMPLEMENTATION_STATUS.md` for current live workflows and test results.

The user confirmed that the named V2 project is the development database and authorized non-destructive migrations and synthetic data. After confirming project reference `jssuaebiizjcoqmngxzk`, zero remote migration entries, zero existing application tables/rows, and one Auth user/identity, migrations `20261028000100` through `20261028000600` were applied in order. A preflight dry run listed exactly the six reviewed migrations. `--skip-vault` was used; no Vault settings were changed.

Post-migration catalog verification confirmed all 25 public business tables have RLS enabled, six migration IDs match local history, and trusted RPCs have pinned `search_path`, `SECURITY DEFINER`, no `anon` execute, and authenticated execution grants. The existing Auth user was preserved. It received a profile and access to a synthetic development portfolio containing one demo company and branch. Current counts are 1 Auth user, 1 profile, 1 portfolio, 1 membership, 1 company, 1 branch, and zero employee/deduction/payroll rows. No production or real employee data was used.

A hosted rollback-only SQL smoke test ran through Supabase's authenticated Management SQL API, using synthetic users/records and a transaction that rolls back. It exercised PostgreSQL RLS and trusted RPCs, including company/branch creation, portfolio and branch isolation, private detail denial, membership assignment/revocation, employee submission/approval, and a K6,000 six-installment schedule. This is real hosted PostgreSQL policy/RPC execution, not browser Auth/PostgREST integration or a full payroll acceptance test. The existing Auth user and persistent synthetic demo rows were not part of the temporary test fixtures.

### Static review note (28 October 2026)

An offline review found the original helper granted registered platform administrators a blanket tenant-data bypass. Migration `20261028000400` removes that path from tenant policies. Hosted rollback-only tests verify portfolio and branch boundaries, restricted private details, denied self-escalation, membership revocation, employee approval separation, and deduction schedule creation. Payroll separation/finalization is only locally tested and still lacks run creation/calculation integration.

## Tenant isolation strategy

Data ownership flows from companies to branches and records within an internal portfolio. Composite foreign keys prevent employee, branch, deduction, payroll, and audit records from crossing tenant relationships. RLS is enabled on all migrated public business tables. Bank/contact identifiers are separated from employee directory fields. Membership changes use trusted RPCs; account invitations remain unimplemented. Future migrations need dedicated Storage/document/payslip policies and authenticated PostgREST verification.

## Testing requirements

Before enabling additional live domain services, require TypeScript and lint checks, production build, UI workflow tests in MOCK mode, and authenticated PostgREST tests against the development project using dedicated synthetic users. Test RLS and Storage policy boundaries with multiple synthetic tenants and roles, including negative cross-tenant cases. Never use production employee data in tests. Hosted SQL role/RLS tests have passed; authenticated browser business workflows and Storage policies remain untested.

## Rollback principles

Keep database changes backward compatible where possible. Prefer additive migrations and staged application releases. Take and verify backups before destructive changes; use forward-fix migrations when rollback could lose data. Document the application version, migration version, verification evidence, and recovery plan before each future production change. Frontend rollback must not silently switch a failed LIVE request to MOCK data.

## Authentication architecture

- Supabase Auth is authoritative for the user/session in LIVE mode. `AuthProvider` observes auth events, restores the session after refresh, exposes sign-in/out and recovery actions, and unsubscribes when unmounted.
- `signInWithPassword` is the only sign-in method. There is no public sign-up or social login flow.
- `/auth/login`, `/auth/forgot`, `/auth/reset`, and `/auth/callback` are public auth routes. Other routes wait during restoration, then redirect unauthenticated users to login. Recovery sessions are restricted to the reset page until the password is changed.
- Password recovery redirects to the fixed same-origin `/auth/reset?flow=recovery` route. User-supplied return URLs are ignored. Supabase URL detection handles the callback; an active recovery session is required to update the password. Successful reset signs out and returns to login.
- Session contents, credentials, and recovery tokens are never logged. Authentication errors are mapped to safe user-facing messages.
- MOCK continues to show the existing inactive authentication prototype and requires no credentials. LIVE authentication does not change the mock business providers.

## Supabase dashboard configuration (manual; not changed by this code)

In the Supabase project selected by the project administrator:

1. **Authentication → URL Configuration:** set Site URL to the approved app origin. Add exact Allowed Redirect URLs for local development (`http://localhost:5173/auth/reset?flow=recovery`, `http://localhost:5173/auth/callback`) and each approved preview origin's corresponding paths. Add only origins actually in use; avoid broad wildcard preview rules where possible.
2. **Authentication → Sign In / Providers → Email:** keep email/password enabled. Do not enable public sign-ups. The UI contains no signup operation. Apply the approved email-confirmation policy for admin-created accounts; unconfirmed users cannot sign in when confirmation is required.
3. **Authentication → Email Templates:** use the built-in password recovery template/link and verify it returns to the configured same-origin reset path. Do not weaken token expiry or email security settings for convenience.
4. **Authentication → Sessions:** retain the project's secure default access-token and refresh-token lifecycle. The browser SDK restores/refreshes sessions; do not store tokens in application localStorage manually or log them.

Remote dashboard settings are outside this repository and were not modified.

## Creating a test account safely

An authorized project administrator can create a dedicated test user under Authentication → Users using the dashboard's add/invite-user workflow. Use a mailbox controlled by the tester, a unique non-production account, and a strong unique password delivered through an approved password manager or the provider's invitation flow. Confirm the account according to the chosen email-confirmation setting. Do not use employee email addresses, production user credentials, shared default passwords, or a service-role key in the frontend. Do not create test users or send invitation/recovery email without the account owner's explicit approval.

## Local auth testing

1. Copy `.env.example` to `.env.local` and set `VITE_DATA_MODE=LIVE`, the intended Supabase URL, and its publishable key.
2. In the Supabase dashboard, allow `http://localhost:5173/auth/reset?flow=recovery` and `http://localhost:5173/auth/callback` as redirect URLs.
3. Start `npm run dev`, open `/auth/login`, and sign in with the separately provisioned test account.
4. Verify refreshing a protected route restores the session; sign out and verify the protected route returns to login.
5. Submit the forgot-password form only when sending an email is authorized. Open the received link in the same browser, set a new password, confirm the flow returns to login, then sign in again.
6. Restore `VITE_DATA_MODE=MOCK` (or remove `.env.local`) to return to the unauthenticated demo. Never commit local environment files.

Automated tests use mocked Supabase responses and do not create users, contact a project, or send email.

## Vercel preview auth procedure

For an approved preview only: add the three variables to Vercel's Preview environment, set Supabase's Site URL to the approved canonical origin (coordinate with existing environments), allow the exact Vercel preview callback URL, and deploy only through the separately approved preview workflow. Test login/session refresh/logout/recovery using a dedicated test mailbox and account. Keep preview secrets out of build logs and browser code except the publishable key. Do not promote the preview or change Production settings under this task.

## Known authentication limitations

- Live authentication code is implemented, but the Supabase URL/project dashboard settings and email delivery have not been verified from this workspace.
- Audited membership assignment/revocation RPCs are applied and tested in a rollback-only database session. Auth account invitations and platform-admin provisioning are not implemented.
- Company/branch screens and employee directory/onboarding/review are connected to live reads/writes and trusted RPCs, but authenticated browser CRUD was not verified.
- Hosted SQL/RLS simulation has exercised attendance/leave, deductions and the payroll calculation-to-finalization flow. Authenticated browser CRUD and dedicated HTTP Auth/PostgREST acceptance are still outstanding.
- The ordinary monthly 2026 payroll rule versions are source-reviewed and effective-dated in the development database. Unsupported payroll inputs remain blocked by the calculation service.
- Email delivery and remote session refresh require approved dashboard configuration and an approved non-production test account.

## Persistent payroll calculation and payout instructions

The trusted LIVE workflow uses `payroll_calculate`, not browser arithmetic. It persists payroll run items and immutable calculation history with the exact 2026 rule versions. Approval is server-side and version-bound; the preparer cannot approve the run. Finalization atomically posts approved deduction installments once. `payroll_prepare_payout_instructions` creates an audited, immutable and idempotent payout batch only for a finalized run. Authenticated users cannot directly read the payout export table; only the authorized RPC returns the payment details.

The payout CSV is a bank/mobile-money handoff file. No bank, mobile-money or disbursement provider is configured; its status is `INSTRUCTIONS_PREPARED_NOT_TRANSMITTED`. No funds are moved and no statutory returns are filed by the application.

### Payroll input sources

Migrations `20261028001900` through `20261028002300` add tenant-scoped, reviewed payroll earning inputs, effective-dated unpaid-leave treatment, calculated-input locking, and immutable calculation-source snapshots. Payroll preparation consumes active approved employees, effective compensation and allowance tax classifications, approved attendance, reconciled approved leave, approved variable earnings, and due approved deduction installments. Pending earning inputs, mismatched attendance/leave, overlapping/cross-period leave, ambiguous compensation and unsupported salary frequencies block calculation.

Overtime, bonuses, commissions and other earnings use source references and require a separate HR approval. Overtime is an approved monetary amount, not an automatic hours/multiplier calculation. Unpaid leave defaults to blocked; an authorized HR user must explicitly choose the employee's effective method before calculation. Draft and returned runs can receive source-input corrections; calculated and later runs lock source inputs so their stored calculation cannot become stale. Changes after calculation require return for correction and a new calculation version.

Hosted verification for migrations 019–023 used synthetic fixture rows inside one rollback-only transaction. It covered both paid and unpaid leave, variable earnings, a scheduled advance installment, input approval/locking, and persisted source snapshots. It did not create retained test people, payroll or payouts. It is not an authenticated browser test, and the payment instruction export does not transfer money.

# Overtime calculation boundary

Live overtime uses the trusted `payroll_overtime_input_create` RPC. The browser cannot submit a manual overtime amount or choose its divisor; the RPC reads the effective compensation record, requires an overtime-eligible active approved employee, validates the weekly threshold/category and stores hours, work dates, divisor, multiplier and result. Divisor updates use `employee_compensation_set_overtime_divisor`, require `compensation.edit`, version compensation and write an audit event. Migration 024 changes no auth settings and creates no external service dependency.

## Pending local payslip and import migrations

Local migration `20261028002600_secure_payslip_artifacts.sql` adds the immutable finalized-payslip document registry, private `gb-payslips` Storage bucket, and scoped delivery history. `supabase/functions/payslip-artifacts` generates PDFs from persisted finalized payroll items; it authorizes the caller before using the server-only service key to upload and mint 60-second signed links. There are intentionally no authenticated Storage object policies.

Configure the Edge Function with Supabase's server environment and these server-only settings before deployment: `APPROVED_APP_ORIGINS` (exact origins), `RESEND_API_KEY`, `PAYSLIP_FROM_EMAIL`, and `PAYSLIP_EMAIL_ALLOWED_RECIPIENTS` (explicit comma-separated test recipients). Email delivery remains queued when provider configuration is absent, is rejected outside the allowlist, and has at most three attempts. Do not add these secrets to any `VITE_*` variable. Never use real employee mailboxes in automated tests.

Local migration `20261028002700_atomic_employee_import_jobs.sql` adds the transactional import-job registry and `employee_import_atomic` RPC. The browser parses CSV/XLSX locally, maps arbitrary headers, and submits up to 5,000 validated rows (5.5 MB JSON payload) in one request. The database checks idempotency against the canonical request hash and commits all employee creation/submission writes together or rolls the row transaction back. Recent status/error summaries are available under the same branch permissions.

The remote development migration history was checked read-only and remains at 025. `supabase db push --dry-run --linked` could not connect because the CLI temporary database login lacks a configured database password. Migrations 026/027 and the Edge Function have not been applied/deployed; run them only after supplying the authorized development database connection setting and completing local SQL review. No production endpoint or database was changed.

The latest local check confirms `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, and `DATABASE_URL` are not configured in the execution environment. The linked project file identifies the expected project, but the CLI currently cannot authenticate to the Supabase platform API; with telemetry disabled it reports that an access token is required. Supabase CLI can use a scoped PAT through `SUPABASE_ACCESS_TOKEN`, and a database password through `SUPABASE_DB_PASSWORD` or `db push --password`; do not paste either secret into chat, source files, or command logs. Once the authorized development credentials are available in the secure environment, re-run a dry run for the confirmed project, review migrations 026/027, apply them, verify migration history and policies, then deploy `payslip-artifacts`. See [Supabase CLI database push](https://supabase.com/docs/reference/cli/supabase-db-push), [Supabase CLI troubleshooting](https://supabase.com/kb/troubleshooting/supabase-cli-failed-sasl-auth-or-invalid-scram-server-final-message), and [Supabase PATs](https://supabase.com/docs/guides/platform/personal-access-tokens).

### Local static security review for migrations 026/027

- Migration 026 uses composite tenant/company/branch foreign keys, denies direct delivery-table privileges to `authenticated`, exposes redacted delivery history through a `payroll.finalize`-checked RPC, and restricts delivery claiming and artifact registration to `service_role`. The claim RPC verifies the initiating active Portfolio Administrator/Overall HR membership. Storage is private, with no authenticated `storage.objects` policies. The Edge Function validates the user session and exact origin before using service-role Storage; signed links are limited to 60 seconds. Storage/object and function behavior remain unverified until hosted tests run.
- Migration 027 has RLS enabled on job history, tenant/branch foreign keys, permission checks for both employee import and creation, a payload-hash-bound idempotency key with transaction advisory lock, a same-company duplicate check, and a nested subtransaction around every employee/compensation/submission write. A database exception rolls back all rows while retaining a generic failed-job record. This is static review only; concurrency, rollback and tenant isolation have not yet run against a database containing migrations 026/027.
- The initial static review identified two recipient-address exposure paths. The current local migration removes direct authenticated table SELECT and replaces history with a redacted RPC; `payslip_email_claim` is now service-role-only. Do not apply earlier copies of migration 026; apply the current reviewed file only after a secure dry run.
