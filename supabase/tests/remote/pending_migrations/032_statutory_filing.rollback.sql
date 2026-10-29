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
\ir ../../../migrations/20261029003000_workspace_notifications_and_settings.sql
\ir ../../../migrations/20261029003100_payroll_payout_reconciliation.sql
\ir ../../../migrations/20261029003200_statutory_filing_tracking.sql
do $$
begin
  if not exists(select 1 from pg_class where oid='public.statutory_filing_records'::regclass and relrowsecurity) then raise exception 'statutory filing RLS missing'; end if;
  if has_table_privilege('authenticated','public.statutory_filing_records','SELECT') or has_table_privilege('authenticated','public.statutory_filing_records','INSERT') or has_table_privilege('authenticated','public.statutory_filing_records','UPDATE') then raise exception 'direct statutory filing table privilege unexpectedly granted'; end if;
  if not has_function_privilege('authenticated','public.statutory_filing_list(uuid,uuid,integer,integer)','EXECUTE') or not has_function_privilege('authenticated','public.statutory_filing_prepare(uuid,text,date)','EXECUTE') or not has_function_privilege('authenticated','public.statutory_filing_update(uuid,text,timestamptz,text,text,numeric,timestamptz,text,text)','EXECUTE') then raise exception 'statutory filing RPC grants incomplete'; end if;
  if has_function_privilege('anon','public.statutory_filing_update(uuid,text,timestamptz,text,text,numeric,timestamptz,text,text)','EXECUTE') then raise exception 'anon can update statutory filing'; end if;
end $$;
rollback;
\echo 'ROLLBACK_COMPLETE_032'
