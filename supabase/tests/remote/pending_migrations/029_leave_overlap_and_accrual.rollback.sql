\set ON_ERROR_STOP on
\if :{?confirm_disposable_target}
\else
  \echo 'Refusing to run: pass -v confirm_disposable_target=on only after verifying a disposable target.'
  \quit 3
\endif
\if :confirm_disposable_target
\else
  \echo 'Refusing to run: confirm_disposable_target must be on.'
  \quit 3
\endif
begin;
set local statement_timeout='5min';
set local lock_timeout='5s';
\ir ../../../migrations/20261029002800_hr_configuration_employee_documents.sql
\ir ../../../migrations/20261029002900_attendance_leave_calendar_workflows.sql

do $$
begin
  if exists(select 1 from auth.users where id='f0290000-0000-4000-8000-000000000001')
     or exists(select 1 from public.companies where registration_number in ('PENDING-029-TEST-A','PENDING-029-TEST-B')) then
    raise exception 'Migration 029 synthetic fixture IDs already exist; refusing to reuse them.';
  end if;
end $$;

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values ('f0290000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','migration-029-overlap@example.invalid','',now(),'{}','{}',now(),now(),false,false);
insert into public.profiles(id,display_name) values ('f0290000-0000-4000-8000-000000000001','Synthetic migration 029 owner');
insert into public.client_portfolios(id,name) values ('f0290000-0000-4000-8000-000000000002','Synthetic migration 029 portfolio');
insert into public.portfolio_memberships(portfolio_id,user_id,role)
values ('f0290000-0000-4000-8000-000000000002','f0290000-0000-4000-8000-000000000001','PORTFOLIO_ADMIN');
insert into public.companies(id,portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person)
values
  ('f0290000-0000-4000-8000-000000000003','f0290000-0000-4000-8000-000000000002','Synthetic policy company A','PENDING-029-TEST-A','SYN-029-A','Services','a@example.invalid','+260000000029','Lusaka','Lusaka','Synthetic','Test'),
  ('f0290000-0000-4000-8000-000000000004','f0290000-0000-4000-8000-000000000002','Synthetic policy company B','PENDING-029-TEST-B','SYN-029-B','Services','b@example.invalid','+260000000030','Lusaka','Lusaka','Synthetic','Test');
insert into public.branches(id,portfolio_id,company_id,name,code,province,town,physical_address)
values ('f0290000-0000-4000-8000-000000000005','f0290000-0000-4000-8000-000000000002','f0290000-0000-4000-8000-000000000003','Synthetic branch','M29','Lusaka','Lusaka','Synthetic');
insert into public.employees(
  id,portfolio_id,company_id,workplace_branch_id,employee_number,first_name,last_name,date_of_birth,
  nationality,job_title,department,employment_type,contract_type,contract_start_date,approval_status,created_by,submitted_at,reviewed_by,reviewed_at
) values (
  'f0290000-0000-4000-8000-000000000006','f0290000-0000-4000-8000-000000000002','f0290000-0000-4000-8000-000000000003','f0290000-0000-4000-8000-000000000005',
  'M29-SYN-001','Synthetic','Employee','1990-01-01','ZM','Test role','Test department','PERMANENT','MONTHLY','2020-01-01','APPROVED',
  'f0290000-0000-4000-8000-000000000001',now(),'f0290000-0000-4000-8000-000000000001',now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f0290000-0000-4000-8000-000000000001',true);
do $$
declare v_policy uuid;v_replayed uuid;v_adjacent uuid;v_other_company uuid;v_first_count integer;v_second_count integer;v_ledger_rows integer;
begin
  v_policy:=public.leave_policy_save_configured('f0290000-0000-4000-8000-000000000003',null,'Annual leave','PAID',1.00,20,'2026-01-01','2026-12-31','WORKING_DAYS',10);
  v_replayed:=public.leave_policy_save_configured('f0290000-0000-4000-8000-000000000003',null,'Annual leave','PAID',1.00,20,'2026-01-01','2026-12-31','WORKING_DAYS',10);
  if v_replayed is distinct from v_policy then raise exception 'Identical leave policy replay did not return its original id.'; end if;

  begin
    perform public.leave_policy_save_configured('f0290000-0000-4000-8000-000000000003',null,'Annual leave','UNPAID',0,20,'2026-06-01','2027-05-31','WORKING_DAYS',null);
    raise exception 'Overlapping enabled leave policy was accepted.';
  exception when sqlstate '23P01' then null;
  end;

  v_adjacent:=public.leave_policy_save_configured('f0290000-0000-4000-8000-000000000003',null,'Annual leave','PAID',1.00,20,'2027-01-01',null,'WORKING_DAYS',10);
  if v_adjacent is null then raise exception 'Adjacent non-overlapping policy was not created.'; end if;
  v_other_company:=public.leave_policy_save_configured('f0290000-0000-4000-8000-000000000004',null,'Annual leave','PAID',1.00,20,'2026-01-01','2026-12-31','WORKING_DAYS',10);
  if v_other_company is null then raise exception 'Policy in a separate company was blocked by another company policy.'; end if;

  v_first_count:=public.leave_accrue_month(v_policy,'2026-10-01');
  v_second_count:=public.leave_accrue_month(v_policy,'2026-10-01');
  select count(*) into v_ledger_rows from public.leave_balance_ledger
  where employee_id='f0290000-0000-4000-8000-000000000006' and leave_policy_id=v_policy
    and event_type='ACCRUAL' and reference_id='2026-10';
  if v_first_count<>1 or v_second_count<>0 or v_ledger_rows<>1 then
    raise exception 'Monthly accrual replay was not idempotent (first %, replay %, ledger rows %).',v_first_count,v_second_count,v_ledger_rows;
  end if;
end $$;
reset role;
rollback;
\echo 'ROLLBACK_COMPLETE_029_LEAVE_OVERLAP_ACCRUAL'
