# Known Issues and Release Risks

## P1 — Signed-in acceptance remains incomplete

No authorized QA sessions were used in this run. Company registration, invitations, employee approvals/import authorization, attendance and leave workflows, payroll approval/finalization, payslip access, private Storage access, report RLS and role-specific navigation have not been independently verified in a browser against live identities. Unit/component tests do not close this gap.

## P1 — Authenticated browser and module visual inspection incomplete

Microsoft Edge Playwright checks passed for the public sign-in/recovery shell and 19 signed-out protected-route redirects (22 checks total). The sign-in shell was checked from 320px through 1920px and in 844x390 landscape, with no page-level horizontal overflow. Authenticated module layouts, role navigation, dialogs, tables and operational workflows were not tested; the public-shell result does not establish full-app responsive readiness.

## P1 — Recovery point is stale/partial

The archive and isolated restore documented in earlier reports predate migration 053 and excluded Supabase Vault. This pass verified remote migration history through 053 but did not make or restore a fresh backup. Full Auth/Storage object/configuration recovery remains unverified.

## P1 — Statutory source ambiguity

`ZAMBIA_STATUTORY_RULES_2026.md` records a discrepancy between NAPSA's 2026-specific ceiling notice and current general guidance, plus an NHIMA contribution-base wording discrepancy. Obtain written confirmation of effective rules for the client before finalizing affected production payroll or filings.

## P2 — Build bundle size

The production build succeeds but emits a large-chunk warning: the main JavaScript bundle is about 545 kB and the XLSX bundle about 485 kB before gzip. Monitor load performance on low-bandwidth/mobile devices and consider further code splitting after acceptance.

## P2 — Static lint warnings

Oxlint reports React effect dependency/state-in-effect and render-purity warnings in several screens. TypeScript and the test suite pass; these diagnostics were not all individually proven to be runtime defects. Prioritize review of payroll/reporting effects during signed-in regression testing.

## Scope notes

The current application prepares payout instruction files but does not transfer money. It does not submit statutory returns. NAPSA/NHIMA contribution exports are internal schedules, not confirmed official upload formats.
