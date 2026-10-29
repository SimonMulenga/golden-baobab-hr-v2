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
do $$
begin
  if not exists(select 1 from pg_class where oid='public.payroll_payout_reconciliations'::regclass and relrowsecurity) then raise exception 'payout reconciliation RLS missing'; end if;
  if has_table_privilege('authenticated','public.payroll_payout_reconciliations','SELECT') or has_table_privilege('authenticated','public.payroll_payout_reconciliations','INSERT') or has_table_privilege('authenticated','public.payroll_payout_reconciliations','UPDATE') then raise exception 'direct payout reconciliation table privilege unexpectedly granted'; end if;
  if not has_function_privilege('authenticated','public.payroll_payout_reconciliation_batches(uuid,uuid)','EXECUTE') or not has_function_privilege('authenticated','public.payroll_payout_reconciliation_detail(uuid,integer,integer)','EXECUTE') or not has_function_privilege('authenticated','public.payroll_payout_reconciliation_save(uuid,uuid,text,numeric,date,text,text)','EXECUTE') then raise exception 'payout reconciliation RPC grants incomplete'; end if;
  if has_function_privilege('anon','public.payroll_payout_reconciliation_save(uuid,uuid,text,numeric,date,text,text)','EXECUTE') then raise exception 'anon can write payout reconciliation'; end if;
end $$;
rollback;
\echo 'ROLLBACK_COMPLETE_031'
