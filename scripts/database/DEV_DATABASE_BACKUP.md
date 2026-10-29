# Development database backup and restore validation

This workflow targets only development project `jssuaebiizjcoqmngxzk` through its PostgreSQL **session pooler** in `eu-west-1`. It does not use Docker/WSL, change the database, or apply migrations. Keep all resulting files private: the archive contains HR/payroll data.

## One-time credential setup (project owner action)

1. Locate the existing development database password in the team's approved password manager. Do not reset it. If it is not retained, stop here and have the project owner arrange an approved credential-recovery path; do not paste a password into chat, a ticket, or a shell command.
2. In PowerShell at the repository root, run:

   ```powershell
   .\scripts\database\setup-dev-pgpass.ps1
   ```

3. At the hidden prompt, type the existing database password and press Enter. The script creates `%LOCALAPPDATA%\GoldenBaobab\database-credentials\development-session-pooler.pgpass`, protected to the current Windows user and SYSTEM. It refuses to overwrite an existing file. The password is not an argument or console output. The temporary managed string is cleared as soon as practical; .NET cannot guarantee erasure of immutable string memory.

Do not open, print, copy into chat, or commit the `.pgpass` file. PostgreSQL requires the password in this file as plaintext, so its Windows ACL is the protection boundary. The script uses the pooler username for this project and escapes `.pgpass` special characters.

## Create and verify the archive

After credential setup succeeds, run:

```powershell
.\scripts\database\backup-dev-postgres.ps1
```

Outputs are created under `%LOCALAPPDATA%\GoldenBaobab\database-backups`, outside the repository. The script restricts that directory to the current user and SYSTEM. It performs a read-only `psql` connection/server-version preflight with SSL required and an 8-second connection timeout; checks that `pg_dump` is not older than the server major version; writes a custom-format `pg_dump` archive; exports role definitions separately with role passwords omitted; runs `pg_restore --list`; and writes a SHA-256 checksum and sanitized manifest. `pg_dump --verbose` writes progress to the per-run stderr log. Each database operation has a bounded timeout (45 minutes by default; configurable up to 120 minutes).

Treat `BACKUP_VERIFIED` as a successful archive-structure check only. Stop and preserve logs if a command times out, exits nonzero, the listing is empty, or the checksum/manifest is not produced. A `.dump` file alone is not proof of a restorable backup.

## Isolated restore validation

Do not restore over the source development project. Never use a Supabase pooler host or an application database as the restore destination. The local validation script `restore-validate-local.ps1` creates a fresh PostgreSQL 18 cluster under `%LOCALAPPDATA%\GoldenBaobab\restore-validation` on loopback port 55432, with a unique run directory, protected ACL, identity/emptiness checks and bounded native-tool processes. It refuses an occupied port or reused directory. It restores selected application/Auth metadata schemas in one transaction, with no ownership replay, and removes only its verified temporary cluster after a confirmed clean stop; private logs remain for review. It excludes Supabase Vault and does not reproduce the managed Supabase environment, so this path provides **partial application-schema validation only**.

For full Supabase recovery verification, provision a **new disposable Supabase-compatible target** with sufficient disk space, no user data, and no production relationship. Creating that target is a separate owner-approved action. Do not point any restore at the linked development project, production, or a database that contains data to preserve.

1. Copy the archive and manifest to the isolated target host using an approved encrypted transfer. Verify the archive SHA-256 against the manifest before restore.
2. Use a separately protected `.pgpass` entry for the target and set `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE=require`, `PGCONNECT_TIMEOUT=8`, and `PGPASSFILE` in that restore process. Never use `PGPASSWORD` or a password-bearing command argument.
3. Confirm with `psql -X -w` that the connected database is the isolated target, server major is compatible, and it contains no application schemas/data. Abort if any check differs.
4. On a clean target only, restore the archive with a PostgreSQL client compatible with the source. The verified development server was PostgreSQL 17.11; the available native Windows client/server is PostgreSQL 18.6. The local script performs a selected-schema restore into a new local PG18 cluster, excluding the unavailable `supabase_vault` extension. For a full restore use a clean Supabase-compatible target and `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname=<target>`. Set a firm outer timeout. Do not use `--clean` or `--create`. Capture logs privately and stop on the first error.
5. Verify expected application schemas/tables, migration history through 027, representative row counts, RLS enabled state and policies, and critical functions/grants. Compare counts only; do not print employee/payroll rows. Run application connectivity and a read-only smoke check against the isolated target.
6. Validate roles separately. Review the generated roles SQL before use: platform-managed roles may already exist on Supabase, and replay can conflict. The exported role definitions contain no role passwords. Any role recreation/password provisioning requires a separate approved secure process.
7. Record the restore target type, PostgreSQL version, validation results and any exclusions in the backup manifest. Recovery readiness is established only after a full compatible restore completes and the checks pass.

### Restore validation completed 2026-10-29

The verified archive `gbhr-dev-20261029-133528.dump` was restored into a newly initialized local PostgreSQL 18.6 cluster on `127.0.0.1:55432`; target identity and emptiness were checked before restore. The selected-schema restore completed in one transaction. Aggregate checks reported 40 public tables, 779 constraints, 53 application functions, 41 public policies, RLS enabled on all 40 public tables, 624 public table grants, and migration history versions 001–027 (27 rows; `20261028000100`–`20261028002700`). Sampled `employees`, `payroll_runs`, `payroll_run_items`, and `leave_requests` counts were each zero in the restored archive. No row values were printed.

This is **partial verification**, not a full recovery test: the selected restore did not reproduce Supabase-managed Realtime, Storage, GraphQL, Vault, or Pgbouncer schemas/platform roles; the local extension catalog check did not confirm the source extensions. The native PostgreSQL 18 install lacks `supabase_vault`. Storage object bytes, platform role passwords, Auth provider configuration, project secrets/settings and other external project state are not covered. The isolated cluster was stopped and its marked data directory removed; private validation logs remain under the per-run directory. Do not treat this partial restore as sufficient recovery evidence for applying migrations 028–032.

This is a procedure only; no isolated target is created or modified by the backup script.

## Coverage and limitations

- The custom archive covers database objects/data that the connected PostgreSQL role is permitted to dump. Native `pg_dump` does not include cluster-wide roles; the separate `pg_dumpall --roles-only --no-role-passwords` file records role definitions without credentials. Treat that file as sensitive and do not replay it blindly into Supabase.
- Native `pg_dump` includes database schemas it can access, potentially including Auth and Storage database metadata. This does **not** back up the bytes stored in Supabase Storage's object service. Verify the archive listing and an isolated restore before claiming Auth/schema coverage.
- Storage object bytes, bucket configuration outside captured database metadata, Edge Functions, Auth provider settings, API keys, project secrets, network settings, and other Supabase project configuration are not guaranteed by a PostgreSQL archive. Preserve/recreate these through their supported project-specific procedures.
- Supabase Free Plan has no scheduled database backups (as confirmed by the project owner). A Dashboard backup/PITR is not assumed in this workflow.
- `pg_restore --list` checks that the archive table of contents can be read; it does not prove that every table's data can restore. Only an isolated full restore verifies recoverability.
