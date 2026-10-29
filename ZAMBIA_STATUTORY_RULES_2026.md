# Zambia statutory payroll configuration — 2026

**Status:** PAYE and NHIMA have been checked against official guidance. The NAPSA amount in the payroll configuration matches NAPSA's year-specific 2026 notice, but conflicts with current general NAPSA guidance and requires confirmation of the applicable effective rule before payroll finalization. Historical payroll snapshots and rates have not been changed.

## PAYE

ZRA publishes the ordinary monthly 2026 PAYE example and rates on its [Tax Information page](https://www.zra.org.zm/tax-information/). The calculation is progressive by band; ZRA's K15,000 example is K3,176.00. Taxable employment emoluments include salary, taxable allowances, overtime, bonuses and other employment benefits. NAPSA and NHIMA contributions are not deducted before arriving at chargeable income.

| Monthly taxable income slice | Rate |
|---|---:|
| First K5,100.00 | 0% |
| Above K5,100 through K7,100 | 20% |
| Above K7,100 through K9,200 | 30% |
| Above K9,200 | 37% |

The supplied [ZRA PAYE calculator](https://www.zra.org.zm/paye-calculator/) page still labels its displayed table 2023. The engine therefore records the current ZRA 2026 Tax Information page as the tax-year source, rather than using the stale calculator heading as evidence. ZRA's official PAYE guidance states that cash allowances are generally taxable and pension contributions are not deducted before PAYE following the 2018 amendment.

**Worked example:** K15,000 taxable pay = K0 + K400 + K630 + K2,146 = **K3,176.00**. The engine rounds monetary results to two decimals with PostgreSQL `NUMERIC round`, ties away from zero.

## NAPSA

NAPSA's [official 2026 public notice](https://www.linkedin.com/posts/national-pension-scheme-authority_public-notice-revision-in-contribution-ceiling-activity-7417941633180090368-y4Dr) states a 2026 contribution-year ceiling of K37,236 and a maximum employee contribution of K1,861.80, with employee and employer contributions each at 5% of gross contributory earnings. The notice states NAE of K9,309 (four times NAE is K37,236) and lists earnings such as basic salary, bonuses, commission, overtime and allowances. NAPSA's [current general formal-sector guidance](https://www.napsa.co.zm/self-service/formal-sector) still shows K28,920.30 and K2,892.03 without identifying the contribution year; for 2026 use the specific 2026 notice rather than those stale general-page values. NAPSA's [August 2026 announcement](https://napsa.co.zm/news/details?id=dt91c3bb-5416-4a53-b521-73923e0ccf112) describes SI No. 62 of 2026 as pension-benefit reforms, including a minimum pension uplift, and does not announce a contribution rate or ceiling change. Keep the 2026 rule effective-dated to the 2026 contribution year; do not change historical calculations.

The contribution month ends on its last calendar day (the 30th or 31st, or the last day in February). NAPSA's [formal-sector guidance](https://www.napsa.co.zm/self-service/formal-sector) says monthly contributions are due by the 10th of the following month. The [Ministry of Labour FAQ](https://www.mlss.gov.zm/wp-content/uploads/2023/10/FREQUENTLY-ASKED-QUESTIONS-AND-RESPONSES-HANDBOOK-WORKING-DOCUMENT-19TH-OCTOBER-2023.pdf) clarifies month-end is the contribution due date, with a grace period through the 10th of the following month; when the 10th falls on a weekend or public holiday, the next working day applies. The filing UI records the 10th as the remittance deadline and pre-fills it from the finalized payroll period; adjust for a public holiday under the approved filing calendar.

| Configuration | Employee | Employer |
|---|---:|---:|
| Rate | 5% | 5% |
| Base | Gross monthly earnings | Gross monthly earnings |
| 2026 maximum | K1,861.80 | K1,861.80 |

The local configuration retains the year-specific notice values above, but that does not resolve whether a later instrument changed them prospectively. Do not alter the effective-dated payroll version or recalculate historical runs until NAPSA confirms the rule and effective period.

## NHIMA

The NHIMA [24 October 2019 implementation notice](https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf) states mandatory monthly employee and employer contributions of 1% of monthly basic salary under SI No. 63 of 2019, with implementation effective 1 October 2019. The configured implementation is therefore:

- Employee: 1% of basic salary.
- Employer: 1% of basic salary.
- Allowances excluded from both configured bases.
- No monthly ceiling configured.
- Employee and employer contributions do not reduce PAYE-taxable income.

The user-provided [Zamcalc payroll summary](https://zamcalc.com/tools/payroll-summary) and its [NHIMA calculator](https://zamcalc.com/calculators/nhima) corroborate this configuration, but Zamcalc is a secondary calculator rather than a legal authority. NHIMA's current [FAQ](https://www.nhima.co.zm/elementor-1783/) says 1% of employee “declared income” and 1% of employer basic salary. The engine follows the cited SI Third Schedule interpretation and the owner's explicit configuration; the differing FAQ wording is recorded as a source discrepancy for future regulator confirmation, not silently used to change the approved payroll rule.

## Overtime — Employment Code Act No. 3 of 2019, section 75

The [official Act published by Zambia Parliament](https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf) states:

- Section 75(1): work above 48 hours in a week is paid at 1.5 times the employee's hourly rate.
- Section 75(2): for a watchperson or guard, the threshold is above 60 hours in a week at 1.5 times the hourly rate.
- Section 75(3): work on a public holiday or weekly rest day outside the employee's normal working week is paid at double the hourly rate.
- Section 75(4): monthly basic wages are divided by 208 hours for a full-time employee other than a watchperson/guard, and by 240 hours for a full-time watchperson/guard.

The user-requested [ZamCalc overtime calculator](https://zamcalc.com/calculators/overtime) presents these 150%/200% categories and also shows a 176-hour five-day example (22 × 8 hours, K10,000 ÷ 176 = K56.82). Since 176 is not the divisor written in section 75(4), the app supports it only as an explicit effective-dated employer schedule setting, not as an automatically inferred statutory divisor. The trusted overtime RPC uses monthly basic pay, multiplies by hours and premium without rounding the intermediate hourly rate, then applies PostgreSQL `NUMERIC round` to the final currency amount (two decimals, ties away from zero). Ordinary time is 150%; qualifying rest-day/public-holiday time is 200%. Each entry is separately submitted for authorized approval.

## Effective dating and stored rule versions

Migration `20261028001700_authoritative_payroll_calculation.sql` stores effective-dated PAYE, NAPSA and NHIMA 2026 versions, source references, calculation bases and rates. The calculation function selects the versions covering the complete payroll period and stores the exact version IDs in each immutable calculation snapshot and payroll run association. No later tax year inherits these values automatically.

## Supported operational scope and explicit blockers

The trusted LIVE calculator currently handles a complete ordinary monthly period for approved employees with unambiguous effective compensation, approved attendance, paid leave, approved overtime/other earnings and approved deductions. It preserves regular monthly salary for paid leave and does not prorate from attendance days. It blocks the run if the data includes non-monthly pay, unpaid leave without an approved formula, an overtime-eligible record without approved overtime inputs, incomplete attendance/compensation, or deductions exceeding available net pay.

Those checks are deliberate. Mid-period salary changes, tax credits, special worker tables, exemptions, gratuity and contract-specific unpaid-leave deductions require their own approved input models and rule versions before the engine can calculate those cases. These limitations do not change the verified ordinary monthly rates above.

## Payroll operations

PAYE remittance is due by the 10th of the following month using the monthly PAYE return according to [ZRA payment due dates](https://www.zra.org.zm/payment-due-dates/). NAPSA and NHIMA are shown as separate employee and employer amounts. The app's payout export is only a finalized-run bank/mobile-money instruction file; it does not transfer money or file statutory returns.
