# Payroll and compliance report reference specification

This document records structure only. Supplied source workbooks and CSV files are local reference artifacts and must remain untracked; no sample employee values are reproduced here.

## Compliance references

| Reference | Observed structure | Implementation decision |
|---|---|---|
| NAPSA CSV | Headerless; every non-empty sample row has 12 positional fields. One optional text position is blank in several rows. | Export is disabled until the client supplies the meaning/order of the 12 positions. The file itself does not label them, and field semantics cannot be confirmed from shape alone. |
| NHIMA CSV | Headerless; every non-empty sample row has 12 positional fields. One optional position is blank in several rows; a date-shaped field appears in the row. | Export is disabled until the client supplies the meaning/order and date-field semantics of the 12 positions. No header or generic authority template is substituted. |
| PAYE workbook | One worksheet with data table A1:H21. Exact header row: `tpin`, `fullName`, `employmentNature`, `grossEmoluments`, `chargeableEmoluments`, `totalTaxCredit`, `taxDeducted`, `taxAdjusted`. Numeric monetary columns use two-decimal formats. The sample includes populated non-zero tax credits and zero-valued adjusted tax. | Exact headings are encoded in the report model. Export remains blocked because finalized payroll does not persist `totalTaxCredit`; substituting zero would contradict the sample. An additive payroll calculation/snapshot field and approval rule is required before a compliant export can be enabled. |

## Payroll references

| Reference / worksheet | Header row and observed columns | Data mapping and gaps |
|---|---|---|
| Leave Days / `LeaveDays` | Row 9: `EMP #`, `EMP NAME`, `B/F DAYS`, `ACCR DAYS`, `DAYS TAKEN`, `DAYS SOLD`, `BAL DAYS`, `MONEY EQUIV`. | The required client change removes `B/F DAYS`. The live leave ledger supports accrual, paid leave, adjustments and current balance. It has no “days sold” event, and the sample contains no formula to derive the revised balance without B/F. Leave export is blocked pending an approved replacement calculation and a days-sold data decision; B/F will not be transferred into accrued days. |
| Bank Payroll / `earningSummary1` | Row 17: `NAME`, `NRC NO.`, `BRANCH NAME`, `ACCOUNT NO.`, `AMOUNT`; sample also has a `TOTAL` label at the bottom. | Data comes from finalized net pay, employee name, active branch, and RLS-protected identity and bank details. The report is restricted to Bank Transfer employees. Account/name/NRC values remain text to preserve leading zeroes. Total is the sum of eligible net pay. |
| Cash Payroll / `earningSummary1` | Row 13: `#`, `EMP NO`, `NAME`, `TOTAL EARNINGS`, `STAT DEDUCTIONS`, `GEN DEDUCTIONS`, `TOTAL DEDUCTIONS`, `NET PAY`. | Data comes from the immutable finalized payroll line and private payment method. Statutory employee deductions are PAYE + employee NAPSA + employee NHIMA; general deductions are reconciled to gross less net. Export does not mark receipt or payment. |
| Loans & Advances / `generalDeductionSummary` | Row 13: `EMP NO.`, `NAME`, `DEDUCTION NAME`, `MONTHLY AMT`, `INITIAL AMT`, `OUTSTANDING AMT`. | Principal, amount recovered, status and due repayment come from actual approved deduction records and the finalized payroll snapshot. Monthly amount is matched by deduction ID in the payroll calculation breakdown. No deduction is posted by report generation. |
| Master Payroll / `earningSummary1` | Row 11 includes `BASIC PAY`, `CONSULTANCY FEE`, `GRATUITY`, `HOUSING ALLOWANCE`, `MEAL ALLOWANCE`, `TRANSPORT ALLOWANCE`, `TOTAL EARNING`, `NAPSA`, `NATIONAL HEALTH`, `PAYE`, `WHT`, `EDUCATION ADVANCE`, `MEDICAL ADVANCE`, multiple `SALARY ADVANCE` columns, `TOTAL DEDUCTIONS`, `NET PAY`. | The immutable line snapshot has totals for several categories but does not retain each separate earning, WHT, or the distinct advance columns represented in the sample. The report is blocked rather than filling unsupported categories with zero or relabelling an aggregate. A snapshot extension must retain component categories before export is safe. |
| Mobile Money Payroll | No client sample supplied; the client approved the proposed internal, non-statutory structure. | `EMP NO`, `EMPLOYEE NAME`, `PAYMENT PROVIDER`, `REGISTERED MOBILE NUMBER`, `NET PAY`. Uses finalized net pay and stored provider/recipient fields; requires sensitive-data permission, audits access, validates recipient data, and does not initiate or confirm a transfer. |

## Implementation scope currently supported

- Finalized payroll register uses the saved payroll version only.
- Bank Payroll, Cash Payroll and Loans & Advances have sample-heading models and validation functions. Sensitive/private queries use the authenticated Supabase client and existing RLS. Mobile Money Payroll uses the client-approved proposed structure and the same private-data controls.
- Export authorization and metadata-only audit are defined in additive migration `20261101005300_audited_payroll_report_exports.sql`. It was applied to the existing development project on 2026-11-01 after a fresh backup was verified and the migration passed an isolated restore test. Production deployment remains gated on the report-format and data gaps listed above.
- NAPSA, NHIMA, PAYE, Leave Days and Master Payroll remain explicitly blocked as described above.
- The original files are intentionally excluded from Git and must stay local/private.
