-- Read-only migration readiness checks for development project Supabase.
-- Manually verify the connection host/project before execution. No row values,
-- credentials, URLs, employee identifiers or financial amounts are returned.
begin transaction read only;
set local statement_timeout='30s';
set local lock_timeout='5s';

select 'connection' as check_group,
       current_database() as database_name,
       current_user as current_role,
       current_setting('server_version') as server_version,
       coalesce(inet_server_addr()::text, 'local') as server_address,
       current_setting('port') as server_port;

with expected(version) as (values
  ('20261029002800'),('20261029002900'),('20261029003000'),('20261029003100'),('20261029003200')
)
select 'pending_migration' as check_group, e.version,
       exists(select 1 from supabase_migrations.schema_migrations m where m.version=e.version) as already_applied
from expected e order by e.version;

with expected(version) as (values
  ('20261028000100'),('20261028000200'),('20261028000300'),('20261028000400'),('20261028000500'),
  ('20261028000600'),('20261028000700'),('20261028000800'),('20261028000900'),('20261028001000'),
  ('20261028001100'),('20261028001200'),('20261028001300'),('20261028001400'),('20261028001500'),
  ('20261028001600'),('20261028001700'),('20261028001800'),('20261028001900'),('20261028002000'),
  ('20261028002100'),('20261028002200'),('20261028002300'),('20261028002400'),('20261028002500'),
  ('20261028002600'),('20261028002700')
)
select 'migration_history' as check_group,
       (select count(*) from supabase_migrations.schema_migrations) as applied_count,
       (select count(*) from expected e join supabase_migrations.schema_migrations m using(version)) as expected_applied_count,
       (select coalesce(string_agg(e.version,',' order by e.version),'') from expected e
         where not exists(select 1 from supabase_migrations.schema_migrations m where m.version=e.version)) as missing_versions,
       (select coalesce(string_agg(m.version,',' order by m.version),'') from supabase_migrations.schema_migrations m
         where m.version not in (select version from expected)) as unexpected_versions;

select 'supabase_dependencies' as check_group,
       to_regprocedure('auth.uid()') is not null as auth_uid_available,
       to_regclass('auth.users') is not null as auth_users_available,
       to_regclass('storage.buckets') is not null as storage_buckets_available,
       to_regclass('storage.objects') is not null as storage_objects_available,
       to_regclass('vault.secrets') is not null as vault_secrets_available,
       to_regprocedure('extensions.gen_random_uuid()') is not null
         or to_regprocedure('pg_catalog.gen_random_uuid()') is not null as uuid_generator_available;

select 'required_roles' as check_group, r.role_name, coalesce(p.oid is not null,false) as role_exists
from (values ('anon'),('authenticated'),('service_role'),('supabase_admin'),('supabase_storage_admin')) r(role_name)
left join pg_roles p on p.rolname=r.role_name order by r.role_name;

select 'extensions' as check_group, extname
from pg_extension
where extname in ('pgcrypto','uuid-ossp','pg_stat_statements','supabase_vault')
order by extname;

-- Migration 028 preserves the existing bucket. This check reports whether its
-- current settings match the migration contract; incompatible settings require
-- explicit owner review and must not be changed implicitly by the migration.
select 'employee_document_bucket' as check_group, id, public,
       file_size_limit, allowed_mime_types,
       (not public and file_size_limit=15728640
        and allowed_mime_types @> array['application/pdf','image/jpeg','image/png']::text[]
        and cardinality(allowed_mime_types)=3) as matches_migration_028_expected
from storage.buckets where id='gb-employee-documents';

select 'storage_object_policies' as check_group, policyname, roles, cmd,
       (coalesce(qual,'') like '%gb-employee-documents%'
        or coalesce(with_check,'') like '%gb-employee-documents%') as scoped_to_employee_document_bucket
from pg_policies where schemaname='storage' and tablename='objects'
order by policyname;

select 'leave_status_counts' as check_group, status, count(*) as row_count
from public.leave_requests group by status order by status;

select 'leave_preflight_violations' as check_group,
       count(*) filter (where status not in ('PENDING','APPROVED','REJECTED','RETURNED_FOR_CORRECTION','CANCELED')) as unsupported_status_rows,
       count(*) filter (where ((status in ('APPROVED','REJECTED','RETURNED_FOR_CORRECTION'))
                               is distinct from (reviewed_at is not null))) as review_timestamp_mismatch_rows
from public.leave_requests;

select 'leave_ledger_event_types' as check_group, event_type, count(*) as row_count,
       (event_type in ('ACCRUAL','PAID_LEAVE','ADJUSTMENT','REVERSAL','EXPIRY')) as supported_after_029
from public.leave_balance_ledger group by event_type order by event_type;

select 'enabled_leave_policy_overlaps' as check_group, count(*) as overlapping_policy_pairs
from public.leave_policies a
join public.leave_policies b on a.portfolio_id=b.portfolio_id and a.company_id=b.company_id
  and a.leave_type=b.leave_type and a.id<b.id
  and daterange(a.effective_from,a.effective_to,'[]')
      && daterange(b.effective_from,b.effective_to,'[]')
where a.enabled and b.enabled;

select 'leave_existing_checks' as check_group, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid='public.leave_requests'::regclass and contype='c'
order by conname;

select 'leave_ledger_existing_checks' as check_group, conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid='public.leave_balance_ledger'::regclass and contype='c'
order by conname;

select 'leave_rpc_compatibility' as check_group, signature,
       to_regprocedure(signature) is not null as exists_now,
       case when to_regprocedure(signature) is null then null
            else has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE') end as authenticated_can_execute_now
from (values
  ('public.leave_create_request(uuid,uuid,uuid,uuid,text,text,date,date,numeric,text,text)'),
  ('public.leave_review_request(uuid,text,text)'),
  ('public.leave_accrue_month(uuid,date)')
) f(signature);

select 'migration_031_unique_index_preflight' as check_group,
       count(*) as duplicate_export_ids
from (select id from public.payroll_payout_exports group by id having count(*)>1) d;

select 'migration_032_source_columns' as check_group,
       to_regclass('public.payroll_runs') is not null as payroll_runs_available,
       to_regclass('public.payroll_run_items') is not null as payroll_items_available,
       to_regclass('public.payroll_periods') is not null as payroll_periods_available,
       to_regclass('public.audit_logs') is not null as audit_logs_available;

select 'pending_object_collisions' as check_group, object_name, object_exists
from (values
  ('departments',to_regclass('public.departments') is not null),
  ('job_roles',to_regclass('public.job_roles') is not null),
  ('employee_documents',to_regclass('public.employee_documents') is not null),
  ('attendance_period_history',to_regclass('public.attendance_period_history') is not null),
  ('leave_calendar_exceptions',to_regclass('public.leave_calendar_exceptions') is not null),
  ('leave_request_history',to_regclass('public.leave_request_history') is not null),
  ('company_workspace_settings',to_regclass('public.company_workspace_settings') is not null),
  ('user_notifications',to_regclass('public.user_notifications') is not null),
  ('payroll_payout_reconciliations',to_regclass('public.payroll_payout_reconciliations') is not null),
  ('statutory_filing_records',to_regclass('public.statutory_filing_records') is not null)
) collisions(object_name,object_exists) order by object_name;

rollback;
