-- Run only after migrations 00100 through 02700 on a disposable database.
-- Synthetic account portfolios/users and rollback-only end-to-end authorization tests.
begin;
select extensions.plan(53);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'synthetic-' || u || '@test.invalid', '', now(), '{}', '{}', now(), now()
from unnest(array[
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000006'::uuid,
  '00000000-0000-0000-0000-000000000007'::uuid
]) as users(u);

insert into public.profiles(id, display_name)
select id, 'Synthetic test user ' || id::text from auth.users
where id between '00000000-0000-0000-0000-000000000001'::uuid and '00000000-0000-0000-0000-000000000007'::uuid;

insert into public.client_portfolios(id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Synthetic Mr Mark portfolio'),
  ('10000000-0000-0000-0000-000000000002', 'Synthetic isolated customer portfolio');

insert into public.portfolio_memberships(portfolio_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'PORTFOLIO_ADMIN'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'OVERALL_HR_MANAGER'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'BRANCH_MANAGER'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'PAYROLL_PROCESSOR'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'OVERALL_HR_MANAGER');

insert into public.companies(id, portfolio_id, name, registration_number, tpin, industry, business_email, phone, province, town, physical_address, contact_person) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Synthetic company A', 'REG-SA', '1000000001', 'Retail', 'a@test.invalid', '+260000000001', 'Copperbelt', 'Kitwe', 'Synthetic address A', 'Synthetic contact'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Synthetic company A2', 'REG-SA2', '1000000002', 'Retail', 'a2@test.invalid', '+260000000002', 'Lusaka', 'Lusaka', 'Synthetic address A2', 'Synthetic contact'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Synthetic company B', 'REG-SB', '1000000003', 'Retail', 'b@test.invalid', '+260000000003', 'Lusaka', 'Lusaka', 'Synthetic address B', 'Synthetic contact');

insert into public.branches(id, portfolio_id, company_id, name, code, province, town, physical_address) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Synthetic branch 1', 'S-A-1', 'Copperbelt', 'Kitwe', 'Synthetic branch address'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Synthetic branch 2', 'S-A-2', 'Copperbelt', 'Ndola', 'Synthetic branch address'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Synthetic branch 3', 'S-A2-1', 'Lusaka', 'Lusaka', 'Synthetic branch address'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'Synthetic branch 4', 'S-B-1', 'Lusaka', 'Lusaka', 'Synthetic branch address');

insert into public.branch_assignments(portfolio_id, company_id, branch_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'BRANCH_MANAGER'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'PAYROLL_PROCESSOR');

insert into public.employees(
  id, portfolio_id, company_id, workplace_branch_id, employee_number, first_name, last_name,
  date_of_birth, nationality, job_title, department, employment_type, contract_type,
  contract_start_date, created_by
) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'SYN-001', 'Test', 'Employee', '1990-01-01', 'Zambian', 'Clerk', 'Finance', 'PERMANENT', 'MONTHLY', '2025-01-01', '00000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'SYN-002', 'Other', 'Branch', '1991-01-01', 'Zambian', 'Clerk', 'Finance', 'PERMANENT', 'MONTHLY', '2025-01-01', '00000000-0000-0000-0000-000000000007'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004', 'SYN-003', 'Other', 'Portfolio', '1992-01-01', 'Zambian', 'Clerk', 'Finance', 'PERMANENT', 'MONTHLY', '2025-01-01', '00000000-0000-0000-0000-000000000004');
update public.employees set approval_status = 'APPROVED', submitted_at = now(), reviewed_by = '00000000-0000-0000-0000-000000000007', reviewed_at = now()
where id = '40000000-0000-0000-0000-000000000002';

insert into public.employee_private_details(
  employee_id, portfolio_id, company_id, residential_address, phone, email,
  email_unavailable_reason, emergency_contact_name, emergency_contact_relationship,
  emergency_contact_phone, payment_method
) values (
  '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', 'Synthetic home address', '+260000000100', 'synthetic-employee@test.invalid',
  null, 'Synthetic contact', 'Friend', '+260000000101', 'CASH'
);

