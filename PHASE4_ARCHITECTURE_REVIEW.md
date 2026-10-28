# Golden Baobab HR V2 — Phase 4A Multi-Company Architecture Review

**Review type:** Read-only architecture and frontend dependency review
**Workspace:** `C:\Project\golden-baobab`
**Branch:** `feature/supabase-auth`
**Database changes:** None. No SQL, schema, migrations, RLS changes, or remote project access were performed.

## Executive summary

The product decision is a company-first tenancy model. Companies are the highest business boundary. There is no organization entity, organization membership, organization role, or `organization_id` relationship in the target design. A user may have separate memberships in multiple companies; access is derived from those memberships and enforced by PostgreSQL RLS, never from a company ID selected or supplied by the browser.

The current app has no application database schema or database-backed domain services. Its HR and payroll records remain synthetic, browser-local state. Supabase Auth establishes identity only. The current organization concept is therefore a frontend/mock-data dependency, not an existing database migration that must be transformed.

The most important security design choices are:

- Store one membership per user and company, with a company-scoped role and an explicit branch scope.
- Keep platform super-admin grants in a separate, tightly protected registry. Do not put this role in user metadata or the company-role list.
- Bootstrap company creation and the first company administrator through an approved trusted flow, not a client-side membership insert.
- Enable RLS with no permissive policies in the initial schema baseline; add and test policies in later, separately approved changes.

## 1. Current frontend dependencies

### Organization-related UI and state

| Area | Current dependency | Compatibility impact |
|---|---|---|
| Navigation and route | `src/App.tsx` has an Organizations nav item and `/organizations` route; it lazy-loads `OrganizationOverview`. | Remove the nav/route after approval. Consider redirecting old `/organizations` bookmarks to `/companies` for one transition period. |
| Workspace state | `WorkspaceContext` exposes `organizations` and `saveOrganization`; `App.tsx` stores `gbhr-organizations` in localStorage. | Remove organization state and storage writes. Preserve existing company/employee local demo records during any later data-shape adjustment. |
| Company type | `Company.organizationId` is required. `Organization` contains a `companyIds` array. | Remove the company field and model; company ownership no longer depends on a parent organization. |
| Company mock data | Six synthetic companies carry `organizationId`; three synthetic organizations point back through `companyIds`. | Remove organization assignments and the mock organization collection. Existing examples are synthetic and no backend data migration is involved. |
| Organization overview | `CompanyScreens.tsx` renders organization counts/cards and supports mock create/edit. | Remove the screen and its organization-only state/actions. Company directory/profile remain. |
| Company directory | Organization filter, `?organization=` query value, organization table column and card label. | Remove the organization filter and column/label. Keep search, industry, status, views, and company actions. |
| Company create/edit | Organization is required; new companies default to the first organization. | Remove this field/default/validation. The first company owner/membership must instead come from the approved onboarding flow. |
| Company profile | Displays the parent organization in the hero and overview details. | Remove the parent reference; keep company information, branches, employee counts, and activity. |
| Dashboard and copy | Dashboard has organization totals and “across organizations” wording. Other screens use “organization” as a generic workspace word. | Remove organization metrics and replace only where the copy still claims an organization model. Keep neutral “workspace” phrasing where accurate. |
| Permissions demo | `AdminScreens.tsx` defines `Organization Super Admin`, grants it every simulated permission, and represents all-company access with `companyIds: ['all']`. | Replace the demo role with a distinct platform-admin concept and company-scoped membership previews. This is UI simulation only today; it currently grants no real security. |
| Supporting documentation | `BACKEND_SETUP.md` still describes organization-to-company ownership and organization-based isolation. `FRONTEND_PROGRESS.md` lists the Organizations route. | Update both after the model refactor is approved; do not let these descriptions become the future database specification. |

`CatalogScreens.tsx` uses “organization structure” as a department heading. This appears to be copy, not an organization foreign key. Reword it to company/people structure if that matches the final product language.

### Company, branch, workspace, and employee model

