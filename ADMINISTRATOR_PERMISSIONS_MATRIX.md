# Administrator Permissions Matrix

Migration `20261031004900_unified_administrator_capabilities.sql` is applied to development project `jssuaebiizjcoqmngxzk` (remote migration version 049). Database catalog/grant checks passed. Signed-in parity tests are still outstanding.

| Capability | Portfolio `PORTFOLIO_ADMIN` | Portfolio `COMPANY_ADMIN` | Company-scoped `COMPANY_ADMIN` |
|---|---|---|---|
| Company and branch management | Within own portfolio | Same capabilities within own portfolio | Assigned company only |
| Employee, HR, attendance and leave | Within own portfolio | Same capabilities within own portfolio | Assigned company/branches under existing RLS |
| Compensation and sensitive records | Permission-gated and scoped | Same capabilities and scope checks | Company-scoped; sensitive permission checks remain |
| Payroll preparation/submission | Authorized resources; separation rules apply | Same capabilities; separation rules apply | Assigned company only |
| Payroll review/approval/finalization | Authorized resource and workflow checks | Same capabilities; independent approval remains required | Assigned company and existing independent approval controls |
| User and role administration | Within own portfolio | Same capabilities within own portfolio | Company/branch assignments only; no portfolio elevation |
| Remove last active administrator | Denied by guard | Denied by guard | Denied by guard |
| Cross-portfolio access | Denied | Denied | Denied |

## Security model

- Migration 049 shares the permission catalog between portfolio-level `PORTFOLIO_ADMIN` and `COMPANY_ADMIN`; it does not create a global administrator bypass.
- Resource scope still derives from authorized portfolio membership, exact company membership, active branch assignment and RLS.
- Company-scoped administrators cannot acquire portfolio scope by supplying another portfolio/company identifier.
- Payroll submitter/reviewer separation and self-review protections remain in the database workflow.
- Sensitive employee and compensation fields continue to require explicit permissions.
- Last-active portfolio/company administrator removal is protected by database triggers.

## Verification status

- Remote migration history includes 049; authenticated execution grants are present and anonymous execution is denied for the checked RPCs.
- RLS was enabled on all 52 public tables after migration; public policy count remained 51.
- Local isolated restore/migration tests passed and existing data/audit fingerprint remained unchanged.
- No QA membership assignments were changed and no authenticated PostgREST tests were performed. Functional parity across two live identities remains unverified.
