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
  if not exists(select 1 from pg_class where oid='public.attendance_period_history'::regclass and relrowsecurity) then raise exception 'attendance history RLS missing'; end if;
  if not exists(select 1 from pg_class where oid='public.leave_request_history'::regclass and relrowsecurity) then raise exception 'leave history RLS missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.leave_requests'::regclass and conname='leave_requests_status_check') then raise exception 'leave status constraint missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.leave_requests'::regclass and conname='leave_requests_review_state_check') then raise exception 'leave review-state constraint missing'; end if;
  if has_function_privilege('authenticated','public.leave_create_request(uuid,uuid,uuid,uuid,text,text,date,date,numeric,text,text)','EXECUTE') then raise exception 'legacy caller still has execute on removed leave request RPC'; end if;
  if has_function_privilege('authenticated','public.leave_policy_save(uuid,uuid,text,text,numeric,numeric,date,date)','EXECUTE') then raise exception 'legacy policy RPC still executable'; end if;
  if has_function_privilege('authenticated','public.leave_review_request(uuid,text,text)','EXECUTE') then raise exception 'legacy review RPC still executable'; end if;
  if not has_function_privilege('authenticated','public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text)','EXECUTE') then raise exception 'calculated leave request RPC not granted'; end if;
  if not has_function_privilege('authenticated','public.leave_request_transition(uuid,text,text)','EXECUTE') then raise exception 'leave transition RPC not granted'; end if;
end $$;
rollback;
\echo 'ROLLBACK_COMPLETE_029'
