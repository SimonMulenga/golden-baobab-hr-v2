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
do $$
begin
  if not exists(select 1 from pg_class where oid='public.user_notifications'::regclass and relrowsecurity) then raise exception 'notification RLS missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='user_notifications')<>2 then raise exception 'notification owner policies missing'; end if;
  if has_table_privilege('authenticated','public.user_notifications','INSERT') or has_table_privilege('authenticated','public.user_notifications','DELETE') then raise exception 'direct notification insert/delete unexpectedly granted'; end if;
  if not has_column_privilege('authenticated','public.user_notifications','read_at','UPDATE') then raise exception 'recipient read-state update grant missing'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('employee_workflow_notification','leave_workflow_notification','attendance_workflow_notification','payroll_workflow_notification'))<>4 then raise exception 'workflow notification trigger set incomplete'; end if;
  if not has_function_privilege('authenticated','public.company_workspace_settings_save(uuid,text,text,text,integer)','EXECUTE') then raise exception 'settings RPC grant missing'; end if;
end $$;
rollback;
\echo 'ROLLBACK_COMPLETE_030'
