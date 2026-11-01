# Deployment and Recovery

## Current release identifiers

- Repository: `SimonMulenga/golden-baobab-hr-v2`
- Production branch: `feature/supabase-auth`
- Production Vercel project: `golden-baobab-hr-v2`
- Production URL: <https://golden-baobab-hr-v2.vercel.app>
- Supabase project reference: `jssuaebiizjcoqmngxzk`
- Release commit checked: `adb46ce715740298d352c6d2e7d9ab348b3a7468`
- Remote schema history checked read-only: through migration `20261101005300`

Vercel environment variable names were reviewed without printing their values. Production has `VITE_DATA_MODE`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; the configured mode is LIVE and the browser key is a publishable key. Do not use a service-role key in any `VITE_` variable.

The compiled production bundle and production endpoint configuration resolve to Supabase reference `jssuaebiizjcoqmngxzk`; this was checked without printing the key or full endpoint.

## Deployment procedure

1. Confirm the reviewed commit and clean/staged file list; exclude the original employee workbook, report references containing real data, backups, `.env*` and credentials.
2. Run the single-worker Vitest suite, TypeScript check and production build.
3. Confirm pending migrations and recovery point before any database write.
4. Deploy to the existing Vercel project and verify the deployment commit, `READY` state, domain alias and non-mutating HTTP smoke check.
5. Run signed-in acceptance with approved synthetic identities before handover.

## Recovery status

An earlier local archive was reported as checksum/list validated and partially restored on an isolated PostgreSQL instance, with application/Auth data and Storage metadata included and Vault excluded. This QA pass did not create a new backup or repeat restore validation. The existing archive predates migration 053 and therefore is not a current pre-release recovery point. Full recovery of Supabase-managed Auth configuration, Vault, Storage object bytes, roles and project settings has not been proven. The Free plan does not provide scheduled database backups. Do not claim recovery readiness until a fresh encrypted backup and restore drill cover the required services.

For an incident, pause payroll operations, preserve logs and the current database state, identify the affected project and migration version, and have the project owner initiate the documented Supabase recovery path. Do not run `db reset`, restore into the live project, or manually mark migrations as applied.
