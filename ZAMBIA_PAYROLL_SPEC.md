# Zambia payroll calculation and workflow specification — 2026

## Status and boundaries

The ordinary monthly 2026 PAYE, NAPSA and NHIMA configuration below has been reviewed against the cited public authority sources and is active as effective-dated version `ZM-2026-CLIENT-APPROVED-V1`. It is not a blanket determination of eligibility, exemption, contract treatment, or special worker categories. The trusted LIVE calculation is PostgreSQL `NUMERIC` based. Payroll approval and finalization remain subject to server-side authorization and supported-input validation. Payout export produces instructions only; no bank or mobile-money transfer is connected.

See [ZAMBIA_STATUTORY_RULES_2026.md](./ZAMBIA_STATUTORY_RULES_2026.md) for source notes and scope.

## Inputs and formulas

- Gross earnings = basic salary + taxable and non-taxable allowances + approved overtime + bonuses + other earnings.
- PAYE-taxable income = basic salary + taxable allowances + taxable overtime, bonuses and other taxable earnings.
- PAYE is progressive by monthly band. NAPSA and NHIMA are not subtracted before PAYE under the configured rule.
- Employee NAPSA = lower of gross monthly earnings × 5% and K1,861.80. Employer NAPSA is calculated separately using the same rate and cap.
- Employee and employer NHIMA are each basic salary × 1%; allowances are excluded under this configured rule.
- Net pay = gross earnings − PAYE − employee NAPSA − employee NHIMA − approved employee deductions.
- Employer cost = gross earnings + employer NAPSA + employer NHIMA.

2026 monthly PAYE marginal bands:

| Taxable income slice | Rate |
| --- | ---: |
| First K5,100 | 0% |
| Above K5,100 through K7,100 | 20% |
| Above K7,100 through K9,200 | 30% |
| Above K9,200 | 37% |

### Owner-approved worked example

Basic K15,092.00; taxable transport K1,509.20; taxable housing K3,018.40; gross and taxable earnings K19,619.60.

| Item | Amount |
| --- | ---: |
| PAYE | K4,885.25 |
| Employee NAPSA | K980.98 |
| Employer NAPSA | K980.98 |
| Employee NHIMA | K150.92 |
| Employer NHIMA | K150.92 |
| Net pay before other deductions | K13,602.45 |
| Total employer cost | K20,751.50 |

## Calculation and payout workflow

1. Create a company and branch-scoped draft for a complete monthly period.
2. Load approved employees, effective compensation, approved attendance/leave and approved scheduled deductions.
3. Calculate in the trusted `payroll_calculate` RPC. It locks the run, stores immutable versioned line items/rule references/history, and is idempotent for a repeated key.
4. Submit the calculated version for approval. A different authorized reviewer begins review and approves, rejects, or returns it. Approval is version-bound.
5. Finalize atomically. Deduction installments post only at finalization and duplicate requests are idempotent.
6. Prepare a finalized-run payout-instruction export. The export is immutable and audited, but is explicitly `NOT TRANSMITTED`.

Finalization remains blocked for unsupported inputs, a missing effective rule version, insufficient net pay, invalid workflow state, or missing permissions. The current calculation supports complete calendar-month ordinary monthly employees with unambiguous compensation, approved attendance/leave, effective allowances, approved variable earnings and approved deductions. Approved leave days must reconcile to the approved monthly attendance record; overlapping or cross-period leave is blocked. Approved paid leave preserves regular monthly salary.

Unpaid leave is blocked by default. An authorized HR user must save an effective-dated employee compensation method: either basic pay divided by scheduled working days, or recurring gross compensation divided by scheduled working days, multiplied by approved unpaid leave days. The selected adjustment reduces the relevant recurring earning component(s) before gross earnings, PAYE, NAPSA and NHIMA bases are calculated. Adjusted components and total adjustment are stored separately for audit, and the payroll snapshot retains its attendance, approved leave, earnings and deduction sources. These formula choices are explicit product policy options and must be selected according to the applicable contract, rather than treated as universal legal formulas.

Bonuses, commissions and other period earnings are stored with a source reference and explicit PAYE-taxable flag, then approved by a different authorized HR reviewer. Overtime follows the separate hours-based workflow below: amounts are calculated server-side from monthly basic pay, the employee's effective-dated divisor and approved work evidence. Approved overtime and flagged taxable earnings enter the applicable gross/taxable bases. Partial-period and non-monthly contract rules remain unsupported and block calculation.

## Precision

All authoritative amounts use PostgreSQL `NUMERIC`, with `round(amount, 2)` at defined currency boundaries (ties away from zero). No binary floating-point operation is used for database payroll totals. Allowance-specific taxable classification is retained. Employer contributions never reduce employee net pay. Negative net pay blocks calculation rather than silently creating a negative payment.

## Not implemented as payment or filing

The application creates no bank transfer, mobile-money disbursement, statutory filing, or remittance. An external payout provider, secure credential handling, reconciliation and production release procedure are required before actual payouts can be sent. Payroll support still requires separate reviewed rules for partial periods, mid-period compensation changes, non-monthly contracts and special exemptions.
# Overtime input rules

Overtime is submitted from hours, not entered as a manually approved currency amount. The trusted PostgreSQL function derives the amount from the employee's effective-dated monthly basic pay and the approved overtime basis, then stores the dates, hours, category, divisor, multiplier and calculated amount in the payroll input snapshot and audit trail.

- Ordinary overtime is 150% for hours after 48 worked in the week (60 for a watchperson or guard, per section 75(2)). Ordinary hours recorded for the week cannot exceed the excess over that threshold.
- Work on a weekly rest day or public holiday is 200% only when it is outside the employee's normal working week.
- The calculation base is basic wages, excluding allowances. Amount is rounded to two decimal places after multiplication using PostgreSQL `NUMERIC`; no intermediate hourly-rate rounding is used for the payable amount.
- The default monthly divisor is 208 under Employment Code Act section 75(4); section 75(4) specifies 240 for a full-time watchperson or guard. ZamCalc also displays an explicit 176-hour five-day schedule example (22 days × 8 hours). Golden Baobab makes 176 an explicit effective-dated HR compensation choice; it does not infer 176 merely from a five-day roster. HR must select and save the divisor under `compensation.edit`.
- Effective divisor choices are 176, 208 and 240. 240 also sets the 60-hour weekly ordinary-overtime threshold. Divisor changes create an effective-dated compensation version and audit record, and cannot be made after an open payroll run covers that effective period.
- The browser shows an estimate only. PostgreSQL revalidates eligibility, schedule, work date, weekly hours and approval scope and computes the persisted amount. Submitted overtime remains excluded until reviewed and approved by a different authorized user.

Primary references: [ZamCalc Zambia overtime calculator](https://zamcalc.com/calculators/overtime) (updated 1 Aug 2026; summarizes sections 75(1), (3) and (4), and shows 208/176 schedules); [Employment Code Act No. 3 of 2019, section 75](https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf) (official Zambia Parliament PDF). The Act states a 208 divisor for full-time employees other than watchpersons/guards and 240 for watchpersons/guards. The 176 option is the explicit five-day schedule example presented by ZamCalc, not the divisor written in section 75(4).
