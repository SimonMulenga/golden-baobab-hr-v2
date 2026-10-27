# Golden Baobab HR V2 backend foundation

This repository is prepared for a future Supabase integration. The current application remains mock-backed. No database operations, migrations, live authentication, or external service calls are implemented by this foundation.

## Architecture

- The React/Vite UI and its current mock contexts remain the active application data source.
- `src/lib/data-mode.ts` selects `MOCK` or `LIVE`; the default is `MOCK`.
- `src/lib/supabase/client.ts` exposes a typed Supabase client only in `LIVE` mode, after validating browser-safe configuration. It does not create a client in `MOCK` mode.
- `src/services/contracts.ts` defines typed boundaries for future auth and domain services. It contains interfaces only; it does not replace or mutate existing mock providers.
- Live requests must surface errors to the caller. Do not add implicit fallback to mock data when a live request fails.

## Environment variables

Copy `.env.example` to `.env.local` for local configuration. `.env` and `.env.*` are ignored by Git, with `.env.example` explicitly allowed.

```dotenv
VITE_DATA_MODE=MOCK
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Keep `VITE_DATA_MODE=MOCK` for the current demo. To enable the client foundation, set `VITE_DATA_MODE=LIVE` and provide a Supabase project URL and a browser-safe publishable key (or legacy anon key). Missing or invalid values stop startup with a clear error. Never use `service_role`, `sb_secret_`, or other secret keys in a Vite `VITE_*` variable: Vite embeds these values in browser assets.

No actual project URL or key is present in this repository. This setup does not connect to a project by itself.

## Local development

1. Install dependencies with the repository package manager (`npm install`).
2. Leave backend variables empty and use MOCK mode for ordinary frontend development.
3. Start with `npm run dev`.
4. Use LIVE mode only after a new, explicitly approved V2 Supabase project is provisioned and its browser-safe values are supplied locally.

The current code has no live domain service implementations, so LIVE mode only prepares and validates the client; it does not replace current mock screens or fetch production data.

## Vercel environment configuration

Do not configure Vercel as part of this foundation. When a future deployment is approved, configure environment variables per environment in Vercel project settings. Keep previews on MOCK until a dedicated non-production Supabase project and access policies are verified. Use only the publishable client key in browser variables. Do not add secrets to frontend `VITE_*` values or commit environment files.

## Security boundaries

- Publishable/anon keys are expected to be visible in browser code; they are not authorization controls.
- Never ship service-role or secret keys to the browser, repository, CI logs, or Vercel frontend variables.
- Authentication prototypes remain visual only. No session or credential flow is activated.
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