- `Company` currently embeds `branches: Branch[]`, has a denormalized `employeeCount`, and requires `organizationId`. The TypeScript `Branch` has no `companyId`; its parent is implicit in the containing company.
- `Employee` already contains `companyId` and `branchId`, with no organization field. This aligns with company-first ownership but does not enforce that the branch belongs to the same company.
- `WorkspaceContext` owns all companies and one `activeCompanyId`; the switcher persists that ID in `gbhr-active-company` and includes an `all` sentinel. This is presentation state, not authorization.
- `EmployeeContext` and the app shell hold mock arrays in browser memory/localStorage. Several screens filter these arrays in the browser by `companyId`, `branchId`, and the active-company sentinel.
- Branch CRUD edits the nested company object. A future database repository will need to map separate branch rows into the current profile view or change the view model after approval.
- The dashboard’s company/employee totals are fixed synthetic figures. They do not establish a company limit or reflect database capacity.

### Authentication and service contracts

- `AuthProvider` and `auth-service.ts` use Supabase Auth for identity, session restore, sign-in/out, and recovery. There is no profile, membership, or tenant-authorization lookup in the auth context.
- LIVE route protection checks whether a session exists. It does not assert access to the selected company.
- `src/services/contracts.ts` contains an `OrganizationsService` and imports the `Organization` model. `CompaniesService`, `BranchesService`, and `EmployeesService` are typed interfaces only; there are no database operations or service implementations.
- Attendance records carry `branchId` but not `companyId`; payroll summaries carry `companyId`. Tenant queries will need a consistent company key on tenant-owned rows, and branch-specific relationships must prove that the branch belongs to that same company.

### No current organization database dependency

No application migration/schema was found in the inspected source tree. The organization model exists in TypeScript, synthetic mock data, UI, localStorage, and documentation only. Supabase authentication data is separate from those mock records.

## 2. Proposed company-first architecture

```text
auth.users
    └── profiles (same user UUID)
          ├── company_memberships ── companies
          │        └── membership_branch_access ── branches
          └── platform_administrators (separate SaaS-wide grant)

Tenant-owned business rows carry company_id.
Branch-owned rows also carry branch_id and enforce the same-company pair.
There is no organizations table or organization_id.
```

Company membership is a many-to-many relationship: a user can hold memberships in any number of companies, and each company can have any number of users. The schema introduces no company-count field, bounded enum, fixed company list, or company-per-user limit. Physical service capacity remains subject to the chosen Supabase/PostgreSQL plan and operational design.

The company selector should list companies through the authenticated user’s active memberships, with pagination/search when needed. Its selected company ID is a query filter and UI context only. Every API query and RLS policy must independently prove membership; changing the selector or request parameter must not add access.

## 3. Proposed minimum viable database schema

These are design proposals, not executable SQL. Use UUID primary keys. Tenant-owned tables carry explicit company ownership. Keep the first role set fixed and avoid customer-defined permission editors until there is a validated requirement.

| Relation | Proposed columns and constraints | Purpose |
|---|---|---|
| `profiles` | `id` PK and FK to `auth.users.id` with cascade on user deletion; `display_name`; timestamps. No platform/company role column. | App-facing profile linked one-to-one to the Supabase Auth identity. Email and credential state remain owned by Auth. |
| `companies` | `id` PK; `name`; registration/TPIN fields as nullable where appropriate; status; `created_by` FK to `profiles.id`; timestamps. Optional unique registration/TPIN constraints only after confirming actual uniqueness and nullability rules. | Top-level business tenant. No parent organization. Prefer archive/status transitions over destructive deletes once records exist. |
| `branches` | `id` PK; `company_id` FK to `companies`; name, code, status, address/contact fields, timestamps; unique `(company_id, code)` and unique `(company_id, id)` for composite references. | A company may have any number of branches. Branch identity is always paired with its owning company. |
| `company_memberships` | `id` PK; `company_id` FK; `user_id` FK to `profiles.id`; fixed `role_key`; active/revoked status; `branch_scope` (`all` or `selected`); `created_by`; timestamps. Unique `(company_id, user_id)` and `(company_id, id)`. | Authorization source for a user’s company access and role. Multiple rows per user are expected, one per authorized company. No `all companies` membership sentinel. |
| `membership_branch_access` | `company_id`, `membership_id`, `branch_id`; primary/unique key over membership and branch. Composite FKs bind the membership and branch to the same company. | Normalized branch allowlist for memberships with `branch_scope=selected`. Company-wide memberships use `all` and do not need a row per branch. |
| `platform_administrators` | `user_id` PK/FK to `profiles.id`; granted-by identity, grant time, optional revoke time/reason. No `company_id`. | Explicit SaaS platform administrator registry, separate from tenant roles. Ordinary users cannot add or change these rows. |

