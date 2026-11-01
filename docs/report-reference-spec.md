# Payroll and compliance report reference notes

The client reference files are examples of the report types, presentation and useful fields. Their sample employee count and column count do not limit generated reports. Each report is built from every employee line in the selected finalized payroll run for its company and branch. Payment-method reports include only employees on that payment method. Source files and sample data remain local and excluded from Git.

## Report scope and data source

- Reports use the selected immutable finalized payroll run and calculation version. They do not recalculate payroll.
- Company, branch, payroll period and employee count come from the selected run and its authorized records. Branch selection filters available runs; choosing a run fixes the exact branch scope shown in the preview and export.
- The report builders process the full selected run when exporting. The preview is paged in the same 100-employee slices as the payroll service.
- Export access is authorized and audited through the existing report RPC. Private statutory identifiers and payment details are read through the authenticated Supabase client and existing RLS.
- NAPSA and NHIMA output is an internal contribution schedule using saved employee/employer amounts. It is not represented as an official regulator upload format.
- PAYE output includes only fields available from the persisted payroll snapshot and authorized employee data. It does not invent tax credits or adjusted-tax amounts that are not saved.

## Reports

| Report | Included records and fields | Validation / limitation |
|---|---|---|
| NAPSA Contributions | One row for each selected payroll employee with employee number/name, NAPSA identifier, employee contribution, employer contribution and combined amount. CSV column count is descriptive, not fixed to the example. | Requires authorized private statutory details, a NAPSA identifier, employee identity and saved contribution amounts. Internal schedule only; external submission mapping must be confirmed separately. |
| NHIMA Contributions | One row for each selected payroll employee with employee number/name, NHIMA identifier, employee contribution, employer contribution and combined amount. CSV column count is descriptive, not fixed to the example. | Requires authorized private statutory details, an NHIMA identifier, employee identity and saved contribution amounts. Internal schedule only; external submission mapping must be confirmed separately. |
| PAYE Schedule | One row per selected payroll employee with employee number, name, TPIN, employment nature, gross emoluments, chargeable emoluments and saved PAYE. | Requires TPIN, employment nature and employee identity. Unsupported tax-credit or tax-adjustment values are not fabricated. |
| Leave Days | One row per employee in the selected payroll run. Shows accrual, paid leave, adjustments and ledger balance through the payroll period end. | No B/F column. No value is shifted into accrual. Days-sold and monetary-equivalent values are omitted because the ledger does not store them. Balance is the sum of branch ledger movements through period end. |
| Bank Payroll | Bank-transfer employees only; employee number, name, NRC, branch, account name/number as present in authorized data, and finalized net amount. | Requires complete bank and identity data. Identifiers/account numbers are exported as text to preserve leading zeroes. Export does not initiate payment. |
| Cash Payroll | Cash employees only; earnings, statutory and general deductions, total deductions and finalized net amount. | Deductions reconcile to the finalized gross and net values. The report does not acknowledge receipt or mark an employee paid. |
| Loans & Advances | Selected payroll employees' active/approved loan or advance records, scheduled installment from the finalized snapshot, principal, recovered-to-date and outstanding amount. | Scheduled installment is matched by deduction ID to prevent duplicate recovery lines. Recovered/outstanding are current deduction-record balances, not a historical as-of snapshot. |
| Master Payroll | Every selected payroll employee, with saved basic pay, each available allowance class, overtime, other earnings, gross, employee/employer statutory contributions, other deductions, net and employer cost. | Values are from the immutable payroll snapshot. Categories not separately saved are not fabricated or re-labelled. |
| Mobile Money Payroll | Mobile-money employees only; employee number/name, provider, registered recipient number and finalized net amount. | Internal payment instruction report only. Does not initiate or confirm a transfer. Recipient fields require sensitive-data access. |

## Migration and deployment

Migration `20261101005300_audited_payroll_report_exports.sql` defines report authorization and metadata-only audit. It is applied to development project `jssuaebiizjcoqmngxzk`. Production remains a separate deployment action. Original references, employee spreadsheets and generated report files must never be committed.
