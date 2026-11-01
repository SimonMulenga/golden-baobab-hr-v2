# Client Handover Checklist

## Release identity

- [x] Existing GitHub repository and branch retained.
- [x] Production commit `9a0095bcff4f6071af37083fd782f81535e4bac3` identified.
- [x] Existing Vercel project deployment `dpl_9d68j4NA2Xmbo6KnztRWme2aGAEb` is READY at <https://golden-baobab-hr-v2.vercel.app>.
- [x] Production HTML and compiled bundle returned HTTP 200; bundle referenced Supabase project `jssuaebiizjcoqmngxzk`.
- [x] Supabase read-only migration history matched local migrations through 053.
- [x] Public browser smoke: sign-in/recovery shell and signed-out route guards passed in Microsoft Edge (22 checks).
- [x] Sign-in shell overflow checks passed at 320–1920px and landscape.
- [x] Post-deployment public browser smoke passed 22/22.

## Before client operation

- [ ] Run signed-in role tests for Portfolio/Company Administrator, Overall HR, Branch Manager, payroll preparer and independent approver.
- [ ] Verify company and branch isolation with two synthetic tenants through authenticated Supabase requests.
- [ ] Complete company, branch, employee onboarding/import, attendance, leave, draft payroll, submission, independent approval, payslip and report rehearsal using synthetic records.
- [ ] Verify private employee document and sensitive report access under RLS.
- [ ] Confirm invitation, password activation and payslip delivery behavior with controlled test recipients.
- [ ] Complete authenticated module viewport/browser checks at 320, 375, 390, 430, 768, 1024, 1280, 1440 and 1920px.
- [ ] Obtain written confirmation of applicable NAPSA 2026 contribution ceiling/effective period and NHIMA filing-base interpretation.
- [ ] Create a fresh encrypted backup after migration 053 and complete an isolated restore including required Auth, Storage, roles and managed dependencies.
- [ ] Agree backup schedule, secure storage, retention and restore owner; Free plan has no scheduled database backups.
- [ ] Provide named client administrator account(s), least-privilege roles, and user training.

## Decision

**NO-GO pending the unchecked acceptance gates above.** Build and unit/component suite passing are necessary but not sufficient evidence for live payroll and tenant-safe client operation.
