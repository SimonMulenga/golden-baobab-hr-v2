-- Run only on a disposable Supabase test database after migrations 00100/00200.
-- Uses synthetic identities/records and rolls everything back.
begin;
select extensions.plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'portfolio-admin@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'branch-manager@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'payroll-processor@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-portfolio-hr@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'explicit-platform-admin@test.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unassigned@test.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, display_name)
select id, 'Synthetic ' || id::text from auth.users
where id between '00000000-0000-0000-0000-000000000001'::uuid and '00000000-0000-0000-0000-000000000006'::uuid;

insert into public.client_portfolios (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Synthetic portfolio A'),
  ('10000000-0000-0000-0000-000000000002', 'Synthetic portfolio B');

insert into public.portfolio_memberships (portfolio_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'PORTFOLIO_ADMIN'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'BRANCH_MANAGER'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'PAYROLL_PROCESSOR'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'OVERALL_HR_MANAGER');

insert into public.platform_administrators (user_id, granted_by) values
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001');

insert into public.companies (id, portfolio_id, name, registration_number, tpin, industry, business_email, phone, province, town, physical_address, contact_person) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Synthetic A1', 'REG-A1', '1000000001', 'Retail', 'a1@test.invalid', '+260000000001', 'Lusaka', 'Lusaka', 'Demo address 1', 'Demo Contact'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Synthetic A2', 'REG-A2', '1000000002', 'Retail', 'a2@test.invalid', '+260000000002', 'Lusaka', 'Lusaka', 'Demo address 2', 'Demo Contact'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Synthetic B1', 'REG-B1', '1000000003', 'Retail', 'b1@test.invalid', '+260000000003', 'Lusaka', 'Lusaka', 'Demo address 3', 'Demo Contact');

insert into public.branches (id, portfolio_id, company_id, name, code, province, town, physical_address) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A1 branch 1', 'A1-1', 'Lusaka', 'Lusaka', 'Demo branch 1'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A1 branch 2', 'A1-2', 'Lusaka', 'Lusaka', 'Demo branch 2'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'A2 branch 1', 'A2-1', 'Lusaka', 'Lusaka', 'Demo branch 3'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'B1 branch 1', 'B1-1', 'Lusaka', 'Lusaka', 'Demo branch 4');

insert into public.branch_assignments (portfolio_id, company_id, branch_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'BRANCH_MANAGER'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'PAYROLL_PROCESSOR');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select extensions.is((select count(*) from public.companies), 2::bigint, 'portfolio admin sees companies in own portfolio only');
select extensions.is((select count(*) from public.branches), 3::bigint, 'portfolio admin sees branches in own portfolio');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.is((select count(*) from public.companies), 1::bigint, 'branch manager sees only company with an assigned branch');
select extensions.is((select count(*) from public.branches), 1::bigint, 'branch manager sees only assigned branch');
select extensions.is(app_private.has_permission('employee.submit', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), true, 'branch manager can submit within assigned branch');
select extensions.is(app_private.has_permission('employee.submit', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'), false, 'branch manager cannot submit into another branch');
select extensions.is(app_private.has_permission('employee.view', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004'), false, 'branch manager cannot cross into another portfolio');
select extensions.is(app_private.has_permission('employee.approve', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), false, 'branch manager cannot approve employee onboarding');
select extensions.is(app_private.has_permission('payroll.approve', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'), false, 'branch manager cannot approve payroll');
select extensions.throws_ok(
  $$insert into public.portfolio_memberships (portfolio_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'PORTFOLIO_ADMIN')$$,
  '42501', 'branch manager cannot self-assign a higher role');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.is((select count(*) from public.branches), 1::bigint, 'payroll processor is limited to assigned branch');
select extensions.is(app_private.has_permission('payroll.prepare', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'), true, 'payroll processor can prepare assigned branch payroll');
select extensions.is(app_private.has_permission('payroll.approve', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'), false, 'payroll processor cannot approve payroll');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select extensions.is((select count(*) from public.companies), 1::bigint, 'overall HR user is isolated to own portfolio');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
select extensions.is(app_private.has_permission('company.view', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null), false, 'platform role does not grant customer data permission by itself');
select extensions.is((select count(*) from public.companies), 0::bigint, 'platform administrator receives no customer company access by default');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
select extensions.is((select count(*) from public.companies), 0::bigint, 'authenticated user without membership receives no company access');

reset role;
update public.portfolio_memberships set revoked_at = now()
where portfolio_id = '10000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-000000000002'
  and role = 'BRANCH_MANAGER';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.is((select count(*) from public.companies), 0::bigint, 'revoked portfolio membership immediately removes access');

select * from extensions.finish();
rollback;

