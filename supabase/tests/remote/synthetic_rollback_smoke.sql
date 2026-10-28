-- Development-project smoke test. Run only through an authorized Supabase DB
-- query session. Every fixture, including synthetic auth.users, is rolled back.
-- This exercises PostgreSQL grants/RLS/RPCs, not HTTP Auth or PostgREST JWTs.
begin;

do $$
begin
  if exists (select 1 from auth.users where id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555'
  )) or exists (select 1 from public.companies where registration_number like 'REMOTE-SMOKE-%') then
    raise exception 'Remote smoke-test fixture identifiers already exist; refusing to modify them.';
  end if;
end $$;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'portfolio-admin@remote-smoke.example.invalid', now(), '{}', '{}', now(), now(), false, false),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'overall-hr@remote-smoke.example.invalid', now(), '{}', '{}', now(), now(), false, false),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'branch-manager@remote-smoke.example.invalid', now(), '{}', '{}', now(), now(), false, false),
  ('44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'other-portfolio@remote-smoke.example.invalid', now(), '{}', '{}', now(), now(), false, false),
  ('55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'company-admin@remote-smoke.example.invalid', now(), '{}', '{}', now(), now(), false, false);

insert into public.profiles (id, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'Synthetic Portfolio Admin'),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic Overall HR'),
  ('33333333-3333-4333-8333-333333333333', 'Synthetic Branch Manager'),
  ('44444444-4444-4444-8444-444444444444', 'Synthetic Other Portfolio Admin'),
  ('55555555-5555-4555-8555-555555555555', 'Synthetic Company Admin')
on conflict (id) do nothing;

insert into public.client_portfolios (id, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Remote Smoke Portfolio A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Remote Smoke Portfolio B');
insert into public.portfolio_memberships (portfolio_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'PORTFOLIO_ADMIN'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'OVERALL_HR_MANAGER'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'PORTFOLIO_ADMIN');

insert into public.companies (id, portfolio_id, name, registration_number, tpin, industry, business_email,
  phone, province, town, physical_address, contact_person)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Remote Smoke Company A', 'REMOTE-SMOKE-A1', 'DEMO-TPIN-A1', 'Services', 'a@example.invalid', '+260000000001', 'Lusaka', 'Lusaka', 'Synthetic Address A', 'Demo Contact'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Remote Smoke Company A2', 'REMOTE-SMOKE-A2', 'DEMO-TPIN-A2', 'Services', 'a2@example.invalid', '+260000000002', 'Copperbelt', 'Ndola', 'Synthetic Address A2', 'Demo Contact'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Remote Smoke Company B', 'REMOTE-SMOKE-B1', 'DEMO-TPIN-B1', 'Services', 'b@example.invalid', '+260000000003', 'Central', 'Kabwe', 'Synthetic Address B', 'Demo Contact');

insert into public.branches (id, portfolio_id, company_id, name, code, province, town, physical_address)
values
  ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Assigned Branch', 'SM-A1', 'Lusaka', 'Lusaka', 'Synthetic Address A1'),
  ('12121212-1212-4212-8212-121212121212', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Unassigned Branch', 'SM-A2', 'Lusaka', 'Kafue', 'Synthetic Address A2'),
  ('34343434-3434-4434-8434-343434343434', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Other Company Branch', 'SM-A3', 'Copperbelt', 'Ndola', 'Synthetic Address A3'),
  ('56565656-5656-4656-8656-565656565656', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Other Portfolio Branch', 'SM-B1', 'Central', 'Kabwe', 'Synthetic Address B1');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
begin
  insert into public.companies (portfolio_id, name, registration_number, tpin, industry, business_email,
    phone, province, town, physical_address, contact_person)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic RLS Created Company', 'REMOTE-SMOKE-CREATE-1',
    'DEMO-TPIN-CREATE-1', 'Services', 'created-company@example.invalid', '+260000000005', 'Lusaka', 'Lusaka',
    'Synthetic address', 'Synthetic contact');
  insert into public.branches (portfolio_id, company_id, name, code, province, town, physical_address)
  select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'Synthetic RLS Created Branch', 'SM-CREATE-1',
    'Lusaka', 'Lusaka', 'Synthetic address'
  from public.companies where registration_number = 'REMOTE-SMOKE-CREATE-1';
end $$;
select public.assign_portfolio_membership(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333',
  'BRANCH_MANAGER', array['ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid]
);
select public.assign_company_admin(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '55555555-5555-4555-8555-555555555555'
);
select public.authorize_member_invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'COMPANY_ADMIN', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select public.authorize_member_invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PORTFOLIO_ADMIN', null);
select public.replace_branch_role_assignments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '33333333-3333-4333-8333-333333333333', 'BRANCH_MANAGER',
  array['ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid, '12121212-1212-4212-8212-121212121212'::uuid]);
do $$
declare v_count integer; v_branches uuid[];
begin
  select count(*) into v_count from public.portfolio_membership_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  if v_count <> 3 then raise exception 'Portfolio membership directory expected 3 members, got %.', v_count; end if;
  select branch_ids into v_branches from public.portfolio_membership_directory('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    where user_id = '33333333-3333-4333-8333-333333333333' and role = 'BRANCH_MANAGER';
  if cardinality(v_branches) <> 2 then raise exception 'Branch assignments were not replaced atomically.'; end if;
end $$;
select public.replace_branch_role_assignments('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '33333333-3333-4333-8333-333333333333', 'BRANCH_MANAGER', array['ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid]);
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
do $$
declare v_count integer;
begin
  if not app_private.has_permission('users.manage', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null)
    or app_private.has_permission('users.manage', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null)
    or app_private.has_permission('payroll.prepare', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    or app_private.has_permission('employee.private.view', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null) then
    raise exception 'Company administrator received an unscoped or excluded permission.';
  end if;
  select count(*) into v_count from public.companies where portfolio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_count <> 1 then raise exception 'Company administrator read outside its company scope.'; end if;
  select count(*) into v_count from public.branches where portfolio_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_count <> 2 then raise exception 'Company administrator branch scope mismatch: expected 2, got %.', v_count; end if;
  select count(*) into v_count from public.company_admin_members('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  if v_count <> 1 then raise exception 'Company admin directory did not return its single scoped membership.'; end if;
  begin
    perform public.assign_portfolio_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'OVERALL_HR_MANAGER', '{}'::uuid[]);
    raise exception 'Company administrator escalated a user to a portfolio role.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.assign_company_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555');
    raise exception 'Company administrator assigned company role to itself.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
begin
  begin
    perform public.authorize_member_invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PORTFOLIO_ADMIN', null);
    raise exception 'Overall HR was allowed to invite a portfolio administrator.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $$
declare v_employee_id uuid; v_correction_employee_id uuid; v_count integer;
begin
  select count(*) into v_count from public.companies;
  if v_count <> 1 then raise exception 'Branch manager company RLS mismatch: expected 1, got %', v_count; end if;
  select count(*) into v_count from public.branches;
  if v_count <> 1 then raise exception 'Branch manager branch RLS mismatch: expected 1, got %', v_count; end if;
  select count(*) into v_count from public.companies where portfolio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_count <> 0 then raise exception 'Cross-portfolio company read was not isolated.'; end if;
  select count(*) into v_count from public.employee_private_details;
  if v_count <> 0 then raise exception 'Branch manager can read restricted employee private details.'; end if;

  begin
    insert into public.companies (portfolio_id, name, registration_number, tpin, industry, business_email,
      phone, province, town, physical_address, contact_person)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forbidden Synthetic Company', 'REMOTE-SMOKE-FORBIDDEN',
      'DEMO-TPIN-FORBIDDEN', 'Services', 'forbidden@example.invalid', '+260000000004', 'Lusaka', 'Lusaka',
      'Synthetic Address', 'Demo Contact');
    raise exception 'Branch manager unexpectedly created a company.';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.platform_administrators (user_id, granted_by)
    values ('33333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333');
    raise exception 'Authenticated branch manager unexpectedly self-assigned platform administration.';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.assign_portfolio_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333', 'PORTFOLIO_ADMIN', '{}'::uuid[]);
    raise exception 'Authenticated branch manager unexpectedly assigned a role to itself.';
  exception when insufficient_privilege then null;
  end;

  v_employee_id := public.employee_create_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '{"employee_number":"REMOTE-SMOKE-EMP-1","first_name":"Synthetic","last_name":"Employee","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Demo Officer","department":"Operations","employment_type":"PERMANENT","contract_type":"PERMANENT","contract_start_date":"2026-01-01","retirement_age":65}'::jsonb,
    '{"residential_address":"Synthetic Address","phone":"+260000000010","email_unavailable_reason":"Synthetic test record","emergency_contact_name":"Synthetic Contact","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000011","payment_method":"CASH"}'::jsonb,
    '{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}'::jsonb
  );
  perform public.employee_submit_for_hr_approval(v_employee_id);
  v_correction_employee_id := public.employee_create_draft(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    '{"employee_number":"REMOTE-SMOKE-CORRECTION-1","first_name":"Synthetic","last_name":"Correction","date_of_birth":"1991-02-03","nationality":"Zambian","job_title":"Demo Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"PERMANENT","contract_start_date":"2026-01-01","retirement_age":65}'::jsonb,
    '{"identity_document_type":"NRC","identity_document_number":"SYNTHETIC-NRC-CORR-1","residential_address":"Synthetic Correction Address","phone":"+260000000012","email_unavailable_reason":"Synthetic test record","emergency_contact_name":"Synthetic Contact","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000013","payment_method":"CASH"}'::jsonb,
    '{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":4800,"payment_method":"CASH"}'::jsonb
  );
  perform public.employee_submit_for_hr_approval(v_correction_employee_id);
  perform set_config('test.correction_employee', v_correction_employee_id::text, true);
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare v_employee_id uuid; v_count integer;
begin
  select count(*) into v_count from public.companies;
  if v_count <> 3 then raise exception 'Overall HR company scope mismatch: expected 3, got %', v_count; end if;
  select count(*) into v_count from public.companies where portfolio_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_count <> 0 then raise exception 'Overall HR crossed portfolio boundary.'; end if;
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  perform public.employee_review_submission(v_employee_id, 'APPROVE', null);
  perform public.employee_review_submission(current_setting('test.correction_employee')::uuid, 'RETURN', 'Correct the synthetic contact details');
  select count(*) into v_count from public.employee_private_details;
  if v_count <> 2 then raise exception 'Overall HR private details scope mismatch: expected both synthetic portfolio records, got %.', v_count; end if;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
do $$
begin
  begin
    perform public.employee_correction_details(current_setting('test.correction_employee')::uuid);
    raise exception 'Other portfolio user unexpectedly read private correction details.';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare v_details jsonb; v_employee_id uuid;
begin
  v_employee_id := current_setting('test.correction_employee')::uuid;
  v_details := public.employee_correction_details(v_employee_id);
  if v_details #>> '{private_details,identity_document_number}' is distinct from 'SYNTHETIC-NRC-CORR-1'
    or (v_details #>> '{compensation,basic_pay}')::numeric <> 4800 then
    raise exception 'Creator-authorized correction details omitted expected synthetic values.';
  end if;
  perform public.employee_update_draft(v_employee_id,
    '{"employee_number":"REMOTE-SMOKE-CORRECTION-1","first_name":"Synthetic","last_name":"Correction","date_of_birth":"1991-02-03","nationality":"Zambian","job_title":"Demo Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"PERMANENT","contract_start_date":"2026-01-01","retirement_age":65}'::jsonb,
    '{"identity_document_type":"NRC","identity_document_number":"SYNTHETIC-NRC-CORR-1","residential_address":"Synthetic Correction Address","phone":"+260000000012","email_unavailable_reason":"Synthetic test record","emergency_contact_name":"Synthetic Contact","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000013","payment_method":"CASH"}'::jsonb,
    '{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":5000,"payment_method":"CASH"}'::jsonb);
  if (select approval_status from public.employees where id = v_employee_id) <> 'RETURNED_FOR_CORRECTION' then
    raise exception 'Correction unexpectedly changed the employee approval status.';
  end if;
  if (select basic_pay from public.employee_compensation where employee_id = v_employee_id) <> 5000 then
    raise exception 'Correction did not persist the revised compensation.';
  end if;
  perform public.employee_submit_for_hr_approval(v_employee_id);
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.employee_review_submission(current_setting('test.correction_employee')::uuid, 'APPROVE', null);
do $$
begin
  if (select approval_status from public.employees where id = current_setting('test.correction_employee')::uuid) <> 'APPROVED'
    or (select count(*) from public.employee_approval_history where employee_id = current_setting('test.correction_employee')::uuid and action = 'CORRECTED') <> 1
    or (select count(*) from public.employee_approval_history where employee_id = current_setting('test.correction_employee')::uuid and action = 'RESUBMITTED') <> 1
    or (select count(*) from public.audit_logs where record_id = current_setting('test.correction_employee') and action = 'EMPLOYEE_CORRECTED') <> 1 then
    raise exception 'Employee correction, resubmission, approval, or audit history was incomplete.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare v_employee_id uuid; v_deduction_id uuid;
begin
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  v_deduction_id := public.deduction_create_request(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', v_employee_id, 'remote-smoke-medical-advance-1',
    '{"deduction_type":"MEDICAL_ADVANCE","principal_amount":6000,"repayment_method":"EQUAL_INSTALLMENTS","requested_installments":6,"start_period":"2026-11-01","installment_frequency":"MONTHLY","reason":"Synthetic hosted smoke test","consent_reference":"SYNTHETIC-ONLY"}'::jsonb,
    null
  );
  if (select count(*) from public.deduction_installments where deduction_id = v_deduction_id and scheduled_amount = 1000) <> 6 then
    raise exception 'K6,000 six-period schedule did not produce six K1,000 installments.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $$
declare v_deduction_id uuid;
begin
  select id into strict v_deduction_id from public.employee_deductions where idempotency_key = 'remote-smoke-medical-advance-1';
  perform public.deduction_review_request(v_deduction_id, 'APPROVE', null);
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare v_employee_id uuid; v_period_id uuid;
begin
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  perform public.attendance_save_entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31', v_employee_id, 22, 20, 2, 0, 0, 'PERMANENT', null);
  select id into strict v_period_id from public.attendance_periods where company_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and period_start = '2026-10-01';
  perform public.attendance_submit_period(v_period_id);
  if (select status from public.attendance_periods where id = v_period_id) <> 'SUBMITTED' then
    raise exception 'Attendance period did not move to submitted.';
  end if;
  if (select count(*) from public.attendance_periods where branch_id = '12121212-1212-4212-8212-121212121212') <> 0 then
    raise exception 'Branch manager can read an unassigned branch attendance period.';
  end if;
  begin
    perform public.attendance_review_period(v_period_id, 'APPROVE', null);
    raise exception 'Attendance creator unexpectedly reviewed their own submission.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.attendance_period', v_period_id::text, true);
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.attendance_review_period(current_setting('test.attendance_period')::uuid, 'RETURN', 'Correct the worked-day entry');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare v_employee_id uuid; v_period_id uuid;
begin
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  v_period_id := current_setting('test.attendance_period')::uuid;
  perform public.attendance_save_entry('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31', v_employee_id, 22, 19, 2, 1, 0,
    'PERMANENT', 'Synthetic correction after HR return');
  if (select status from public.attendance_periods where id = v_period_id) <> 'DRAFT' then
    raise exception 'Attendance correction did not reopen the returned period as draft.';
  end if;
  perform public.attendance_submit_period(v_period_id);
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.attendance_review_period(current_setting('test.attendance_period')::uuid, 'APPROVE', null);
do $$
begin
  if (select status from public.attendance_periods where id = current_setting('test.attendance_period')::uuid) <> 'APPROVED' then
    raise exception 'Attendance period was not approved.';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'ATTENDANCE_ENTRY_SAVED'
    and (details #>> '{previous,worked_days}')::numeric = 20
    and (details #>> '{new,worked_days}')::numeric = 19) then
    raise exception 'Attendance correction did not record old and new values.';
  end if;
end $$;

do $$
declare v_inputs jsonb; v_item jsonb;
begin
  v_inputs := public.payroll_preview_inputs('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31');
  select rows.item into strict v_item from jsonb_array_elements(v_inputs->'items') as rows(item)
    where rows.item->>'employee_number' = 'REMOTE-SMOKE-EMP-1';
  if (v_item->>'basic_pay')::numeric <> 6000 or (v_item #>> '{attendance,actual_days_worked}')::numeric <> 19
    or (v_item #>> '{attendance,unpaid_leave_days}')::numeric <> 1 then
    raise exception 'Payroll input preview did not include current compensation and approved attendance.';
  end if;
  if v_inputs->>'attendance_period_id' is null or v_item->'approved_leave_requests' is null
    or v_item->'due_approved_deductions' is null then
    raise exception 'Payroll preview is missing its approved HR input references.';
  end if;
end $$;

do $$
declare v_employee_id uuid; v_inputs jsonb;
begin
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  perform public.employee_set_employment_status(v_employee_id, 'SUSPENDED', 'Synthetic status workflow verification');
  if (select employment_status from public.employees where id = v_employee_id) <> 'SUSPENDED'
    or (select count(*) from public.employee_employment_history where employee_id = v_employee_id and previous_status = 'ACTIVE' and new_status = 'SUSPENDED') <> 1 then
    raise exception 'Employment status change or history was not recorded.';
  end if;
  v_inputs := public.payroll_preview_inputs('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31');
  if exists (select 1 from jsonb_array_elements(v_inputs->'items') item where item->>'employee_number' = 'REMOTE-SMOKE-EMP-1') then
    raise exception 'Suspended employee remained eligible in the payroll input preview.';
  end if;
  perform public.employee_set_employment_status(v_employee_id, 'ACTIVE', 'Synthetic return to active status');
  if (select employment_status from public.employees where id = v_employee_id) <> 'ACTIVE'
    or (select count(*) from public.employee_employment_history where employee_id = v_employee_id) <> 2 then
    raise exception 'Allowed reactivation from suspended status did not retain both history events.';
  end if;
end $$;

do $$
declare v_first uuid; v_second uuid; v_period_id uuid;
begin
  v_first := public.payroll_create_draft('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31', 'MONTHLY', 'remote-smoke-payroll-2026-10');
  v_second := public.payroll_create_draft('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31', 'MONTHLY', 'remote-smoke-payroll-2026-10');
  if v_first <> v_second then raise exception 'Payroll draft idempotent retry created a second run.'; end if;
  select payroll_period_id into strict v_period_id from public.payroll_runs where id = v_first;
  if (select status from public.payroll_runs where id = v_first) <> 'DRAFT'
    or (select count(*) from public.payroll_run_items where payroll_run_id = v_first) <> 0
    or (select count(*) from public.payroll_periods where id = v_period_id) <> 1 then
    raise exception 'Draft creation wrote items or failed to create one matching period/run.';
  end if;
  perform set_config('test.payroll_run', v_first::text, true);
end $$;

do $$
declare v_first jsonb; v_second jsonb; v_run uuid; v_calculation_count integer; v_employee_line jsonb;
begin
  v_run := current_setting('test.payroll_run')::uuid;
  v_first := public.payroll_calculate_trial(v_run, 'remote-smoke-trial-oct-2026-v1');
  v_second := public.payroll_calculate_trial(v_run, 'remote-smoke-trial-oct-2026-v1');
  if v_first <> v_second then raise exception 'Payroll trial idempotent retry returned a different snapshot.'; end if;
  if v_first->>'status' <> 'TRIAL_ONLY' or (v_first->>'can_finalize')::boolean is distinct from false
    or (v_first #>> '{totals,gross_pay_candidate}')::numeric <> 6000
    or (v_first #>> '{totals,paye_candidate}')::numeric <> 180
    or (v_first #>> '{totals,napsa_employee_candidate}')::numeric <> 300
    or (v_first #>> '{totals,nhima_employee_candidate}')::numeric <> 60
    or (v_first #>> '{totals,candidate_net_pay}')::numeric <> 5460 then
    raise exception 'Trial calculation did not return the expected explicitly non-authoritative synthetic breakdown.';
  end if;
  select value into strict v_employee_line from jsonb_array_elements(v_first->'items')
    where value->>'employee_number' = 'REMOTE-SMOKE-EMP-1';
  if not (v_first->'blockers' ? 'NAPSA_2026_CONFIGURATION_UNVERIFIED')
    or not (v_first->'blockers' ? 'NHIMA_CONTRIBUTION_BASE_UNRESOLVED')
    or not (v_employee_line->'blockers' ? 'UNPAID_LEAVE_FORMULA_REQUIRES_APPROVED_CONTRACT_RULE') then
    raise exception 'Trial calculation did not expose statutory and unpaid-leave blockers.';
  end if;
  select count(*) into v_calculation_count from public.payroll_trial_calculations where payroll_run_id = v_run;
  if v_calculation_count <> 1
    or (select status from public.payroll_runs where id = v_run) <> 'DRAFT'
    or (select count(*) from public.payroll_run_items where payroll_run_id = v_run) <> 0 then
    raise exception 'Trial calculation was not stored once as a non-payable snapshot or altered payroll state.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
begin
  begin
    perform public.payroll_preview_inputs('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31');
    raise exception 'Branch manager without payroll preparation permission received payroll details.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.payroll_create_draft('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-10-01', '2026-10-31', 'MONTHLY', 'unauthorized-payroll-draft');
    raise exception 'Branch manager without payroll preparation permission created a payroll run.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.payroll_calculate_trial(current_setting('test.payroll_run')::uuid, 'unauthorized-trial-calculation');
    raise exception 'Branch manager without payroll preparation permission calculated payroll.';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select set_config('test.leave_policy', public.leave_policy_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Annual leave', 'PAID', 2.0, 30, '2026-01-01', null)::text, true);
select public.leave_accrue_month(current_setting('test.leave_policy')::uuid, '2026-10-01');
do $$
begin
  if public.leave_accrue_month(current_setting('test.leave_policy')::uuid, '2026-10-01') <> 0 then
    raise exception 'Repeating leave accrual duplicated monthly balance entries.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
declare v_employee_id uuid; v_leave_id uuid;
begin
  begin
    perform public.leave_policy_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Annual leave', 'PAID', 2.0, 30, '2026-01-01', null);
    raise exception 'Branch manager unexpectedly changed a company-wide leave policy.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.leave_accrue_month(current_setting('test.leave_policy')::uuid, '2026-10-01');
    raise exception 'Branch manager unexpectedly ran portfolio-wide leave accrual.';
  exception when insufficient_privilege then null;
  end;
  select id into strict v_employee_id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1';
  v_leave_id := public.leave_create_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff', v_employee_id,
    'Annual leave', 'PAID', '2026-11-02', '2026-11-03', 1.5, 'Synthetic leave request', 'remote-smoke-leave-1');
  if public.leave_create_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', v_employee_id, 'Annual leave', 'PAID', '2026-11-02', '2026-11-03',
    1.5, 'Synthetic leave request', 'remote-smoke-leave-1') <> v_leave_id then
    raise exception 'Leave request idempotent retry returned a different record.';
  end if;
  perform set_config('test.leave_request', v_leave_id::text, true);
end $$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.leave_review_request(current_setting('test.leave_request')::uuid, 'APPROVE', null);
do $$
begin
  if (select sum(amount_delta) from public.leave_balance_ledger where employee_id =
    (select id from public.employees where employee_number = 'REMOTE-SMOKE-EMP-1') and leave_policy_id = current_setting('test.leave_policy')::uuid) <> 0.5 then
    raise exception 'Approved paid leave was not charged against accrued balance.';
  end if;
  if (select status from public.leave_requests where id = current_setting('test.leave_request')::uuid) <> 'APPROVED' then
    raise exception 'Leave request was not approved.';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.revoke_portfolio_membership('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333', 'BRANCH_MANAGER', 'Synthetic rollback revocation test');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $$
begin
  if (select count(*) from public.branches) <> 0 then
    raise exception 'Revoked branch membership retained branch visibility.';
  end if;
end $$;

reset role;
rollback;