insert into public.employee_compensation(
  portfolio_id, company_id, workplace_branch_id, employee_id, effective_from,
  salary_frequency, basic_pay, created_by, payment_method
) values (
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '2026-01-01', 'MONTHLY', 6000, '00000000-0000-0000-0000-000000000007', 'CASH'
);

insert into public.employee_deductions(
  id, portfolio_id, company_id, branch_id, employee_id, deduction_type, principal_amount,
  repayment_method, requested_installments, start_period, amount_deducted, status, initiated_by, idempotency_key, reason
) values (
  '50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'MEDICAL_ADVANCE', 6000, 'EQUAL_INSTALLMENTS',
  6, '2026-10-01', 0, 'SUBMITTED', '00000000-0000-0000-0000-000000000002', 'synthetic-medical-advance-fixture-1', 'Synthetic K6000 advance');
insert into public.deduction_installments(portfolio_id, company_id, branch_id, employee_id, deduction_id, sequence_number, due_period, scheduled_amount)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
  n, ('2026-10-01'::date + ((n - 1) || ' months')::interval)::date, 1000
from generate_series(1, 6) as installments(n);

insert into public.payroll_periods(id, portfolio_id, company_id, branch_id, period_start, period_end, frequency)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '2026-10-01', '2026-10-31', 'MONTHLY');
insert into public.payroll_runs(
  id, portfolio_id, company_id, branch_id, payroll_period_id, status,
  version, created_by, idempotency_key
) values (
  '70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001', 'CALCULATED', 1,
  '00000000-0000-0000-0000-000000000003', 'synthetic-run-key-1');
