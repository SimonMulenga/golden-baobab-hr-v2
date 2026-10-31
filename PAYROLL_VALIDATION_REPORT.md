# Payroll Validation Report

**NHIMA rule status:** 2026 formal-sector rate and base verified against the governing statutory schedule. Authenticated end-to-end payroll testing remains outstanding. No real payroll was calculated or finalized.

## Configured rules and independent checks

- **PAYE:** Existing monthly 2026 bands are K0–5,100 at 0%, K5,100–7,100 at 20%, K7,100–9,200 at 30%, and above K9,200 at 37%. These match the current [ZRA tax information](https://www.zra.org.zm/tax-information/).
- **NAPSA:** The effective 2026 version uses 5% employee and 5% employer contributions, each capped at K1,861.80, with a K37,236 monthly earnings ceiling. The year-specific [NAPSA notice](https://www.linkedin.com/posts/national-pension-scheme-authority_public-notice-revision-in-contribution-ceiling-activity-7417941633180090368-y4Dr) supports the 2026 ceiling/rate; remittance is due by the 10th of the following month per [formal-sector guidance](https://www.napsa.co.zm/self-service/formal-sector).
- **NHIMA:** Formal payroll contributions are 1% employee and 1% employer, separately calculated on monthly basic salary, with no cap. The primary [Government Gazette SI 63 of 2019, Third Schedule](https://www.nhima.co.zm/download/document/813df761802019102159cc9cc7.pdf) specifies 1% of basic salary for each payroll-based share and a deadline of the 10th of the following month. NHIMA's [2023 actuarial analysis](https://www.nhima.co.zm/download/document/951e90a816202311136666fdb3.pdf) distinguishes formal payroll contributions on basic salary from self-employed contributions on declared income. Its current [FAQ](https://www.nhima.co.zm/elementor-1783/) inconsistently describes the formal employee base as “declared income”; the statutory schedule is the governing basis used here. Do not include allowances, overtime or bonuses in the formal payroll base unless a later applicable legal instrument changes it.

## Calculation and audit behavior

- The PostgreSQL payroll calculation uses effective-dated statutory rules and records the applied statutory rule-version IDs.
- Employee NHIMA is included in employee statutory deductions and net-pay arithmetic. Employer NHIMA is stored separately as an employer contribution and included in employer cost, not deducted from the employee.
- Payslips display the employee share only as a deduction. Statutory reports show separate employee and employer NHIMA columns/totals.
- Payroll preparation, submission, independent review, approval and finalization remain separate. Transfers and statutory filing are not connected.

## Synthetic examples and verification

At basic salary only (no allowances or other deductions), the expected NHIMA amounts are:

| Basic salary | Employee 1% | Employer 1% |
|---:|---:|---:|
| K5,000 | K50.00 | K50.00 |
| K6,500 | K65.00 | K65.00 |
| K12,500 | K125.00 | K125.00 |

Only the employee amount reduces net pay. Automated unit and rollback-only PostgreSQL tests cover these examples, allowance exclusion from the NHIMA basic-salary base, employer-cost treatment, rounding, and payslip presentation.

## Remaining release checks

- Confirm no later Gazette amendment or authoritative NHIMA filing instruction supersedes SI 63 before client payroll onboarding; retain the FAQ wording as a compliance-monitoring caveat.
- Complete signed-in synthetic payroll preparation, review, approval and payslip tests before client payroll onboarding.
- Preserve historical rules and calculations; encode future changes as new effective-dated versions rather than editing applied migrations or retroactively recalculating payroll.
