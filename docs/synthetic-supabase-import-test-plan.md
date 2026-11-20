# Synthetic Supabase import test plan

The linked production project is not a safe test target. Do not execute this plan there. Run it only in a separately approved non-production project with schema parity, synthetic identities, and an administrator-provided test account. Do not create that project or its memberships from this repository without approval.

## Test setup

1. Verify the non-production project reference and database before connecting. Use only its browser-safe publishable key and a dedicated synthetic user.
2. Have an authorized administrator provision the minimum portfolio/company/branch membership and `employee.import`, `employee.create`, `employee.submit`, `employee.view` and required private-details permissions. Do not grant owner/admin roles for convenience.
3. Create a documented test portfolio, company and two branches via the approved application workflow. Use synthetic employee data such as `TEST-IMPORT-001`; no real names, identity numbers, bank details or payroll amounts.
4. Record the pre-test counts and IDs for test-scoped rows, import jobs, approval history, audit entries and compensation. Store them in the non-production test log.

## Scenarios

- Positive: import one synthetic employee in branch A; assert one import job, one `SUBMITTED_FOR_HR_APPROVAL` employee, one initial compensation draft, approval-history entries and audit events.
- Company isolation: use a company outside the actor's membership; assert authorization failure and unchanged test-scoped counts.
- Branch isolation: submit a valid company with a branch belonging to another company or an unassigned branch; assert failure and no writes.
- Employee-number duplicate: submit an existing company employee number with CREATE and assert validation failure; repeat with case/whitespace variation to exercise the unique index.
- Batch duplicate: submit duplicate employee numbers in one payload; assert `VALIDATION_FAILED` and no employee or compensation writes.
- Idempotency: replay identical actor/scope/key/payload and assert the same job is returned with `replayed=true`; reuse the key with changed payload and assert rejection.
- Protected approved salary: attempt `SAFE_UPSERT_DRAFT` against an approved record; assert authorization/validation failure and unchanged approved compensation.
- Atomic rollback: submit a two-row batch where row 1 is valid and row 2 violates a known database check. Assert the function reports FAILED/zero imported rows, there is no employee/compensation row for row 1, and job/error/audit behavior matches the function contract.
- RLS: sign in as an unauthorized synthetic user and assert company, branch, employee, compensation and job reads return no unauthorized rows; verify allowed reads under the scoped test role.

## Cleanup and evidence

1. Export only test-scoped synthetic records and capture assertions before cleanup.
2. Remove test rows only using documented, reviewed cleanup functions in the non-production environment. Do not use truncate, reset or broad deletes. If approved workflows provide no safe cleanup route, mark the test data retained and request an administrator cleanup operation.
3. Recheck pre-test versus post-cleanup scoped counts; keep run IDs, project ref, app commit, migration version, assertions and cleanup result.
4. Never point this test harness at `jssuaebiizjcoqmngxzk` or the October workbook.
