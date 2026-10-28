# Zambia payroll statutory rules for 2026

**Research status: 28 October 2026.** This is an engineering source review, not legal advice. The payroll finalization gate must remain closed until every applicable rule is confirmed and stored as an approved effective-dated rule version. Official webpages can change; archive the source and its publication/effective date when a rule is approved.

## PAYE â€” verified 2026 monthly bands

ZRA's [Tax Information](https://www.zra.org.zm/tax-information/) page (accessed 28 October 2026) publishes the 2026 monthly example and the following progressive bands. Its [PAYE guide](https://www.zra.org.zm/wp-content/uploads/2025/08/Pay-As-You-Earn.pdf) gives the same example. The exact tax-year effective date is 1 January 2026 by the page's â€œ2026 Tax Bandsâ€ label; no separate Gazette instrument was identified in this review.

| Monthly chargeable income slice | Marginal rate |
| --- | ---: |
| First K5,100.00 | 0% |
| K5,100.01â€“K7,100.00 | 20% |
| K7,100.01â€“K9,200.00 | 30% |
| Above K9,200.00 | 37% |

Calculation is progressive by slice, not a single rate on all income. ZRA's official K15,000 example yields K400 + K630 + K2,146 = **K3,176.00**. The tax-free threshold is K5,100 monthly for this ordinary table.

ZRA defines employment emoluments to include wages, salary, overtime, leave pay, commissions, fees, bonuses and other employment payments. It says cash allowances and benefits are generally taxable, identifying exceptions including Labor Day awards, ex gratia payments, medical and funeral expenses, councillor sitting allowances, and non-cash benefits that cannot be converted to cash (examples include employer-provided housing/canteen/car benefits). Benefits, reimbursements, termination amounts, casual/daily-paid tax tables and other special employee categories need rule-specific classification rather than an assumption that all compensation is ordinary monthly pay.

