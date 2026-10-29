-- One request creates a durable import job and all validated employees in a
-- single transaction. A subtransaction around employee writes guarantees that
-- unexpected database/permission errors leave no partial employee records.

create table public.employee_import_jobs (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('COMPLETED','VALIDATION_FAILED','FAILED')),
  total_rows integer not null check (total_rows between 0 and 5000),
  imported_rows integer not null default 0 check (imported_rows between 0 and total_rows),
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  failure_code text,
  created_at timestamptz not null default now(),
  unique (initiated_by, portfolio_id, company_id, branch_id, idempotency_key),
  unique (portfolio_id, company_id, branch_id, id),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict
);
create index employee_import_jobs_scope_idx
  on public.employee_import_jobs(portfolio_id, company_id, branch_id, created_at desc, id);
-- Enforce canonical employee-number uniqueness at the database boundary.
-- This also closes the race between imports using different idempotency keys.
create unique index employees_company_employee_number_ci_unique
  on public.employees(company_id, lower(btrim(employee_number)));
alter table public.employee_import_jobs enable row level security;
revoke all on public.employee_import_jobs from public, anon, authenticated;
create policy employee_import_jobs_read_authorized on public.employee_import_jobs
  for select to authenticated using (
    app_private.has_permission('employee.view', portfolio_id, company_id, branch_id)
  );
grant select on public.employee_import_jobs to authenticated;

create or replace function public.employee_import_atomic(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_idempotency_key text,
  p_rows jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_job public.employee_import_jobs%rowtype;
  v_row jsonb;
  v_errors jsonb;
  v_count integer;
  v_imported integer := 0;
  v_employee_id uuid;
  v_code text;
  v_request_sha256 text;
begin
  if auth.uid() is null or nullif(btrim(p_idempotency_key), '') is null
      or jsonb_typeof(p_rows) is distinct from 'array'
      or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 5000
      or pg_column_size(p_rows) > 6000000 then
    raise exception using errcode='22023', message='Import request is invalid or exceeds the supported size.';
  end if;
  if not app_private.has_permission('employee.import', p_portfolio_id, p_company_id, p_branch_id)
      or not app_private.has_permission('employee.create', p_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode='42501', message='Employee import is not authorized for this branch.';
  end if;
  v_request_sha256 := encode(extensions.digest(p_rows::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_portfolio_id::text || ':' || p_company_id::text || ':' || p_branch_id::text || ':' || p_idempotency_key, 0));
  select * into v_job from public.employee_import_jobs
    where initiated_by=auth.uid() and portfolio_id=p_portfolio_id and company_id=p_company_id
      and branch_id=p_branch_id and idempotency_key=p_idempotency_key;
  if found then
    if v_job.request_sha256 <> v_request_sha256 then
      raise exception using errcode='22023', message='An idempotency key cannot be reused with a different import payload.';
    end if;
    return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_job.total_rows,
      'imported_rows',v_job.imported_rows,'errors',v_job.errors,'replayed',true);
  end if;
  v_count := jsonb_array_length(p_rows);
  if exists (select 1 from jsonb_array_elements(p_rows) x
      where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'employee') <> 'object'
        or jsonb_typeof(x->'private_details') <> 'object' or jsonb_typeof(x->'compensation') <> 'object') then
    raise exception using errcode='22023', message='Each import row must contain employee, private_details and compensation objects.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'line','') !~ '^[0-9]{1,6}$') then
    raise exception using errcode='22023', message='Import row references are invalid.';
  end if;

  with imported as (
    select value as row_data, lower(btrim(value->'employee'->>'employee_number')) as employee_key,
      (value->>'line')::integer as line from jsonb_array_elements(p_rows)
  ), duplicate_keys as (
    select employee_key from imported where employee_key is not null group by employee_key having count(*) > 1
  ), errors as (
    select i.line, 'Employee number is duplicated in this import.'::text as message
      from imported i join duplicate_keys d using (employee_key)
    union all
    select i.line, 'Employee number already exists for this company.'::text
      from imported i join public.employees e on e.company_id=p_company_id
        and lower(btrim(e.employee_number))=i.employee_key
  )
  select coalesce(jsonb_agg(jsonb_build_object('line',e.line,'message',e.message) order by e.line,e.message),'[]'::jsonb)
    into v_errors from errors e;

  insert into public.employee_import_jobs(portfolio_id,company_id,branch_id,initiated_by,idempotency_key,
      request_sha256,status,total_rows,imported_rows,errors)
  values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),p_idempotency_key,v_request_sha256,
      case when jsonb_array_length(v_errors)>0 then 'VALIDATION_FAILED' else 'FAILED' end,
      v_count,0,v_errors)
  returning * into v_job;

  if jsonb_array_length(v_errors)>0 then
    return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,'imported_rows',0,'errors',v_errors,'replayed',false);
  end if;

  begin
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_employee_id := public.employee_create_draft(p_portfolio_id,p_company_id,p_branch_id,
        v_row->'employee',v_row->'private_details',v_row->'compensation');
      perform public.employee_submit_for_hr_approval(v_employee_id);
      v_imported := v_imported + 1;
    end loop;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    -- This block is a subtransaction: all employee/profile/compensation and
    -- per-record audit changes are rolled back together while job history stays.
    update public.employee_import_jobs set status='FAILED', imported_rows=0,
      failure_code=coalesce(v_code,'DATABASE_ERROR'),
      errors=jsonb_build_array(jsonb_build_object('message','No rows were imported. Correct the source data or permissions and submit a new import job.'))
      where id=v_job.id returning * into v_job;
    return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,'imported_rows',0,'errors',v_job.errors,'replayed',false);
  end;

  update public.employee_import_jobs set status='COMPLETED', imported_rows=v_imported where id=v_job.id returning * into v_job;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),'EMPLOYEE_IMPORT_COMPLETED','employees',v_job.id::text,
      jsonb_build_object('rows',v_count,'imported',v_imported));
  return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,
    'imported_rows',v_imported,'errors',v_job.errors,'replayed',false);
end $$;

revoke all on function public.employee_import_atomic(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.employee_import_atomic(uuid,uuid,uuid,text,jsonb) to authenticated;
comment on table public.employee_import_jobs is 'Durable import status. Imported employee rows are committed all-or-none by employee_import_atomic.';
