# Golden Baobab HR V2 backend foundation

## Current development checkpoint (28 October 2026)

- The reviewed forward-only migration set now aligns through `20261028001400` on development project ref `jssuaebiizjcoqmngxzk`. Migration 014 adds the scoped portfolio membership directory, invitation authorization check, and atomic branch-role assignment replacement. The previous migrations add company-scoped Company Administrator membership and employee employment status/history. Hosted rollback-only smoke passed; baseline Auth/company records were preserved.
- LIVE Users & Permissions now supports company admins and portfolio/branch roles; the invitation Edge Function and account activation UI are implemented. Invitation email delivery has not been tested and the `/auth/activate` Auth redirect URL is not verified.

- Linked development project ref: `jssuaebiizjcoqmngxzk`. Migrations `20261028000100` through `20261028001400` are applied and aligned. The existing single Auth user was preserved.
- Migration 012 adds audited creator-scoped employee correction/detail RPCs. A hosted rollback-only synthetic workflow passed correction, resubmission, HR approval, and cross-portfolio denial. No employee/private/compensation test rows remain.
- Database-role/RPC smoke is not Auth HTTP/PostgREST or authenticated browser proof. Invitations, role assignment and import are implemented but have not been run with a dedicated synthetic authenticated browser account; no invitation email was sent.
- Latest local verification: 98 Vitest tests passed across 26 files; TypeScript and production build passed; full Oxlint completed with six existing legacy warnings. READY Vercel Preview `dpl_BG8y9Zjg8c8ps3XED7k19JLNX1hK` for commit `aa031c1` returned HTTP 200 on `/auth/login` and `/payroll`. Authenticated browser tests did not run (WSL bash unavailable; CUA timed out). No production database or production deployment was touched.

This repository uses Supabase Auth for email/password authentication when `VITE_DATA_MODE=LIVE`. Fourteen company-first schema/RLS/workflow migrations have been applied to the authorized V2 development project and passed rollback-only hosted SQL role/RLS workflow smoke tests. LIVE companies/branches, employee onboarding/review/correction/profile history, deductions, attendance, leave, payroll input previews, persistent draft creation, and membership-role administration are connected. Payroll calculation and persisted payroll items are not implemented; approval and finalization are therefore not operational from the UI. Details later in this document include older snapshots and must be read with the latest checkpoint in `IMPLEMENTATION_STATUS.md`.

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
- `20261028000100`â€“`20261028000200` establish portfolio/company/branch membership, roles, grants and tenant policies.
- `20261028000300` defines employees, separately protected private details, effective-dated compensation, attendance, leave, advances/installments/transactions, payroll periods/runs/items, statutory rule references, approvals and audit logs.
- `20261028000400` adds tenant- and branch-filtered read policies and keeps domain-table writes closed to browser table operations.
- `20261028000500` adds trusted RPCs for draft employee creation, employee submission/review, deduction request creation/review, payroll submission/review, and atomic finalization. `20261028000900`â€“`01100` add approved input preview and persistent draft creation. Finalization requires active, verified, effective PAYE, NAPSA, and NHIMA rule versions. A trusted persistent calculation operation and approved rule versions are still absent, so payroll calculation, submission, approval, and finalization are not an operational live UI flow.
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

1. **Authentication â†’ URL Configuration:** set Site URL to the approved app origin. Add exact Allowed Redirect URLs for local development (`http://localhost:5173/auth/reset?flow=recovery`, `http://localhost:5173/auth/callback`) and each approved preview origin's corresponding paths. Add only origins actually in use; avoid broad wildcard preview rules where possible.
2. **Authentication â†’ Sign In / Providers â†’ Email:** keep email/password enabled. Do not enable public sign-ups. The UI contains no signup operation. Apply the approved email-confirmation policy for admin-created accounts; unconfirmed users cannot sign in when confirmation is required.
3. **Authentication â†’ Email Templates:** use the built-in password recovery template/link and verify it returns to the configured same-origin reset path. Do not weaken token expiry or email security settings for convenience.
4. **Authentication â†’ Sessions:** retain the project's secure default access-token and refresh-token lifecycle. The browser SDK restores/refreshes sessions; do not store tokens in application localStorage manually or log them.

Remote dashboard settings are outside this repository and were not modified.

## Creating a test account safely

An authorized project administrator can create a dedicated test user under Authentication â†’ Users using the dashboard's add/invite-user workflow. Use a mailbox controlled by the tester, a unique non-production account, and a strong unique password delivered through an approved password manager or the provider's invitation flow. Confirm the account according to the chosen email-confirmation setting. Do not use employee email addresses, production user credentials, shared default passwords, or a service-role key in the frontend. Do not create test users or send invitation/recovery email without the account owner's explicit approval.

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
- Company/branch screens and employee directory/onboarding/review are connected to live reads/writes and trusted RPCs, but authenticated browser CRUD was not verified. Attendance, leave, deductions, payroll, and reporting screens remain gated in LIVE mode.
- Payroll run creation/calculation, attendance and leave write workflows, deduction pause/resume/reversal, payslips, documents, storage, email, and reports are not live.
- Production finalization remains blocked until verified, effective PAYE, NAPSA and NHIMA rule versions are provisioned and a trusted payroll calculation service exists.
- Email delivery and remote session refresh require approved dashboard configuration and an approved non-production test account.


