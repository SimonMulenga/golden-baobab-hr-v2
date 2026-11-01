# User Roles and Permissions

## Access model

Permissions are assigned through portfolio, company and branch memberships and enforced by Supabase RPC authorization and Row Level Security. The navigation menu is not the security boundary. An action must be authorized by the backend for the resource's tenant scope.

The current role names and mappings are maintained in the database migrations and `ADMINISTRATOR_PERMISSIONS_MATRIX.md`. Review that matrix together with the actual membership assignment before onboarding or changing a user. Do not infer portfolio-wide or company-wide access from a role label or an empty branch list.

## Operational principles

- Assign the narrowest scope needed for the person's work.
- Branch Managers should operate only on assigned branches.
- HR and company/portfolio administrators may see broader records only where their active membership grants that scope.
- Payroll preparation, review, approval and finalization must retain the configured separation-of-duties checks.
- A user must not approve their own protected request where the workflow disallows it.
- Revoke or deactivate assignments through the audited user-management workflow; do not delete Auth users or historical payroll/audit records to remove access.
- Recheck permissions after assignment changes and sign out/in if the UI still shows stale access.

Authenticated parity and cross-company/branch denial tests were not run in this QA pass; see `QA_TEST_REPORT.md`.
