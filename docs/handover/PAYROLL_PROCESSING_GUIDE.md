# Payroll Processing Guide

## Current status

The application has a saved payroll lifecycle with preparation, calculation, submission, independent review/approval and finalization controls. Automated calculation tests do not replace a live, signed-in payroll rehearsal. Do not finalize a real payroll until the client's statutory setup and independent approval process are confirmed.

## Monthly workflow

1. Select the intended company, branch and payroll period.
2. Confirm employee onboarding and approved compensation are effective for the period.
3. Enter and approve the period's attendance, leave, advances/deductions and approved variable earnings required by the configured workflow.
4. Load approved payroll inputs. Resolve every blocking warning at its source; do not bypass missing attendance, compensation or approval checks.
5. Create or open the draft, calculate a trial run and review employee-level earnings, statutory deductions and net pay.
6. Submit the correct calculation version for approval.
7. A separately authorized reviewer checks the submitted run and approves or returns/rejects it with an explanation.
8. An authorized finalizer finalizes only after approval. Finalized snapshots are historical records and must not be silently changed.
9. Generate payslips and reports from the approved/finalized snapshot. Payout instruction files do not transfer money.

## Statutory caution

The repository documents effective-dated PAYE, NAPSA and NHIMA rules in `ZAMBIA_STATUTORY_RULES_2026.md`. NAPSA's year-specific 2026 notice and general guidance are inconsistent on the ceiling; the applicability/effective date needs written confirmation before affected production payroll is finalized. NHIMA source wording also differs on contribution base; the configured 1% employee and 1% employer basic-salary basis is documented, but should be confirmed for the client's filing interpretation.

Never edit a statutory rate to force a desired net pay. Preserve calculation version and source evidence for any approved rule change.