### Roles and permissions

For the MVP, use a fixed company-role catalog in trusted database authorization helpers and a matching frontend display map. Store only the role key on each company membership. Do not accept a permission array, role claim, or company list from user metadata. Keep the permission map version-controlled with policy/helper changes. This avoids premature customer-editable roles and privilege-bearing JSON.

Suggested fixed company roles: `company_admin`, `hr_manager`, `hr_officer`, `payroll_officer`, `payroll_approver`, `branch_manager`, and `read_only`. There is deliberately no `organization_admin` role. `platform_super_admin` is not a company role; it comes only from the protected platform-admin registry.

Role permissions should be least-privilege and module/action based: employee read/edit; compensation read/edit; attendance and leave read/manage; payroll prepare/review/approve; reports view/export; company/branch management; and membership management. For example, a payroll officer may prepare a run but not approve it; a payroll approver may review/approve but not edit compensation; an HR officer need not see compensation. Final permissions require product approval. Every permission must be checked in RLS or a trusted server function, even if the UI hides its button.

If per-company custom roles are later required, add a tenant-scoped `company_roles` table and a constrained role-permission relation in a later design. Do not allow company admins to create arbitrary permission strings in the MVP.

### Company creation and onboarding

1. A user account is provisioned through the approved private account workflow; public self-registration remains disabled.
2. A trusted, authorized onboarding operation creates the company and its initial `company_admin` membership together, atomically. It must not leave a company with no owner if one insert fails.
3. The company admin creates branches and assigns existing/provisioned users company roles and branch scopes through a trusted, audited operation.
4. User invitations, if required, need a separate secure invitation/account-provisioning design. Do not use a browser service-role key or create Auth users directly from client code.
5. Company switching is populated from the caller’s active memberships. Membership does not imply access to other companies owned by the same people or with similar names.

Whether company creation is platform-admin-only, approved self-service, or handled by an internal operator is unresolved and must be decided before implementation.

## 4. Tenant ownership, membership, and branch scope

- Every future tenant-owned row should include `company_id`, even if it can also be reached through an employee, branch, payroll run, or report. This makes ownership explicit for RLS and indexes.
- Rows with a branch must have both `company_id` and `branch_id`. A composite FK to `(branches.company_id, branches.id)` prevents accidentally attaching a company A employee/record to company B’s branch.
- Company-level rows with no meaningful branch can use nullable `branch_id`; RLS then applies company membership but no branch allowlist test. The exact treatment of payroll runs spanning branches should be specified per table.
- A user’s access to two companies is represented by two active `company_memberships` rows. Do not store `company_ids` in a profile column, JWT custom claim, browser storage, or client-owned array.
- The company selector’s current `all` option is only a view convenience. In the database it means “aggregate only over the companies returned by this user’s authorized memberships,” never “skip the company predicate.”
- Company IDs are identifiers, not capabilities. A guessed/modified ID must yield no data and no write permission.

## 5. RLS policy design

RLS must be enabled on every exposed tenant table. Start with no policies (default deny); add only the policies required by tested operations. Use `auth.uid()` as the identity source. Do not trust app-supplied user IDs, company IDs, role names, or `user_metadata` for authorization.

### Proposed checks by table/action

