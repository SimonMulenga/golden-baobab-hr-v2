# Zambia payroll calculation specification (illustrative)

Status: design and test specification only. This implementation is not a production payroll engine, tax filing, payment instruction, or legal opinion. Do not enable production finalization from these inputs.

## PAYE bands supplied for 2026

Progressive monthly bands supplied for the demo:

| Monthly taxable pay | Marginal rate |
| --- | ---: |
| K0–K5,100 | 0% |
| K5,100.01–K7,100 | 20% |
| K7,100.01–K9,200 | 30% |
| Above K9,200 | 37% |

The calculation uses cents and charges each marginal rate only on the amount in that band. A worked example at K15,000 gives K400 + K630 + K2,146 = **K3,176 PAYE**. The [ZRA tax information page](https://www.zra.org.zm/tax-information/) publishes the 2026 bands and a K15,000 worked example. The [ZRA PAYE guide](https://www.zra.org.zm/wp-content/uploads/2025/08/Pay-As-You-Earn.pdf) should be checked alongside subsequent notices.

For this preview, “taxable pay” is a configurable input currently illustrated as basic pay plus taxable allowances. Confirm the exact emoluments, benefits, reliefs, exemptions, rounding rules, employee category, and effective date against current authoritative material before production use. If a case is outside the implemented ordinary band calculation, production finalization must be blocked until the case is specified.

## NHIMA requested configuration

The requested illustration is 1% employee and 1% employer. Contribution bases are independently configurable in the helper. Official NHIMA materials need reconciliation before activation: the [NHIMA FAQ](https://www.nhima.co.zm/elementor-1783/) describes formal-sector employee contribution against declared income and employer contribution against basic salary, while other published material describes both against basic salary. Confirm the applicable base, population, exemptions, cap, remittance timing, and 2026 effective rule with NHIMA. This configuration remains unverified and is not enabled for production finalization.

## Proposed NAPSA configuration

The demo exposes a proposed 5% employee and 5% employer contribution input. NAPSA’s [formal-sector contribution information](https://www.napsa.co.zm/self-service/formal-sector) and [contribution guidance](https://www.napsa.co.zm/self-service/contributions) describe equal 5% shares and a pensionable earnings ceiling. The applicable 2026 ceiling, pensionable earnings base, covered employment, age/retirement treatment, exemptions, and effective notice must be verified before activation. No age-based contribution exemption is inferred by this specification.

## Proposed employment calculations (must be contract-configured)

- **Gross earnings:** basic pay + each applicable housing, meal, transport, and other allowance + approved overtime + other approved earnings. Preserve component-specific statutory treatment; do not assume every allowance is treated identically.
- **NAPSA:** proposed employee 5% and employer 5% of a separately configured pensionable base, subject to a verified ceiling and applicable eligibility.
- **NHIMA:** requested 1% employee and 1% employer, with separate configured bases until the authority confirms the proper basis.
- **Gratuity:** proposed rule for an eligible long-term contract is 25% of basic pay earned during the contract, payable at contract end and prorated where applicable. The [Employment Code Act No. 3 of 2019](https://www.parliament.gov.zm/sites/default/files/documents/acts/The%20Employment%20Code%20Act%20No.%203%20of%202019.pdf) is the primary legal reference. Eligibility, exclusions, interaction with social security or other benefits, contract classification, and calculation period require legal review.
- **Overtime:** the Employment Code Act describes 1.5× hourly basic pay for qualifying overtime and 2× for qualifying public-holiday/rest-day work, with ordinary-hour and divisor rules. Coverage, exemptions, averaging, hours records, contract terms, and current amendments must be confirmed for the employee. Do not infer overtime from attendance alone.
- **Annual leave payment:** the Act’s Fifth Schedule includes a full-pay × accrued-leave-days ÷ 26 formula for the applicable leave benefit. Confirm the specific payment event, accrued day count, contract, and applicability before using it in payroll.
- **Unpaid leave / attendance:** no generic per-day deduction is assumed. Use a documented, approved contract-specific formula, count overlapping leave/attendance once, and preserve paid leave and other payable absences.
- **Employee advances:** schedule with integer cents; the last installment absorbs any rounding remainder. Do not carry shortfalls implicitly. A repayment is posted only when its payroll run is finalized; preview/rejection/cancellation never posts it.

These formulas are proposals for a future effective-dated rule catalog, not activated statutory rules. Relevant references: [Employment Code Act](https://www.parliament.gov.zm/node/7948), [ZRA](https://www.zra.org.zm/tax-information/), [NAPSA](https://www.napsa.co.zm/self-service/formal-sector), and [NHIMA](https://www.nhima.co.zm/elementor-1783/). Obtain authoritative legal and regulator confirmation, including later amendments and notices, before production calculations.

## Implemented preview and tests

`src/features/payroll/zambia-payroll.ts` contains a decimal-safe progressive PAYE demonstration plus configurable NHIMA/NAPSA bases. It always returns `productionFinalizationAllowed: false` and a verification warning. Tests verify K15,000 → K3,176 and the requested 1% NHIMA illustration. Payroll UI must continue to identify these results as synthetic and unverified.

## Required verification before activation

1. Legal/payroll specialist verifies effective 2026 law, notices, bases, rates, ceilings, exemptions, categories, and rounding.
2. Store each approved rule version with source, effective dates, approval, and an immutable calculation explanation.
3. Test boundary values just below/at/above every band and cap, allowance categories, partial periods, unpaid/paid leave, overtime, and termination cases.
4. Independently reconcile representative calculations with regulator guidance and parallel payroll review.
5. Only trusted server-side payroll code may mark an approved rule as production-verified or finalize a live run.
