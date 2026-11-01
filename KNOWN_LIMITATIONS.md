# Known Limitations and Release Risks

> Historical baseline: some project and deployment statements below predate migration 053 and the current production release. See [`docs/handover/KNOWN_ISSUES.md`](docs/handover/KNOWN_ISSUES.md) for current release blockers and verified scope.

## Release blockers

- NHIMA's current FAQ wording (“declared income” for the formal employee share) conflicts with SI 63 of 2019, Third Schedule, which sets payroll-based employee and employer shares at 1% of basic salary. The application follows the Gazette schedule; monitor for a later amendment or formal filing instruction.
- Authenticated end-to-end parity and tenant/branch authorization tests have not run. The development project currently has one Auth user and no company/branch/business rows; no QA accounts or data were created in this work.
- No authenticated browser smoke test or responsive visual inspection was completed.
- No external automated backup is configured. The public GitHub repository is not an acceptable destination for private payroll backups.
- Local EFS encryption is enabled for the backup location, but the encryption key's recoverability was not verified/exported. Full Supabase-managed recovery (Vault, Auth provider/project configuration, managed roles, Edge Function settings, Storage object bytes) is not proven.
- Vercel production still serves baseline commit `d1c32c9`; this local change set is not committed, pushed or deployed.

## Verified state

- Development project `jssuaebiizjcoqmngxzk` is at migration 049. Migration 049 was applied and read-only structural checks passed.
- Pre-migration archive `gbhr-dev-20261031-234707.dump` has SHA-256 `8CBCB91B7CCAEFBCD7BF800B00F9F71A5E3646AF634B7A43647B24C2868368B7`, 1,469 TOC entries, and a successful isolated PostgreSQL 18 restore of application/Auth/Storage metadata schemas. This is partial project recovery evidence.
- At archive time there were 0 companies, branches, employees, compensation, attendance, leave, payroll rows and 1 audit row; there were 3 Storage buckets and 0 objects.
- PAYE agrees with current ZRA bands. NAPSA 2026 ceiling/cap is supported by its year-specific notice and contribution deadline is the 10th of the next month. NHIMA rates and basic-salary base are recorded from SI 63 of 2019, with the FAQ discrepancy documented in `PAYROLL_VALIDATION_REPORT.md`.
- The full local suite passed (268 tests; 59 files), TypeScript passed, and production build passed with a large-chunk warning.

## Functional scope not proven complete

- Automated unit/component tests do not establish successful operation for every signed-in role.
- Live company registration, account invitations/delivery, import authorization, document Storage, attendance correction, leave reconciliation, payroll approval and reporting need authenticated QA.
- Payout instructions may be prepared by the application, but money transfers and statutory filing are not connected.
- The supplied original workbook must remain untracked; only a sanitized template may be included in Git.