| Data/action | Policy shape |
|---|---|
| Company read | Allow an active membership for `auth.uid()` in that exact `companies.id`, or a separately approved platform-admin operation. A selected company ID alone grants nothing. |
| Company update | Require an active `company_admin` membership for the row’s exact company; prohibit changing the tenant primary key. Archive/delete should be separately restricted. |
| Company creation | Deny ordinary direct table inserts. Use a narrowly scoped trusted onboarding function that validates caller eligibility and creates company plus first admin membership atomically. |
| Branch read/write | Require membership in `branches.company_id`. Writes require the company’s branch-management permission. Branch-limited roles must have that exact branch in `membership_branch_access`; company-wide membership can access all branches in that company. |
| Business-row select | Require an active company membership matching row `company_id`; if row has a branch and the membership is branch-scoped, require an exact same-company branch assignment. |
| Business-row insert/update | Apply the same checks in `WITH CHECK` as in `USING`; additionally require the action permission for the role. Prevent moving a row between companies or to an unassigned branch. Prefer immutable tenant keys. |
| Membership read | A user can read their own membership. An authorized company access manager can read memberships in that same company. No unrelated-company membership visibility. |
| Membership insert/update/revoke | Do not permit self-membership, self-promotion, or client-selected arbitrary roles. Use a constrained operation that checks the actor’s active company-admin permission, target company, assignable roles, branch scope, and audit requirements. It must reject `company_id` changes and self-grants. |
| Platform administrator registry | Default deny to ordinary authenticated clients and company admins. Grant/revoke only through a separate trusted platform-admin process/function, with an explicit out-of-band bootstrap for the first administrator. Never derive this grant from a profile field, company membership, or Auth user metadata. |

### Policy implementation cautions

- Centralize authorization predicates in narrowly granted database functions if needed to avoid recursive membership RLS. Any `SECURITY DEFINER` function must set a safe fixed `search_path`, validate every argument, avoid dynamic SQL, expose only required execution privileges, and have dedicated negative tests.
- Company admins can manage only their own company. A platform super-admin is not automatically entitled to read payroll or employee data; default platform operations to SaaS administration only. If support access is required, define a separately approved, time-bound, purpose-bound, audited break-glass path.
- Role updates must compare the actor and target membership. A company admin may be authorized to promote another member only if product rules explicitly allow it; a user must never promote themselves. A company role can never create a platform-admin registry row.
- Evaluate active membership from current database rows on each request, not JWT custom claims or cached membership arrays. Revocation then affects subsequent statements without waiting for token renewal.
- Apply equivalent tenant and branch checks to views, RPCs, Storage objects, Realtime subscriptions, and any Edge Function. An RLS-protected base table does not make an unprotected view or privileged function safe.

## 6. Safe migration sequence

No migration files or executable SQL are included in this review. Every migration below requires explicit approval before it is prepared/applied; this document is not approval to make one.

### Checkpoint 0 — Confirm target and history

- Provision/identify the fresh V2 Supabase project explicitly; verify its project reference and environment with the owner.
- Confirm it is not a prior Golden Baobab project. Do not rely on a display name alone.
- Read the repository migration manifest and the remote migration history read-only. Compare versions/checksums and confirm the expected empty/fresh baseline before any apply.
- If history differs, the target is ambiguous, or the project is not empty as expected, stop for owner review. Never reset the database to make histories match.

### Checkpoint 1 — Schema baseline, deny by default

After a separate approval, create only the identity/profile, company, branch, membership, branch-scope, and platform-admin structures with primary/foreign keys and tenant indexes. Enable RLS on exposed tables in this baseline but add no permissive access policies yet, leaving them denied. Verify table definitions and constraints read-only, then test anonymous and ordinary user denial.

### Checkpoint 2 — Authorization helpers and read policies

After separate approval, add the fixed role/permission predicates and narrowly scoped read policies for own profile, own memberships, permitted companies/branches. Test negative company and branch access before moving on.

### Checkpoint 3 — Trusted onboarding and membership changes

After separate approval, implement the first-company bootstrap and constrained membership/branch assignment operations. Test role escalation and self-membership denial. Platform-admin bootstrapping remains an explicit out-of-band operator checkpoint.

### Checkpoint 4 — Domain tables in small batches

Only after the company isolation layer passes, add one domain area at a time (for example employee/department/role, then attendance/leave, then payroll). Each batch uses explicit company ownership, same-company branch FKs, RLS, query indexes, and isolation tests before the next area. This review does not authorize those changes.

### Apply, rollback, and recovery rules

