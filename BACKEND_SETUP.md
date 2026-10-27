# Golden Baobab HR V2 backend foundation

This repository uses Supabase Auth for email/password authentication only when `VITE_DATA_MODE=LIVE`. Business modules remain mock-backed. No database operations, migrations, tenant authorization, or live employee/payroll data access are implemented.

## Architecture

- The React/Vite UI and its current mock contexts remain the active application data source.
- `src/lib/data-mode.ts` selects `MOCK` or `LIVE`; the default is `MOCK`.
- `src/lib/supabase/client.ts` exposes a typed Supabase client only in `LIVE` mode, after validating browser-safe configuration. It does not create a client in `MOCK` mode.
- `src/features/auth/auth-service.ts` wraps Supabase Auth email/password, session, recovery, and password-update APIs. `AuthProvider` restores and observes the Supabase session and cleans up its listener.
- `src/services/contracts.ts` defines typed boundaries for future domain services. It does not replace or mutate existing mock providers.
- LIVE routes use Supabase Auth as the session source. Authentication does not grant organization/company authorization.
- Live requests must surface errors to the caller. Do not add implicit fallback to mock data when a live request fails.

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
4. Use LIVE mode only after a new, explicitly approved V2 Supabase project is provisioned and its browser-safe values are supplied locally.

In LIVE mode, login, logout, session restoration, and password recovery use Supabase Auth. Organization, company, branch, employee, attendance, leave, payroll, reports, and other business screens still show synthetic local demo data. No domain service implementation is connected.

## Vercel environment configuration

Do not configure Vercel as part of this implementation. For a separately approved preview deployment, add `VITE_DATA_MODE=LIVE`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` only to the Vercel **Preview** environment in Project Settings → Environment Variables. Use only a project explicitly designated for non-production testing. Then add that preview's exact origin and `/auth/reset` path to Supabase's Allowed Redirect URLs. Do not change Production variables, promote/deploy, or copy credentials into source control. Keep `VITE_DATA_MODE=MOCK` in Production until separately approved.

## Security boundaries

- Publishable/anon keys are expected to be visible in browser code; they are not authorization controls.
- Never ship service-role or secret keys to the browser, repository, CI logs, or Vercel frontend variables.
- Authentication provides identity/session only. No company or tenant authorization is implemented.
- UI role simulations and selected company/branch state are not security boundaries. Enforce access in PostgreSQL RLS and trusted server-side functions when implemented.
- Tenant identifiers supplied by the browser must never be trusted without checking membership and policy.
- Do not use real employee, bank, payroll, or statutory data in demos.

## Planned migration workflow

No migration directory is introduced or executed here. In a later, separately approved backend stage, use a fresh V2-only Supabase project and a reviewed, version-controlled SQL migration history. Review each migration, test it against an isolated non-production database, validate rollback/forward-repair steps, then apply it deliberately through an approved deployment workflow. Do not run migrations automatically at frontend startup or during Vite builds. Do not reuse a prior project or migration history.

## Tenant isolation strategy

Future data ownership should flow from organization to companies, branches, and records. Model explicit organization/company membership and, where required, branch-scoped access. Enable RLS on every tenant-owned table and default policies to deny. Policies must derive allowed tenant IDs from trusted authenticated membership data, not a client-supplied company selector. Add isolation tests for same-tenant access, cross-company access, cross-organization access, unauthenticated access, and role boundaries before live use.

## Testing requirements

Before enabling any live domain service, require TypeScript and lint checks, production build, UI workflow tests in MOCK mode, and integration tests against an isolated non-production Supabase project. Test RLS and Storage policy boundaries with multiple synthetic tenants and roles, including negative cross-tenant cases. Never use production employee data in tests. This foundation has no database tests because it creates no schema or operations.

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
2. **Authentication → Sign In / Providers → Email:** keep email/password enabled. Do not enable public sign-ups. The UI contains no signup operation. Apply the organization's approved email-confirmation policy for admin-created accounts; unconfirmed users cannot sign in when confirmation is required.
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
- No account provisioning, public signup, tenant membership, role-based authorization, company/employee service, or database access is implemented.
- The signed-in workspace still displays synthetic business records; successful login does not prove company authorization.
- Email delivery and remote session refresh require approved dashboard configuration and an approved non-production test account.