insert into public.payroll_run_items(
  portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version,
  basic_pay, gross_pay, voluntary_deductions, net_pay
) values (
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 1, 6000, 6000, 1000, 5000);
insert into public.payroll_item_deductions(
  portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version, deduction_id, installment_id, amount
)
select '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 1, '50000000-0000-0000-0000-000000000001', id, 1000
from public.deduction_installments
where deduction_id = '50000000-0000-0000-0000-000000000001' and due_period = '2026-10-01';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.is((select count(*) from public.employees), 1::bigint, 'branch manager sees only assigned branch employees');
select extensions.is((select count(*) from public.employees where workplace_branch_id = '30000000-0000-0000-0000-000000000002'), 0::bigint, 'branch manager cannot read another branch');
select extensions.is((select count(*) from public.employee_private_details), 0::bigint, 'branch manager cannot read private banking/contact detail');
select extensions.is((select count(*) from public.employee_compensation), 0::bigint, 'branch manager cannot read restricted compensation table');
select extensions.is((select count(*) from public.employees where portfolio_id = '10000000-0000-0000-0000-000000000002'), 0::bigint, 'branch manager cannot cross portfolios');
select extensions.throws_ok($$insert into public.portfolio_memberships(portfolio_id,user_id,role) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','PORTFOLIO_ADMIN')$$, '42501', 'branch manager cannot self-escalate');
select extensions.throws_ok($$insert into public.employees(portfolio_id,company_id,workplace_branch_id,employee_number,first_name,last_name,date_of_birth,nationality,job_title,department,employment_type,contract_type,contract_start_date,created_by) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','FORGED-001','Forged','Record','1990-01-01','Zambian','Clerk','Finance','PERMANENT','MONTHLY','2026-01-01','00000000-0000-0000-0000-000000000002')$$, '42501', 'employee rows cannot be inserted directly through table grants');
select extensions.throws_ok($$update public.employees set department='Forged' where id='40000000-0000-0000-0000-000000000001'$$, '42501', 'employee rows cannot be edited directly through table grants');
select extensions.throws_ok($$select public.employee_create_draft(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '{"employee_number":"syn-001","first_name":"Case","last_name":"Duplicate","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"}'::jsonb,
  '{"payment_method":"CASH"}'::jsonb,
  '{"payment_method":"CASH"}'::jsonb
)$$, '23505', 'case-insensitive unique index rejects SYN-001 versus syn-001');

select extensions.throws_ok($$select public.employee_review_submission('40000000-0000-0000-0000-000000000001','APPROVE',null)$$, '42501', 'branch manager cannot approve employee onboarding');
select public.employee_submit_for_hr_approval('40000000-0000-0000-0000-000000000001');
select set_config('test.new_employee', public.employee_create_draft(
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '{"employee_number":"SYN-004","first_name":"Demo","middle_name":"","last_name":"Draft","date_of_birth":"1995-03-01","gender":"UNDISCLOSED","nationality":"Zambian","job_title":"Assistant","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-10-01","retirement_age":65}'::jsonb,
  '{"residential_address":"Synthetic address","phone":"+260000000202","email_unavailable_reason":"Synthetic unavailable","emergency_contact_name":"Emergency Contact","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000203","payment_method":"CASH"}'::jsonb,
  '{"effective_from":"2026-10-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}'::jsonb
)::text, true);
select extensions.is((select approval_status from public.employees where id = current_setting('test.new_employee')::uuid), 'DRAFT', 'branch onboarding creates a draft under the authenticated actor');
select public.employee_submit_for_hr_approval(current_setting('test.new_employee')::uuid);
select extensions.is((select approval_status from public.employees where id = current_setting('test.new_employee')::uuid), 'SUBMITTED_FOR_HR_APPROVAL', 'branch-created employee is submitted for HR review');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select extensions.is((select count(*) from public.employees), 1::bigint, 'other portfolio HR sees only its own employee');
select extensions.throws_ok($$select public.employee_review_submission('40000000-0000-0000-0000-000000000001','APPROVE',null)$$, '42501', 'other portfolio HR cannot approve another portfolio employee');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select public.employee_review_submission('40000000-0000-0000-0000-000000000001', 'APPROVE', null);
select public.employee_review_submission(current_setting('test.new_employee')::uuid, 'APPROVE', null);
select extensions.is((select approval_status from public.employees where id = current_setting('test.new_employee')::uuid), 'APPROVED', 'Overall HR can approve branch-created employee');
select public.deduction_review_request('50000000-0000-0000-0000-000000000001', 'APPROVE', null);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select set_config('test.new_deduction', public.deduction_create_request(
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001', 'synthetic-medical-advance-test-1',
  '{"deduction_type":"MEDICAL_ADVANCE","principal_amount":6000,"repayment_method":"EQUAL_INSTALLMENTS","requested_installments":6,"start_period":"2026-11-01","installment_frequency":"MONTHLY","reason":"Synthetic test advance"}'::jsonb,
  '[]'::jsonb
)::text, true);
select extensions.is((select sum(scheduled_amount) from public.deduction_installments where deduction_id = current_setting('test.new_deduction')::uuid), 6000::numeric, 'K6000 advance creates six K1000 installments');
select extensions.throws_ok($$select public.deduction_review_request(current_setting('test.new_deduction')::uuid,'APPROVE',null)$$, '42501', 'branch manager cannot approve their own advance');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select public.deduction_review_request(current_setting('test.new_deduction')::uuid, 'APPROVE', null);
select extensions.is((select status from public.employee_deductions where id = current_setting('test.new_deduction')::uuid), 'ACTIVE', 'Overall HR approval activates the advance schedule');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.is((select count(*) from public.employee_compensation), 2::bigint, 'payroll processor reads compensation records only in assigned branch');
select extensions.is((select count(*) from public.employee_private_details), 0::bigint, 'payroll processor cannot read employee bank details');
select public.payroll_submit_for_approval('70000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok($$select public.payroll_review_submission('70000000-0000-0000-0000-000000000001','START_REVIEW',1,null)$$, '42501', 'branch manager cannot review payroll');
select extensions.throws_ok($$select public.payroll_submit_for_approval('70000000-0000-0000-0000-000000000001')$$, '42501', 'branch manager without payroll assignment cannot submit payroll');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select public.payroll_review_submission('70000000-0000-0000-0000-000000000001', 'START_REVIEW', 1, null);
select public.payroll_review_submission('70000000-0000-0000-0000-000000000001', 'APPROVE', 1, null);
select extensions.throws_ok($$select public.payroll_finalize('70000000-0000-0000-0000-000000000001')$$, '22023', 'unverified or missing statutory rules block finalization');
select extensions.is((select count(*) from public.deduction_transactions), 0::bigint, 'failed finalization does not post an installment');

reset role;
insert into public.statutory_rule_versions(jurisdiction,rule_code,version,effective_from,rule_data,verified_by,verified_at,active)
select 'ZM', code, 'SYNTHETIC-TEST-VERIFIED', '2026-01-01', '{}', '00000000-0000-0000-0000-000000000007', now(), true
from (values ('PAYE'),('NAPSA'),('NHIMA')) as required(code);
insert into public.payroll_run_statutory_rules(portfolio_id,company_id,branch_id,payroll_run_id,statutory_rule_version_id)
select r.portfolio_id,r.company_id,r.branch_id,r.id,s.id
from public.payroll_runs r cross join public.statutory_rule_versions s
where r.id = '70000000-0000-0000-0000-000000000001' and s.version = 'SYNTHETIC-TEST-VERIFIED';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select public.payroll_finalize('70000000-0000-0000-0000-000000000001');
select public.payroll_finalize('70000000-0000-0000-0000-000000000001');
select set_config('test.payout_export', public.payroll_prepare_payout_instructions('70000000-0000-0000-0000-000000000001')->>'export_id', true);
select extensions.throws_ok($$insert into public.deduction_transactions(portfolio_id,company_id,branch_id,employee_id,deduction_id,installment_id,payroll_run_id,amount,transaction_type,idempotency_key,posted_by) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',(select id from public.deduction_installments where deduction_id='50000000-0000-0000-0000-000000000001' and due_period='2026-10-01'),'70000000-0000-0000-0000-000000000001',1000,'PAYROLL_REPAYMENT','forged-duplicate','00000000-0000-0000-0000-000000000007')$$, '42501', 'browser cannot post loan repayments directly');
reset role;
set local role anon;
select extensions.throws_ok($$select count(*) from public.employees$$, '42501', 'anonymous users cannot read employee records');
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007')$$, '42501', 'anonymous users cannot issue privileged payslip snapshots');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok($$select public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)$$, '42501', 'branch manager cannot inspect statutory filing data');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')$$, '42501', 'payroll.view-only user cannot call the service-only issuance RPC');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002')$$, '42501', 'ordinary authenticated branch user cannot issue payslip snapshots');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003')$$, '42501', 'trusted server cannot issue for actor without payslip.issue');
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',null)$$, '42501', 'trusted server rejects a missing human actor');
select extensions.is(public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007')->>'branch_id', '30000000-0000-0000-0000-000000000001', 'authorized issuer receives only the finalized run scope');
select extensions.throws_ok($$select public.payslip_issue_snapshot('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004')$$, '42501', 'issuer from another portfolio cannot access finalized payslip snapshot');
select set_config('test.payslip_document', public.payslip_register_document(
  '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000001/70000000-0000-0000-0000-000000000001/1/40000000-0000-0000-0000-000000000001.pdf',
  repeat('a',64), '00000000-0000-0000-0000-000000000007'
)::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select set_config('test.payslip_delivery', public.payslip_email_enqueue(current_setting('test.payslip_document')::uuid)::text, true);
select extensions.is((select count(*) from jsonb_object_keys((select to_jsonb(h) from public.payslip_email_history(current_setting('test.payslip_document')::uuid) h)) as j(key) where j.key='recipient_email'), 0::bigint, 'redacted delivery history does not expose recipient email');
select extensions.is((case when public.payslip_authorized_document(current_setting('test.payslip_document')::uuid) ? 'snapshot' then 1 else 0 end), 0, 'authorized download metadata does not expose the payroll snapshot');
select extensions.throws_ok($$select recipient_email from public.payslip_email_deliveries$$, '42501', 'authenticated users cannot read delivery recipient addresses directly');
select extensions.throws_ok($$select snapshot from public.payslip_documents$$, '42501', 'payroll.view users cannot read privileged payslip snapshots directly');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok($$select * from public.payslip_email_history(current_setting('test.payslip_document')::uuid)$$, '42501', 'payroll.view-only user cannot read controlled delivery history');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok($$select public.employee_import_atomic('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','synthetic-import-outside-branch','[]'::jsonb)$$, '42501', 'employee import cannot cross the actor branch assignment');
select extensions.throws_ok($$select public.employee_import_atomic('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','synthetic-import-other-company','[]'::jsonb)$$, '42501', 'employee import cannot cross company scope inside the same portfolio');
select extensions.throws_ok($$select public.employee_import_atomic('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004','synthetic-import-other-tenant','[]'::jsonb)$$, '42501', 'employee import cannot cross tenant scope');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok($$select public.employee_import_atomic('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-unprivileged','[]'::jsonb)$$, '42501', 'payroll.view-only actor cannot import employees');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select extensions.is((public.employee_import_atomic(
  '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-duplicate-01',
  '[{"line":"2","employee":{"employee_number":"SYN-001","first_name":"Synthetic","last_name":"Duplicate","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"},"private_details":{},"compensation":{}}]'::jsonb
)->>'status'), 'VALIDATION_FAILED', 'import rejects an employee number already present in the company');
select set_config('test.import_result', public.employee_import_atomic(
  '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-valid-01',
  '[{"line":"2","employee":{"employee_number":"SYN-IMPORT-001","first_name":"Synthetic","last_name":"Import","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"},"private_details":{"residential_address":"Synthetic","phone":"+260000000300","email_unavailable_reason":"Synthetic","emergency_contact_name":"Synthetic","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000301","payment_method":"CASH"},"compensation":{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}}]'::jsonb
)::text, true);
select extensions.is((current_setting('test.import_result')::jsonb->>'status'), 'COMPLETED', 'authorized branch import completes');
select extensions.is((public.employee_import_atomic(
  '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-valid-01',
  '[{"line":"2","employee":{"employee_number":"SYN-IMPORT-001","first_name":"Synthetic","last_name":"Import","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"},"private_details":{"residential_address":"Synthetic","phone":"+260000000300","email_unavailable_reason":"Synthetic","emergency_contact_name":"Synthetic","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000301","payment_method":"CASH"},"compensation":{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}}]'::jsonb
)->>'replayed'), 'true', 'identical import retry is idempotent');
select extensions.throws_ok($$select public.employee_import_atomic('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-valid-01','[]'::jsonb)$$, '22023', 'import idempotency key cannot be reused with another payload');
select extensions.is((select count(*) from public.employee_import_jobs where idempotency_key='synthetic-import-valid-01'), 1::bigint, 'idempotent import creates one job history record');
select set_config('test.import_rollback', public.employee_import_atomic(
  '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic-import-rollback-01',
  '[{"line":"2","employee":{"employee_number":"SYN-ROLLBACK-001","first_name":"Synthetic","last_name":"Rollback","date_of_birth":"1990-01-01","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"},"private_details":{"residential_address":"Synthetic","phone":"+260000000302","email_unavailable_reason":"Synthetic","emergency_contact_name":"Synthetic","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000303","payment_method":"CASH"},"compensation":{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}},{"line":"3","employee":{"employee_number":"SYN-ROLLBACK-002","first_name":"Synthetic","last_name":"Invalid","date_of_birth":"bad-date","nationality":"Zambian","job_title":"Clerk","department":"Operations","employment_type":"PERMANENT","contract_type":"MONTHLY","contract_start_date":"2026-01-01"},"private_details":{"residential_address":"Synthetic","phone":"+260000000304","email_unavailable_reason":"Synthetic","emergency_contact_name":"Synthetic","emergency_contact_relationship":"Friend","emergency_contact_phone":"+260000000305","payment_method":"CASH"},"compensation":{"effective_from":"2026-01-01","salary_frequency":"MONTHLY","basic_pay":6000,"payment_method":"CASH"}}]'::jsonb
)::text, true);
select extensions.is((current_setting('test.import_rollback')::jsonb->>'status'), 'FAILED', 'failed employee import retains generic job failure state');
select extensions.is((select count(*) from public.employees where employee_number='SYN-ROLLBACK-001'), 0::bigint, 'failed multi-row employee import rolls back every created row');
reset role;

select extensions.is((select amount_deducted from public.employee_deductions where id = '50000000-0000-0000-0000-000000000001'), 1000::numeric, 'one K1000 scheduled repayment posts after finalization');
select extensions.is((select count(*) from public.deduction_transactions where payroll_run_id = '70000000-0000-0000-0000-000000000001'), 1::bigint, 'repeated finalization is idempotent and does not duplicate the loan deduction');
select extensions.is((select approval_status from public.employees where id = '40000000-0000-0000-0000-000000000001'), 'APPROVED', 'only HR-approved employee is in finalized payroll');
select extensions.is((select count(*) from public.audit_logs where record_id = '70000000-0000-0000-0000-000000000001' and action = 'PAYROLL_FINALIZED'), 1::bigint, 'finalization audit is recorded once');

select extensions.ok(not has_function_privilege('anon','public.payroll_payout_reconciliation_batches(uuid,uuid)','EXECUTE'), 'anonymous role cannot execute payout reconciliation batch RPC');
select extensions.ok(not has_function_privilege('anon','public.payroll_payout_reconciliation_detail(uuid,integer,integer)','EXECUTE'), 'anonymous role cannot execute payout reconciliation detail RPC');
select extensions.ok(not has_function_privilege('anon','public.payroll_payout_reconciliation_save(uuid,uuid,text,numeric,date,text,text)','EXECUTE'), 'anonymous role cannot execute payout reconciliation save RPC');
select extensions.ok(not has_table_privilege('authenticated','public.payroll_payout_reconciliations','SELECT'), 'authenticated role has no direct reconciliation table access');

set local role anon;
select extensions.throws_ok($$select public.payroll_payout_reconciliation_batches('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')$$, '42501', 'anonymous reconciliation call is denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select extensions.throws_ok($$select public.payroll_payout_reconciliation_batches('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')$$, '42501', 'payroll preparer without payroll.finalize cannot list payout reconciliation batches');
select extensions.throws_ok($$select payout_export_id from public.payroll_payout_reconciliations$$, '42501', 'authenticated user cannot directly read reconciliation references or notes');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select extensions.throws_ok($$select public.payroll_payout_reconciliation_batches('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')$$, '42501', 'branch manager without payroll.finalize cannot reconcile payouts');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select extensions.throws_ok($$select public.payroll_payout_reconciliation_batches('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')$$, '42501', 'cross-portfolio payroll user cannot reconcile another tenant');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
select extensions.is(jsonb_typeof(public.payroll_payout_reconciliation_batches('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001')), 'array', 'authorized payroll finalizer can list batches in its exact branch');
select extensions.is((public.payroll_payout_reconciliation_detail(current_setting('test.payout_export')::uuid,1,50)->>'total')::integer, 1, 'authorized finalizer reads one recipient from the selected batch');
select extensions.throws_ok($$select public.payroll_payout_reconciliation_detail('ffffffff-ffff-4fff-8fff-ffffffffffff',1,50)$$, '42501', 'batch detail cannot be retrieved outside a known authorized batch');
select extensions.throws_ok($$select public.payroll_payout_reconciliation_save(current_setting('test.payout_export')::uuid,'40000000-0000-0000-0000-000000000001','PAID',4999,'2026-10-31','SYNTHETIC-REF',null)$$, '22023', 'paid outcome must match the finalized payout amount exactly');
select extensions.throws_ok($$select public.payroll_payout_reconciliation_save(current_setting('test.payout_export')::uuid,'40000000-0000-0000-0000-000000000001','PARTIAL',5000,'2026-10-31','SYNTHETIC-REF',null)$$, '22023', 'partial outcome cannot equal or exceed the expected amount');
select extensions.throws_ok($$select public.payroll_payout_reconciliation_save(current_setting('test.payout_export')::uuid,'40000000-0000-0000-0000-000000000002','PAID',5000,'2026-10-31','SYNTHETIC-REF',null)$$, '22023', 'reconciliation cannot include an employee outside the payout snapshot');
select public.payroll_payout_reconciliation_save(current_setting('test.payout_export')::uuid,'40000000-0000-0000-0000-000000000001','PAID',5000,'2026-10-31','SYNTHETIC-STATEMENT-REF-001','Synthetic reconciliation test');
select extensions.is((public.payroll_payout_reconciliation_detail(current_setting('test.payout_export')::uuid,1,50)->'items'->0->>'status'), 'PAID', 'authorized payout reconciliation persists the checked statement outcome');
select extensions.is((public.payroll_payout_reconciliation_detail(current_setting('test.payout_export')::uuid,1,50)->'items'->0 ? 'bank_account_number'), false, 'reconciliation detail excludes bank account numbers');
select extensions.is((select count(*) from public.payroll_payout_reconciliations where payout_export_id=current_setting('test.payout_export')::uuid), 1::bigint, 'one employee reconciliation is stored per payout recipient');
select extensions.is((select count(*) from public.audit_logs where action='PAYOUT_RECONCILIATION_UPDATED' and details ? 'provider_reference'), 0::bigint, 'audit trail records reconciliation without copying provider references');
reset role;

set local role anon;
select extensions.throws_ok($$select public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)$$, '42501', 'anonymous callers cannot list statutory filing evidence');
select extensions.throws_ok($$select public.statutory_filing_prepare('70000000-0000-0000-0000-000000000001','PAYE','2026-11-10')$$, '42501', 'anonymous callers cannot prepare statutory filing records');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok($$select public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)$$, '42501', 'payroll viewer without finalization permission cannot inspect filing evidence');
select extensions.throws_ok($$select public.statutory_filing_prepare('70000000-0000-0000-0000-000000000001','PAYE','2026-11-10')$$, '42501', 'payroll viewer cannot create filing records');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select extensions.throws_ok($$select public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)$$, '42501', 'other portfolio HR cannot read filing evidence');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', true);
select set_config('test.statutory_filing', public.statutory_filing_prepare('70000000-0000-0000-0000-000000000001','PAYE','2026-11-10')::text, true);
select extensions.is(public.statutory_filing_prepare('70000000-0000-0000-0000-000000000001','PAYE','2026-12-10')::text, current_setting('test.statutory_filing'), 'repeated filing preparation returns the same idempotent record');
select extensions.is((public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)->>'total')::integer, 1, 'authorized finalizer sees only its exact branch filing register');
select extensions.throws_ok($$select public.statutory_filing_list('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,25)$$, '42501', 'authorized finalizer cannot read another company or portfolio filing register');
select extensions.throws_ok($$select public.statutory_filing_update(current_setting('test.statutory_filing')::uuid,'SUBMITTED','2026-11-05T12:00:00Z','SYNTHETIC-SUBMISSION','PARTIAL',1,'2026-11-08T12:00:00Z','SYNTHETIC-REMITTANCE',null)$$, '22023', 'remittance cannot exceed the finalized liability');
select public.statutory_filing_update(current_setting('test.statutory_filing')::uuid,'ACCEPTED','2026-11-05T12:00:00Z','SYNTHETIC-SUBMISSION','PAID',0,'2026-11-08T12:00:00Z','SYNTHETIC-REMITTANCE','Synthetic filing test');
select extensions.is((public.statutory_filing_list('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,25)->'items'->0->>'remittance_status'), 'PAID', 'authorized filing update records the reconciled remittance status');
select extensions.is((select count(*) from public.audit_logs where action='STATUTORY_FILING_UPDATED' and details ? 'remittance_reference'), 0::bigint, 'filing audit records financial status without copying external references');
select extensions.throws_ok($$select count(*) from public.statutory_filing_records$$, '42501', 'authenticated users cannot bypass filing RPC authorization through direct table reads');
reset role;

select * from extensions.finish();
rollback;


