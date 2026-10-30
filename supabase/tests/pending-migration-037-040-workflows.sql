\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- This file runs only against a local restore of the verified development dump.
-- All Auth/profile, company, employee, calendar, payroll, and audit test writes
-- are rolled back before the session exits. The inserted Auth users are direct
-- local fixtures; this does not call Supabase Auth or send messages.

SELECT gen_random_uuid()::text AS nonce \gset
SELECT id::text AS portfolio_id FROM public.client_portfolios ORDER BY created_at LIMIT 1 \gset
SELECT gen_random_uuid()::text AS bm_id,
       gen_random_uuid()::text AS hr1_id,
       gen_random_uuid()::text AS hr2_id,
       gen_random_uuid()::text AS preparer_id,
       gen_random_uuid()::text AS approver_id,
       gen_random_uuid()::text AS payroll_reviewer_id,
       gen_random_uuid()::text AS company_a_id,
       gen_random_uuid()::text AS company_b_id,
       gen_random_uuid()::text AS branch_a_id,
       gen_random_uuid()::text AS branch_a2_id,
       gen_random_uuid()::text AS branch_b_id \gset

CREATE FUNCTION pg_temp.gb_expect_sqlstate(p_statement text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = p_expected THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected SQLSTATE %, received %', p_expected, v_state;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE % but statement succeeded', p_expected;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.gb_expect_sqlstate(text,text) TO authenticated, anon;

INSERT INTO auth.users(
  instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,is_anonymous
) VALUES
('00000000-0000-0000-0000-000000000000', :'bm_id'::uuid,'authenticated','authenticated','bm-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic Branch Manager"}',now(),now(),false),
('00000000-0000-0000-0000-000000000000', :'hr1_id'::uuid,'authenticated','authenticated','hr1-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic HR Reviewer One"}',now(),now(),false),
('00000000-0000-0000-0000-000000000000', :'hr2_id'::uuid,'authenticated','authenticated','hr2-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic HR Reviewer Two"}',now(),now(),false),
('00000000-0000-0000-0000-000000000000', :'preparer_id'::uuid,'authenticated','authenticated','prep-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic Payroll Preparer"}',now(),now(),false),
('00000000-0000-0000-0000-000000000000', :'approver_id'::uuid,'authenticated','authenticated','approver-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic Payroll Approver"}',now(),now(),false),
('00000000-0000-0000-0000-000000000000', :'payroll_reviewer_id'::uuid,'authenticated','authenticated','reviewer-'||:'nonce'||'@example.invalid',now(),'{}','{"display_name":"Synthetic Restricted Payroll Reviewer"}',now(),now(),false);

INSERT INTO public.profiles(id,display_name) VALUES
(:'bm_id'::uuid,'Synthetic Branch Manager'),(:'hr1_id'::uuid,'Synthetic HR Reviewer One'),
(:'hr2_id'::uuid,'Synthetic HR Reviewer Two'),(:'preparer_id'::uuid,'Synthetic Payroll Preparer'),
(:'approver_id'::uuid,'Synthetic Payroll Approver'),(:'payroll_reviewer_id'::uuid,'Synthetic Restricted Payroll Reviewer') ON CONFLICT(id) DO NOTHING;

INSERT INTO public.companies(
  id,portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person
) VALUES
(:'company_a_id'::uuid, :'portfolio_id'::uuid, 'GBHR LOCAL MIGRATION TEST A '||:'nonce', 'MIG-A-'||:'nonce', 'MIG-A-'||:'nonce', 'Synthetic testing', 'qa-a-'||:'nonce'||'@example.invalid', '0000000000', 'Lusaka', 'Lusaka', 'Synthetic test location', 'Synthetic contact'),
(:'company_b_id'::uuid, :'portfolio_id'::uuid, 'GBHR LOCAL MIGRATION TEST B '||:'nonce', 'MIG-B-'||:'nonce', 'MIG-B-'||:'nonce', 'Synthetic testing', 'qa-b-'||:'nonce'||'@example.invalid', '0000000000', 'Lusaka', 'Lusaka', 'Synthetic test location', 'Synthetic contact');

INSERT INTO public.branches(id,portfolio_id,company_id,name,code,province,town,physical_address) VALUES
(:'branch_a_id'::uuid, :'portfolio_id'::uuid, :'company_a_id'::uuid, 'Synthetic Branch A', 'MIGA', 'Lusaka', 'Lusaka', 'Synthetic location A'),
(:'branch_a2_id'::uuid, :'portfolio_id'::uuid, :'company_a_id'::uuid, 'Synthetic Branch A2', 'MIGA2', 'Lusaka', 'Lusaka', 'Synthetic location A2'),
(:'branch_b_id'::uuid, :'portfolio_id'::uuid, :'company_b_id'::uuid, 'Synthetic Company B Branch', 'MIGB', 'Lusaka', 'Lusaka', 'Synthetic location B');

INSERT INTO public.portfolio_memberships(portfolio_id,user_id,role) VALUES
(:'portfolio_id'::uuid, :'bm_id'::uuid, 'BRANCH_MANAGER'),
(:'portfolio_id'::uuid, :'hr1_id'::uuid, 'OVERALL_HR_MANAGER'),
(:'portfolio_id'::uuid, :'hr2_id'::uuid, 'OVERALL_HR_MANAGER');
INSERT INTO public.branch_assignments(portfolio_id,company_id,branch_id,user_id,role,assigned_by) VALUES
(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid, :'bm_id'::uuid, 'BRANCH_MANAGER', :'hr1_id'::uuid);
INSERT INTO public.company_memberships(portfolio_id,company_id,user_id,role,created_by) VALUES
(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'preparer_id'::uuid, 'COMPANY_PAYROLL_PREPARER', :'hr1_id'::uuid),
(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'approver_id'::uuid, 'COMPANY_PAYROLL_APPROVER', :'hr1_id'::uuid);

\echo TEST audited reviewer assignment, self-assignment denial, and scoped permissions
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.assign_company_payroll_reviewer(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'payroll_reviewer_id'::uuid);
SELECT pg_temp.gb_expect_sqlstate(format('select public.assign_company_payroll_reviewer(%L::uuid,%L::uuid,%L::uuid)',
  :'portfolio_id', :'company_a_id', :'hr1_id'), '42501');
RESET ROLE;

\echo TEST restricted payroll reviewer company scope and denied permissions
SELECT set_config('request.jwt.claim.sub', :'payroll_reviewer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'payroll_reviewer_id','role','authenticated')::text, true);
SELECT CASE WHEN app_private.has_permission('payroll.view', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND app_private.has_permission('payroll.review', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND app_private.has_permission('payroll.approve', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid) THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN NOT app_private.has_permission('payroll.finalize', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND NOT app_private.has_permission('payroll.prepare', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND NOT app_private.has_permission('payroll.submit', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND NOT app_private.has_permission('employee.edit', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND NOT app_private.has_permission('compensation.edit', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid) THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN NOT app_private.has_permission('payroll.approve', :'portfolio_id'::uuid, :'company_b_id'::uuid, :'branch_b_id'::uuid) THEN 'PASS' ELSE 'FAIL' END;

\echo TEST branch manager creates and submits synthetic employees in assigned branch
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid,
  jsonb_build_object('employee_number','MIG-E1-'||:'nonce','first_name','Synthetic','last_name','Hire16','date_of_birth','1990-01-01','gender','FEMALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-10-16'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-10-16','salary_frequency','MONTHLY','basic_pay',4500,'housing_allowance',1000,'allowance_proration_rules',jsonb_build_object('housing_allowance','SCHEDULED_DAYS'),'payment_method','CASH')) AS employee_e1 \gset
SELECT public.employee_submit_for_hr_approval(:'employee_e1'::uuid);
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid,
  jsonb_build_object('employee_number','MIG-E2-'||:'nonce','first_name','Synthetic','last_name','FullMonth','date_of_birth','1990-01-01','gender','MALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-10-01'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-10-01','salary_frequency','MONTHLY','basic_pay',4500,'payment_method','CASH')) AS employee_e2 \gset
SELECT public.employee_submit_for_hr_approval(:'employee_e2'::uuid);
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid,
  jsonb_build_object('employee_number','MIG-E3-'||:'nonce','first_name','Synthetic','last_name','Hire30','date_of_birth','1990-01-01','gender','FEMALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-10-30'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-10-30','salary_frequency','MONTHLY','basic_pay',4500,'payment_method','CASH')) AS employee_e3 \gset
SELECT public.employee_submit_for_hr_approval(:'employee_e3'::uuid);
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid,
  jsonb_build_object('employee_number','MIG-E4-'||:'nonce','first_name','Synthetic','last_name','AfterPeriod','date_of_birth','1990-01-01','gender','MALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-11-02'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-11-02','salary_frequency','MONTHLY','basic_pay',4500,'payment_method','CASH')) AS employee_e4 \gset
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_create_draft(%L::uuid,%L::uuid,%L::uuid,%L::jsonb,%L::jsonb,%L::jsonb)',
  :'portfolio_id', :'company_a_id', :'branch_a2_id', '{}', '{}', '{}'), '42501');
RESET ROLE;

\echo TEST HR approval and branch-scoped compensation request with independent review
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_review_submission(:'employee_e1'::uuid,'APPROVE');
SELECT public.employee_review_submission(:'employee_e2'::uuid,'APPROVE');
SELECT public.employee_review_submission(:'employee_e3'::uuid,'APPROVE');
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a2_id'::uuid,
  jsonb_build_object('employee_number','MIG-A2-'||:'nonce','first_name','Synthetic','last_name','BranchA2','date_of_birth','1990-01-01','gender','FEMALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-10-16'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-10-19','salary_frequency','MONTHLY','basic_pay',4500,'payment_method','CASH')) AS employee_branch_a2 \gset
SELECT public.employee_submit_for_hr_approval(:'employee_branch_a2'::uuid);
SELECT public.employee_create_draft(:'portfolio_id'::uuid, :'company_b_id'::uuid, :'branch_b_id'::uuid,
  jsonb_build_object('employee_number','MIG-XCO-'||:'nonce','first_name','Synthetic','last_name','OtherCompany','date_of_birth','1990-01-01','gender','MALE','nationality','Zambian','job_title','Test analyst','department','Synthetic QA','employment_type','PERMANENT','contract_type','PERMANENT','contract_start_date','2026-10-16'),
  jsonb_build_object('identity_document_type','OTHER','identity_document_number','SYNTHETIC-ONLY','residential_address','Synthetic test location','phone','0000000000','email_unavailable_reason','Synthetic account','emergency_contact_name','Synthetic contact','emergency_contact_relationship','Test','emergency_contact_phone','0000000000','payment_method','CASH'),
  jsonb_build_object('effective_from','2026-10-16','salary_frequency','MONTHLY','basic_pay',4500,'payment_method','CASH')) AS employee_cross_company \gset
SELECT public.employee_submit_for_hr_approval(:'employee_cross_company'::uuid);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_review_submission(:'employee_branch_a2'::uuid,'APPROVE');
SELECT public.employee_review_submission(:'employee_cross_company'::uuid,'APPROVE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_b_id'::uuid,:'branch_b_id'::uuid,'2026-10-01','2026-10-31',:'employee_cross_company'::uuid,11,11,0,0,0,'PERMANENT','Synthetic company B attendance');
SELECT public.attendance_submit_period(id) FROM public.attendance_periods WHERE company_id=:'company_b_id'::uuid AND branch_id=:'branch_b_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_review_period(id,'APPROVE') FROM public.attendance_periods WHERE company_id=:'company_b_id'::uuid AND branch_id=:'branch_b_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.payroll_create_draft(:'company_b_id'::uuid,:'branch_b_id'::uuid,'2026-10-01','2026-10-31','MONTHLY','synthetic-run-b-'||:'nonce') AS run_b \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.leave_policy_save_configured(:'company_a_id'::uuid,NULL,'Synthetic unpaid leave','UNPAID',0,NULL,'2026-01-01',NULL,'WORKING_DAYS',NULL) AS unpaid_policy \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.leave_create_request_calculated(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a_id'::uuid,
  :'employee_e2'::uuid,:'unpaid_policy'::uuid,'2026-10-15','2026-10-15','Synthetic one-day unpaid leave','leave-'||:'nonce') AS unpaid_leave_request \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.leave_request_transition(:'unpaid_leave_request'::uuid,'APPROVE');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_change_capabilities(:'employee_e1'::uuid)::text;
SELECT CASE WHEN (public.employee_change_capabilities(:'employee_e1'::uuid)->>'can_request_compensation')::boolean THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (public.employee_change_capabilities(:'employee_e1'::uuid)->>'can_review')::boolean = false THEN 'PASS' ELSE 'FAIL' END;
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_change_capabilities(%L::uuid)', :'employee_branch_a2'), '42501');
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_change_capabilities(%L::uuid)', :'employee_cross_company'), '42501');
SELECT public.employee_change_request_create(:'employee_e1'::uuid, '{}'::jsonb,
  jsonb_build_object('effective_from','2026-10-23','basic_pay',4800), 'Synthetic salary change test') AS salary_request \gset
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_change_request_review(%L::uuid,%L,%L)', :'salary_request','APPROVE',''), '42501');
SELECT CASE WHEN jsonb_array_length(public.employee_change_requests_list()) = 0 THEN 'PASS' ELSE 'FAIL' END;
RESET ROLE;

\echo TEST independent employee salary approval and effective-dated history
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_change_request_review(:'salary_request'::uuid,'APPROVE');
RESET ROLE;
SELECT CASE WHEN (SELECT count(*) FROM public.employee_compensation WHERE employee_id=:'employee_e1'::uuid)=2 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM public.employee_compensation WHERE employee_id=:'employee_e1'::uuid AND basic_pay=4500 AND effective_to='2026-10-22')
  AND EXISTS(SELECT 1 FROM public.employee_compensation WHERE employee_id=:'employee_e1'::uuid AND basic_pay=4800 AND effective_from='2026-10-23' AND effective_to IS NULL)
  THEN 'PASS' ELSE 'FAIL' END;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_change_request_create(%L::uuid,%L::jsonb,%L::jsonb,%L)',
  :'employee_e1','{}','{"effective_from":"2026-10-20","basic_pay":5000}','Synthetic overlapping version'), '22023');

\echo TEST approved branch calendars, attendance correction and payroll invalidation
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.branch_work_calendar_request(:'company_a_id'::uuid, :'branch_a_id'::uuid, '2026-10-01','2026-10-31',
  ARRAY(SELECT d::date FROM generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d WHERE extract(isodow FROM d)<=5), 'Synthetic approved schedule A') AS cal_a \gset
SELECT public.branch_work_calendar_request(:'company_a_id'::uuid, :'branch_a2_id'::uuid, '2026-10-01','2026-10-31',
  ARRAY(SELECT d::date FROM (SELECT d FROM generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d WHERE extract(isodow FROM d)<=5 ORDER BY d LIMIT 18) q), 'Synthetic approved schedule A2') AS cal_a2 \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.branch_work_calendar_review(:'cal_a'::uuid,'APPROVE');
SELECT public.branch_work_calendar_review(:'cal_a2'::uuid,'APPROVE');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SELECT CASE WHEN app_private.has_permission('branch.calendar.manage', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid)
  AND NOT app_private.has_permission('branch.calendar.manage', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a2_id'::uuid)
  AND NOT app_private.has_permission('branch.edit', :'portfolio_id'::uuid, :'company_a_id'::uuid, :'branch_a_id'::uuid) THEN 'PASS' ELSE 'FAIL' END;
SET LOCAL ROLE authenticated;
SELECT CASE WHEN (public.branch_work_calendar_capabilities(:'company_a_id'::uuid,:'branch_a_id'::uuid)->>'can_manage')::boolean THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN NOT (public.branch_work_calendar_capabilities(:'company_a_id'::uuid,:'branch_a2_id'::uuid)->>'can_manage')::boolean
  THEN 'PASS' ELSE 'FAIL' END;
SELECT public.branch_work_calendar_request(:'company_a_id'::uuid, :'branch_a_id'::uuid, '2026-11-01','2026-11-30',
  ARRAY(SELECT d::date FROM generate_series('2026-11-01'::date,'2026-11-30'::date,interval '1 day') d WHERE extract(isodow FROM d)<=5), 'Synthetic branch manager calendar request') AS cal_bm \gset
SELECT pg_temp.gb_expect_sqlstate(format('select public.branch_work_calendar_review(%L::uuid,%L,%L)', :'cal_bm','APPROVE',''), '42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.branch_work_calendar_review(:'cal_bm'::uuid,'APPROVE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31',:'employee_e1'::uuid,11,11,0,0,0,'PERMANENT','Initial synthetic entry');
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31',:'employee_e2'::uuid,22,21,0,1,0,'PERMANENT','Synthetic unpaid leave');
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31',:'employee_e3'::uuid,1,1,0,0,0,'PERMANENT','Final scheduled day');
SELECT pg_temp.gb_expect_sqlstate(format('select public.attendance_save_entry(%L::uuid,%L::uuid,%L::uuid,%L::date,%L::date,%L::uuid,1,1,0,0,0,%L)',
  :'portfolio_id',:'company_a_id',:'branch_a2_id','2026-10-01','2026-10-31',:'employee_e1','PERMANENT'), '42501');
SELECT public.attendance_submit_period(id) FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr1_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr1_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a2_id'::uuid,'2026-10-01','2026-10-31',:'employee_branch_a2'::uuid,6,6,0,0,0,'PERMANENT','Branch A2 schedule');
SELECT public.attendance_submit_period(id) FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a2_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_review_period(id,'APPROVE') FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a_id'::uuid AND period_start='2026-10-01';
SELECT public.attendance_review_period(id,'APPROVE') FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a2_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_request_approved_correction(id,'Synthetic correction and reapproval test') FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'preparer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'preparer_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gb_expect_sqlstate(format('select public.payroll_create_draft(%L::uuid,%L::uuid,%L::date,%L::date,%L,%L)',
  :'company_a_id',:'branch_a_id','2026-10-01','2026-10-31','MONTHLY','test-correction-block-'||:'nonce'), '22023');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_save_entry(:'portfolio_id'::uuid,:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31',:'employee_e1'::uuid,11,11,0,0,0,'PERMANENT','Synthetic corrected entry');
SELECT public.attendance_submit_period(id) FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a_id'::uuid AND period_start='2026-10-01';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'hr2_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'hr2_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.attendance_review_period(id,'APPROVE') FROM public.attendance_periods WHERE company_id=:'company_a_id'::uuid AND branch_id=:'branch_a_id'::uuid AND period_start='2026-10-01';
RESET ROLE;

\echo TEST monthly proration, configured unpaid leave, payroll calculation and separation of duties
SELECT set_config('request.jwt.claim.sub', :'preparer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'preparer_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.employee_compensation_set_unpaid_leave_method(:'employee_e2'::uuid,'2026-10-01','BASIC_PER_SCHEDULED_WORKDAY');
SELECT public.payroll_create_draft(:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31','MONTHLY','test-proration-a-'||:'nonce') AS run_a \gset
SELECT public.payroll_preview_inputs(:'company_a_id'::uuid,:'branch_a_id'::uuid,'2026-10-01','2026-10-31')::text AS preview_a \gset
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'payroll_reviewer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'payroll_reviewer_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT CASE WHEN (SELECT count(*) FROM public.payroll_runs WHERE id=:'run_a'::uuid)=1 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT count(*) FROM public.payroll_runs WHERE id=:'run_b'::uuid)=0 THEN 'PASS' ELSE 'FAIL' END;
SELECT pg_temp.gb_expect_sqlstate(format('select public.payroll_create_draft(%L::uuid,%L::uuid,%L::date,%L::date,%L,%L)',
  :'company_a_id', :'branch_a_id', '2026-10-01', '2026-10-31', 'MONTHLY', 'reviewer-must-not-prepare-'||:'nonce'), '42501');
RESET ROLE;
SELECT CASE WHEN (SELECT (i->>'basic_pay')::numeric FROM jsonb_array_elements(:'preview_a'::jsonb->'items') i WHERE i->>'employee_id'=:'employee_e1')=2331.82 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT (i->>'housing_allowance')::numeric FROM jsonb_array_elements(:'preview_a'::jsonb->'items') i WHERE i->>'employee_id'=:'employee_e1')=500 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT (i->>'basic_pay')::numeric FROM jsonb_array_elements(:'preview_a'::jsonb->'items') i WHERE i->>'employee_id'=:'employee_e2')=4500 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT (i #>> '{attendance,unpaid_leave_days}')::numeric FROM jsonb_array_elements(:'preview_a'::jsonb->'items') i WHERE i->>'employee_id'=:'employee_e2')=1 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT (i->>'basic_pay')::numeric FROM jsonb_array_elements(:'preview_a'::jsonb->'items') i WHERE i->>'employee_id'=:'employee_e3')=204.55 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (app_private.payroll_employee_proration(:'employee_branch_a2'::uuid,'2026-10-01','2026-10-31',ARRAY(SELECT d::date FROM (SELECT d FROM generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d WHERE extract(isodow FROM d)<=5 ORDER BY d LIMIT 18) q))->>'basic_pay')::numeric=1500 THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (app_private.payroll_employee_proration(:'employee_e4'::uuid,'2026-10-01','2026-10-31',ARRAY(SELECT d::date FROM generate_series('2026-10-01'::date,'2026-10-31'::date,interval '1 day') d WHERE extract(isodow FROM d)<=5))->>'eligible_scheduled_days')::integer=0 THEN 'PASS' ELSE 'FAIL' END;

SELECT set_config('request.jwt.claim.sub', :'preparer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'preparer_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.payroll_calculate(:'run_a'::uuid,'test-calculation-a-'||:'nonce');
SELECT CASE WHEN EXISTS(SELECT 1 FROM public.payroll_run_items WHERE payroll_run_id=:'run_a'::uuid AND employee_id=:'employee_e2'::uuid AND attendance_deduction=round(4500::numeric/22,2)) THEN 'PASS' ELSE 'FAIL' END;
SELECT public.payroll_submit_for_approval(:'run_a'::uuid);
SELECT pg_temp.gb_expect_sqlstate(format('select public.payroll_review_submission(%L::uuid,%L,version,%L) from public.payroll_runs where id=%L::uuid',
  :'run_a','START_REVIEW','Synthetic self-review denial',:'run_a'), '42501');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'payroll_reviewer_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'payroll_reviewer_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.payroll_review_submission(:'run_a'::uuid,'START_REVIEW',(SELECT version FROM public.payroll_runs WHERE id=:'run_a'::uuid));
SELECT public.payroll_review_submission(:'run_a'::uuid,'APPROVE',(SELECT version FROM public.payroll_runs WHERE id=:'run_a'::uuid));
SELECT pg_temp.gb_expect_sqlstate(format('select public.payroll_finalize(%L::uuid)', :'run_a'), '42501');
RESET ROLE;
SELECT CASE WHEN EXISTS(SELECT 1 FROM public.payroll_runs WHERE id=:'run_a'::uuid AND status='APPROVED' AND reviewed_by=:'payroll_reviewer_id'::uuid AND finalized_at IS NULL) THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN EXISTS(SELECT 1 FROM public.payroll_run_items WHERE payroll_run_id=:'run_a'::uuid AND employee_id=:'employee_e1'::uuid AND basic_pay=2331.82) THEN 'PASS' ELSE 'FAIL' END;
SELECT CASE WHEN (SELECT count(*) FROM public.audit_logs WHERE company_id=:'company_a_id'::uuid AND action IN ('EMPLOYEE_CHANGE_REQUESTED','EMPLOYEE_CHANGE_APPROVE','ATTENDANCE_APPROVED_CORRECTION_REQUESTED','PAYROLL_APPROVE')) >= 4 THEN 'PASS' ELSE 'FAIL' END;
SELECT set_config('request.jwt.claim.sub', :'bm_id', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',:'bm_id','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.gb_expect_sqlstate(format('select public.employee_change_request_create(%L::uuid,%L::jsonb,%L::jsonb,%L)',
  :'employee_e1','{}','{"effective_from":"2026-10-30","basic_pay":4900}','Retroactive payroll mutation denial'), '55000');
RESET ROLE;

\echo PASS migration 037-041 synthetic workflow assertions passed; rolling back all test fixtures
ROLLBACK;