- Keep small, ordered, version-controlled migration files on the feature branch. Review exact SQL, target project, current migration history, expected effects, and test evidence before each individually approved apply.
- Use a hosted, isolated non-production V2 project for applying and integration testing. No Docker, Prisma, local PostgreSQL, or frontend-startup migration process is required.
- Never run migrations during Vite startup/build, never auto-apply from Vercel, and never use a database reset as a repair technique.
- Before each change, capture a verified backup/recovery point where available and record the migration version/checksum. Stop on any unexpected remote history or schema drift.
- Prefer additive, forward-compatible changes. Use a down migration only if it is demonstrably non-destructive and approved. Otherwise write a forward-repair migration. Destructive changes require a separate impact review, backup verification, and explicit approval.
- Apply to production only in a later explicitly approved stage after isolated testing. No remote settings or database operations were performed for this review.

## 7. Isolation testing strategy

Use an isolated hosted Supabase V2 test project with synthetic users and records; issue requests with ordinary user JWTs for RLS tests. Do not use a service-role client for user-boundary assertions. Secure admin setup may provision test identities/fixtures but must not be mistaken for an application user’s privileges. This does not require a local PostgreSQL installation or Docker.

Minimum test matrix:

1. **Anonymous boundary:** anonymous requests cannot read or mutate profiles, companies, memberships, branches, or tenant rows.
2. **Own profile:** user A can read/update only allowed profile fields for A; cannot read or change B’s profile or privilege attributes.
3. **Multi-company membership:** user A has memberships in companies A and B; can access only A/B rows. User B’s company C remains invisible even when A supplies C’s UUID in filters, URL, inserts, joins, or RPC arguments.
4. **No-membership user:** an authenticated user with no active membership gets no company data and cannot create a membership for themselves.
5. **Company admin boundary:** admin in A can perform only allowed A operations and cannot inspect/change B memberships, branches, or business data.
6. **Role escalation:** direct self-promotion, membership creation, company-ID reassignment, unsupported role values, branch-scope widening, and platform-admin insertion all fail. Test both `USING` and `WITH CHECK` paths.
7. **Branch scope:** selected-branch member sees/changes only assigned branch data; other branches in the same company and all branches in another company are denied. A forged branch ID paired with another company fails both policy and composite FK checks.
8. **Revocation:** revoke membership while the same authenticated session remains active; the next request must stop seeing tenant rows without requiring a new JWT. Test branch assignment revocation too.
9. **Platform administrator:** ordinary user and company admin cannot self-grant or query/grant platform admin. A deliberately provisioned platform admin has only the explicitly approved SaaS-management capability; tenant data remains denied unless a separate break-glass rule is approved.
10. **Indirect surfaces:** repeat tenant-negative tests through joins, views, RPCs, reports, Storage paths, and Realtime channels as those surfaces are added.
11. **Constraints:** cross-company employee/branch references and duplicate `(company_id, user_id)` memberships fail; branch codes are unique only within the owning company.
12. **Query behavior:** validate tenant-scoped query plans and pagination against representative synthetic row counts; RLS correctness tests are not substitutes for performance checks.

Run tests before and after each policy migration, preserve failure evidence, and do not promote a migration while any cross-tenant negative case fails.

## 8. Scalability considerations

- The schema imposes no company-count cap. Company membership rows and branches grow as ordinary indexed relational data; actual capacity depends on database plan, row sizes, traffic, indexes, and operational limits.
- Use server-side filtering and cursor/keyset pagination. A default page size is a response-size control, not a maximum company or employee count. Do not load every company or employee into the browser.
- Suggested starting indexes include memberships `(user_id, status, company_id)` for the switcher and `(company_id, status, user_id)` for company administration; branches `(company_id, id)` and unique `(company_id, code)`; and per-domain tenant-leading indexes such as employees `(company_id, branch_id, id)` plus common status/name sort keys, attendance `(company_id, branch_id, work_date, employee_id)`, and payroll runs `(company_id, period_start, id)`. Validate actual query plans before adding indexes broadly.
- Put `company_id` first in indexes used by company-scoped queries and RLS predicates. Add `branch_id` next only for branch-filtered access patterns. Index child FK columns when joins/deletes/checks require them.
- Company switching should page through a membership-to-company join; do not keep a large company list in user metadata or require a schema change when new companies are created.
- Avoid full-table counts and unfiltered scans for dashboard totals. Use bounded company/date filters, suitable aggregates, and later a measured summary strategy if needed. Do not denormalize counts until their update and authorization semantics are clear.
- Keep company-owned foreign keys composite where necessary, so cross-company references fail at the database boundary rather than relying only on UI logic.
- Thousands of companies and thousands of employees per company are supported as a relational design goal, not a promise of unlimited physical capacity or zero operational tuning.