ZRA explicitly says allowable pension contributions are not deducted before chargeable income following the 1 January 2018 amendment. The page describes leaver/refund documentation (ITF/P13) and possible refunds where tax was overcharged, but this review did not establish a definitive monthly joiner/leaver proration method, tax-credit/relief catalogue, or payroll rounding instructions from a current primary source. Do not infer credits, annualize income, or prorate bands without a verified rule. ZRA says PAYE is remitted by the 10th of the next month with monthly return ITF/P16: [payment due dates](https://www.zra.org.zm/payment-due-dates/).

**Worked example:** chargeable pay K6,500 â†’ (K6,500 âˆ’ K5,100) Ã— 20% = **K280.00**. K12,500 â†’ K400 + K630 + (K12,500 âˆ’ K9,200) Ã— 37% = **K2,251.00**. These follow the published bands, before any separately verified special-category treatment.

## NAPSA â€” rate confirmed; 2026 application details need reconciliation

NAPSA's current [Formal Sector Contributions](https://www.napsa.co.zm/self-service/formal-sector) page, accessed 28 October 2026, says 10% of gross earnings split 5% employee and 5% employer, with a published monthly ceiling of K28,920.30 (maximum combined contribution K2,892.03), and payment by the 10th of the following month. It describes formal-sector coverage and full-/part-time workers. Its [contribution guidance](https://www.napsa.co.zm/self-service/contributions) lists pension earnings such as salary, bonuses, commission, severance, overtime allowance, leave allowance, acting allowance and commuted leave days.

**Material 2026 legal change:** NAPSA's publications list the [National Pension Scheme Act No. 72 of 2026](https://www.napsa.co.zm/download/publication/Act_No_72_The_National_Pension_Scheme_Act) (assented 4 June 2026) and its [2026 FAQ](https://www.napsa.co.zm/download/publication/NAPSA_Pension_reforms_FAQs_V04). NAPSA states that SI No. 62 of 2026 brought the reforms into effect; its 7 August 2026 [notice](https://www.napsa.co.zm/news/details?id=dt91c3bb-5416-4a53-b521-73923e0ccf112) confirms implementation. The Act text describes earnings broadly (wages, salary, allowance, bonus, commission, incentive and monetary non-cash benefits), requires each employer to contribute for its own concurrent employment, and sets a tenth-of-following-month remittance deadline. The FAQ says the 10% total rate remains split equally but the minimum earnings threshold is prescribed by the Minister.

The current contribution webpage does not reconcile its K28,920.30 cap, â€œgross earningsâ€ label, or coverage summary against the new Act/SI for each 2026 payroll period. The new statutory threshold and any effective-dated cap/basis details have not been independently resolved here. Therefore, 5% + 5% is supported as the published rate, but **do not activate NAPSA payroll computation or finalization** until NAPSA confirms the applicable earnings components, minimum threshold, ceiling, categories/exemptions, and effective dates under Act 72/SI 62. Do not stop contributions solely because of retirement age.

## NHIMA â€” rate confirmed; contribution base is contradictory

NHIMA's current [FAQ](https://www.nhima.co.zm/elementor-1783/), accessed 28 October 2026, says formal-sector contributions are 1% of the employee's â€œdeclared incomeâ€ and 1% employer contribution from â€œbasic salaryâ€; premiums are due by the 10th of each month. The FAQ refers to employee registration within 30 days under section 13 of the National Health Insurance Act 2018. NHIMA's [2022 newsletter](https://www.nhima.co.zm/download/document/dc79822b1e202201077c54f895.pdf) instead describes employee and employer contributions on declared income, while other NHIMA material has described both on basic salary. These official materials conflict about the base.

The contribution rate of 1% per side is consistently published, but this review did not establish a definitive 2026 legal base, ceiling, exemptions, special employment categories or a post-amendment effective rule from a primary legal instrument. Do not select â€œdeclared incomeâ€ or basic salary by inference. **NHIMA must confirm the base and applicability in writing or an authoritative current instrument before the rule can be activated.** The engine must keep employee and employer bases independently configurable and versioned.

## Other earnings and employment rules

- **Overtime:** ZRA treats overtime as PAYE emoluments. The Employment Code Act No. 3 of 2019 is available from the [Ministry of Labour](https://www.mlss.gov.zm/wp-content/uploads/2023/07/The-Employment-Code-Act-No.-3-of-2019.pdf). Its overtime rates, coverage, ordinary-hours limits, divisor, public-holiday/rest-day handling, exemptions, and amendments must be evaluated against the employee's category and current contract before calculation. Do not derive overtime solely from attendance.
- **Gratuity:** section 73 of the Employment Code Act states not less than 25% of basic pay earned during a long-term contract, paid at contract end, and prorated on qualifying termination. Eligibility and exclusions (including management/sector exceptions), payment timing, and interaction with other benefits require case-specific legal validation. Keep gratuity separately configured; do not treat it as monthly ordinary earnings by default.
- **Leave:** no universal monthly deduction formula is activated. Paid/unpaid leave, annual-leave payment events, overlapping attendance and leave, contract class, and calculation divisor require verified policy/legal handling. Avoid duplicate absence deductions.
- **Rounding:** the cited regulator pages/examples do not specify the engine's per-component versus final-total rounding rule or all tie-breaking details. Use decimal arithmetic and record the chosen cents rounding in rule metadata only after a payroll specialist confirms it.

## Activation and implementation recommendation

1. Keep rule versions immutable, jurisdiction- and code-specific, with effective dates, source URL/document hash, verifier, verification timestamp, and explicit bases/allowance treatment/limits/rounding metadata.
2. PAYE 2026 ordinary monthly bands can be represented from the official ZRA schedule. Taxable emoluments still require component classification and special-category checks.
3. Keep NAPSA and NHIMA rules **unverified and inactive** until the unresolved points above are confirmed. A trial calculation may show gross inputs and blockers but must not present provisional contributions as authoritative.
4. Payroll finalization must require verified active versions for PAYE, NAPSA and NHIMA covering the complete payroll period, plus approved input records and version-bound approval. A missing/ambiguous rule blocks finalization.
5. Re-verify official sources for every tax year and material legal change; keep the rule data and calculation explanation with each immutable payroll snapshot.

