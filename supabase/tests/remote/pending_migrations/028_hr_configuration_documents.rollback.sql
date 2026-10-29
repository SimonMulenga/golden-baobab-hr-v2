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
do $$
begin
  if not exists (select 1 from pg_class where oid='public.employee_documents'::regclass and relrowsecurity) then raise exception 'employee_documents RLS missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='employee_documents')<>1 then raise exception 'employee_documents policy contract mismatch'; end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('employee_documents_storage_read','employee_documents_storage_insert','employee_documents_storage_remove_unregistered_upload'))<>3 then raise exception 'employee document Storage policies missing'; end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE' and policyname like 'employee_documents_storage_%_guard')<>8 then raise exception 'employee document restrictive Storage guards missing'; end if;
  if not exists(select 1 from storage.buckets where id='gb-employee-documents' and public=false and file_size_limit=15728640 and cardinality(allowed_mime_types)=3) then raise exception 'private employee document bucket settings missing'; end if;
  if not (select prosecdef from pg_proc where oid='public.employee_document_register(uuid,text,text,text,text,bigint)'::regprocedure) then raise exception 'document registration RPC is not SECURITY DEFINER'; end if;
  if has_function_privilege('anon','public.employee_document_register(uuid,text,text,text,text,bigint)','EXECUTE') then raise exception 'anon can execute document registration'; end if;
end $$;
rollback;
\echo 'ROLLBACK_COMPLETE_028'