## 9. Risks and unresolved decisions

1. **Platform visibility:** Does platform super-admin manage subscriptions/configuration only, or ever access customer HR/payroll content? Recommended default: no tenant-content access; define audited break-glass separately if required.
2. **Company onboarding:** Is creation platform-admin-only, staff-assisted, or a self-service flow with an approved company owner? The first company admin cannot be created through ordinary self-service membership RLS.
3. **Account provisioning:** Public signup is disabled. Define who provisions a user and how company invitations map to Auth accounts before implementing membership administration.
4. **Role policy:** Approve the fixed MVP roles and action matrix. In particular decide whether company admins can assign another company admin, and whether one user may hold only one role per company.
5. **Branch scope semantics:** Confirm whether company admins are always all-branch, whether HR/payroll roles may be branch-limited, and how company-wide payroll runs interact with branch-limited approvers.
6. **Platform-admin bootstrap/recovery:** Define the first administrator, grant/revoke authority, emergency recovery, audit trail, and account offboarding without creating a self-escalation route.
7. **Company identifiers:** Confirm uniqueness/null rules for registration numbers and TPINs before constraints are chosen.
8. **Legacy local demo state:** Current localStorage may contain `gbhr-organizations` and companies with `organizationId`. Plan a tolerant demo-state normalization when the approved frontend refactor begins; do not delete existing browser data as part of this review.
9. **Compatibility changes:** Company form validation/defaults, directory query links, company profile labels, dashboard copy, organization route, role preview, and docs will change together. Removing only the route while retaining required `organizationId` would break company creation and listing.
10. **Existing repository state:** At inspection, `feature/supabase-auth` tracked `origin/feature/supabase-auth` and the source working tree was clean. This review adds only this architecture document.
11. **No live data services:** RLS design cannot be considered validated by current mock interactions. Authenticated access today is not tenant authorization.

## 10. Safe frontend removal/refactor plan (not executed)

After architecture approval, update the frontend in a compatibility-preserving sequence:

1. Add tests/fixtures for company creation, company filtering, branch display, company switching, and multi-company user previews with no organization fields.
2. Remove `Organization` and `Company.organizationId`, `mockOrganizations`, `OrganizationsService`, organization context data/actions, and the organization localStorage write. Normalize previously saved company objects by ignoring the obsolete property; do not erase company/employee demo records.
3. Remove the Organizations nav item, overview screen, and route. Decide whether `/organizations` temporarily redirects to `/companies`.
4. Remove organization filters/query state from the company directory; remove the organization requirement/default from company create/edit; remove parent labels from company cards/profile.
5. Replace dashboard organization metrics/copy and the simulated `Organization Super Admin` role. Represent platform administrators separately from company roles, and represent user access as explicit company memberships rather than `['all']`.
6. Preserve branches and employee workflows. Add `companyId` to a branch view model only if it helps UI/service boundaries; the persisted branch owner remains the relational `branches.company_id`. Ensure employee `companyId`/`branchId` always agree.
7. Keep mock contexts behind the same UI-facing service/view models so later live repositories can replace them without deriving authorization from localStorage.
8. Update backend setup/progress documentation and rerun TypeScript, tests, lint, and build after the approved refactor.

## 11. Recommended first implementation milestone

After approval, make **Phase 4B / Milestone 1** a project-and-schema-baseline checkpoint only: verify the fresh V2 project reference and empty migration history; review the exact schema proposal; then prepare one small migration for profiles, companies, branches, memberships, branch scope, and platform administrator registry with ownership constraints and RLS enabled but no permissive policies. Apply it only after its own explicit approval, and verify default denial before writing any read or write policies.

The frontend organization removal, company membership UI, RLS policies, onboarding functions, and domain tables should remain separate approved milestones. This review makes no changes to those systems.
