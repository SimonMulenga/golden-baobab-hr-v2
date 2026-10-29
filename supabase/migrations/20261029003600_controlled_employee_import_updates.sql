-- Controlled import updates are limited to the authenticated creator's
-- DRAFT/RETURNED_FOR_CORRECTION employee records in the selected branch.
-- Approved records remain immutable through bulk import.

alter table public.employee_import_jobs
  add column updated_rows integer not null default 0
    check (updated_rows between 0 and total_rows);

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
  v_updated integer := 0;
  v_employee_id uuid;
  v_request_sha256 text;
  v_operation text;
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
      'imported_rows',v_job.imported_rows,'updated_rows',v_job.updated_rows,'errors',v_job.errors,'replayed',true);
  end if;

  v_count := jsonb_array_length(p_rows);
  if exists (select 1 from jsonb_array_elements(p_rows) x
      where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'employee') <> 'object'
        or jsonb_typeof(x->'private_details') <> 'object' or jsonb_typeof(x->'compensation') <> 'object') then
    raise exception using errcode='22023', message='Each import row must contain employee, private_details and compensation objects.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'line','') !~ '^[0-9]{1,6}$'
      or coalesce(x->>'operation','CREATE') not in ('CREATE','SAFE_UPSERT_DRAFT')) then
    raise exception using errcode='22023', message='Import row references or operation are invalid.';
  end if;

  -- Lock eligible matches before validation so a state transition cannot race
  -- between the authorization check and the correction write.
  perform e.id
    from public.employees e
    join jsonb_array_elements(p_rows) x
      on lower(btrim(e.employee_number)) = lower(btrim(x->'employee'->>'employee_number'))
    where coalesce(x->>'operation','CREATE')='SAFE_UPSERT_DRAFT'
      and e.portfolio_id=p_portfolio_id and e.company_id=p_company_id
    order by e.id
    for update of e;

  with imported as (
    select value as row_data, lower(btrim(value->'employee'->>'employee_number')) as employee_key,
      (value->>'line')::integer as line, coalesce(value->>'operation','CREATE') as operation
      from jsonb_array_elements(p_rows)
  ), duplicate_keys as (
    select employee_key from imported where employee_key is not null group by employee_key having count(*) > 1
  ), errors as (
    select i.line, 'Employee number is duplicated in this import.'::text as message
      from imported i join duplicate_keys d using (employee_key)
    union all
    select i.line, case when i.operation='CREATE'
        then 'Employee number already exists for this company.'
        else 'Matching employee cannot be updated by this import. Only your own draft or returned record in the selected branch can be updated.' end
      from imported i
      where (i.operation='CREATE' and exists (
          select 1 from public.employees e where e.company_id=p_company_id
            and lower(btrim(e.employee_number))=i.employee_key))
        or (i.operation='SAFE_UPSERT_DRAFT' and exists (
          select 1 from public.employees e where e.portfolio_id=p_portfolio_id and e.company_id=p_company_id
            and lower(btrim(e.employee_number))=i.employee_key
            and (e.workplace_branch_id<>p_branch_id or e.created_by<>auth.uid()
              or e.approval_status not in ('DRAFT','RETURNED_FOR_CORRECTION'))))
  )
  select coalesce(jsonb_agg(jsonb_build_object('line',e.line,'message',e.message) order by e.line,e.message),'[]'::jsonb)
    into v_errors from errors e;

  insert into public.employee_import_jobs(portfolio_id,company_id,branch_id,initiated_by,idempotency_key,
      request_sha256,status,total_rows,imported_rows,updated_rows,errors)
  values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),p_idempotency_key,v_request_sha256,
      case when jsonb_array_length(v_errors)>0 then 'VALIDATION_FAILED' else 'FAILED' end,
      v_count,0,0,v_errors)
  returning * into v_job;

  if jsonb_array_length(v_errors)>0 then
    return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,
      'imported_rows',0,'updated_rows',0,'errors',v_errors,'replayed',false);
  end if;

  begin
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_operation := coalesce(v_row->>'operation','CREATE');
      if v_operation='SAFE_UPSERT_DRAFT' then
        select id into v_employee_id from public.employees
          where portfolio_id=p_portfolio_id and company_id=p_company_id and workplace_branch_id=p_branch_id
            and created_by=auth.uid() and approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
            and lower(btrim(employee_number))=lower(btrim(v_row->'employee'->>'employee_number'))
          for update;
        if found then
          perform public.employee_update_draft(v_employee_id,v_row->'employee',v_row->'private_details',v_row->'compensation');
          perform public.employee_submit_for_hr_approval(v_employee_id);
          v_updated := v_updated + 1;
        else
          v_employee_id := public.employee_create_draft(p_portfolio_id,p_company_id,p_branch_id,
            v_row->'employee',v_row->'private_details',v_row->'compensation');
          perform public.employee_submit_for_hr_approval(v_employee_id);
          v_imported := v_imported + 1;
        end if;
      else
        v_employee_id := public.employee_create_draft(p_portfolio_id,p_company_id,p_branch_id,
          v_row->'employee',v_row->'private_details',v_row->'compensation');
        perform public.employee_submit_for_hr_approval(v_employee_id);
        v_imported := v_imported + 1;
      end if;
    end loop;
  exception when others then
    update public.employee_import_jobs set status='FAILED', imported_rows=0, updated_rows=0,
      failure_code='ROW_WRITE_FAILED',
      errors=jsonb_build_array(jsonb_build_object('message','No rows were imported or updated. Correct the source data or permissions and submit a new import job.'))
      where id=v_job.id returning * into v_job;
    return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,
      'imported_rows',0,'updated_rows',0,'errors',v_job.errors,'replayed',false);
  end;

  update public.employee_import_jobs set status='COMPLETED', imported_rows=v_imported, updated_rows=v_updated
    where id=v_job.id returning * into v_job;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),'EMPLOYEE_IMPORT_COMPLETED','employees',v_job.id::text,
      jsonb_build_object('rows',v_count,'created',v_imported,'updated',v_updated));
  return jsonb_build_object('id',v_job.id,'status',v_job.status,'total_rows',v_count,
    'imported_rows',v_imported,'updated_rows',v_updated,'errors',v_job.errors,'replayed',false);
end $$;

revoke all on function public.employee_import_atomic(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.employee_import_atomic(uuid,uuid,uuid,text,jsonb) to authenticated;
comment on function public.employee_import_atomic(uuid,uuid,uuid,text,jsonb) is
  'Atomically imports new employees or updates only creator-owned draft/returned records in the selected company branch; every row is resubmitted for HR review.';

create or replace function public.employee_import_supports_draft_updates(
  p_portfolio_id uuid,p_company_id uuid,p_branch_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select auth.uid() is not null
    and app_private.has_permission('employee.import',p_portfolio_id,p_company_id,p_branch_id)
    and app_private.has_permission('employee.create',p_portfolio_id,p_company_id,p_branch_id);
$$;
revoke all on function public.employee_import_supports_draft_updates(uuid,uuid,uuid) from public,anon;
grant execute on function public.employee_import_supports_draft_updates(uuid,uuid,uuid) to authenticated;
