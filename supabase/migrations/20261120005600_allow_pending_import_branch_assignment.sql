-- Permit company-scoped staged records while a branch is unresolved.
-- Approval still requires an active company branch and all existing HR checks.

alter table public.employee_import_staging_records
  drop constraint employee_import_staging_records_check;
alter table public.employee_import_staging_records
  add constraint employee_import_staging_company_branch_check
  check (branch_id is null or company_id is not null);

create or replace function public.employee_import_stage_batch(
  p_portfolio_id uuid, p_uploaded_filename text, p_source_sha256 text,
  p_idempotency_key text, p_records jsonb, p_sheet_summary jsonb default '[]'::jsonb,
  p_reconciliation jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_batch public.employee_import_batches%rowtype;
  v_record jsonb;
  v_id uuid;
  v_count integer;
  v_digest text;
  v_errors jsonb;
  v_warnings jsonb;
  v_status text;
  v_uploaded integer := 0;
begin
  if auth.uid() is null or p_portfolio_id is null
    or nullif(btrim(p_uploaded_filename),'') is null or length(p_uploaded_filename) > 255
    or p_source_sha256 !~ '^[a-f0-9]{64}$'
    or length(p_idempotency_key) not between 8 and 160
    or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 5000
    or pg_column_size(p_records) > 6000000
    or jsonb_typeof(p_sheet_summary) is distinct from 'array'
    or jsonb_typeof(p_reconciliation) is distinct from 'object' then
    raise exception using errcode='22023', message='Import staging request is invalid or exceeds the secure payload limit.';
  end if;
  if not exists (select 1 from public.client_portfolios p where p.id=p_portfolio_id) then
    raise exception using errcode='22023', message='Portfolio does not exist.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_records) r where
      jsonb_typeof(r) <> 'object' or nullif(btrim(r->>'source_sheet'),'') is null
      or length(r->>'source_sheet') > 128 or coalesce(r->>'source_row','') !~ '^[1-9][0-9]{0,6}$'
      or jsonb_typeof(r->'original_data') <> 'object' or jsonb_typeof(r->'current_data') <> 'object'
      or coalesce(jsonb_typeof(r->'payroll_data'),'object') <> 'object'
      or ((r->>'company_id') is null and (r->>'branch_id') is not null)) then
    raise exception using errcode='22023', message='Every staged row must include source coordinates and JSON objects; a branch requires a company assignment.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_records) r where r->>'company_id' is not null and not exists (
      select 1 from public.companies c where c.id=(r->>'company_id')::uuid and c.portfolio_id=p_portfolio_id
        and app_private.has_permission('employee.import',p_portfolio_id,c.id,null)
        and app_private.has_permission('employee.private.view',p_portfolio_id,c.id,null)))
    or exists (select 1 from jsonb_array_elements(p_records) r where r->>'branch_id' is not null and not exists (
      select 1 from public.branches b where b.id=(r->>'branch_id')::uuid
        and b.company_id=(r->>'company_id')::uuid and b.portfolio_id=p_portfolio_id and b.status='ACTIVE'
        and app_private.has_permission('employee.import',p_portfolio_id,b.company_id,b.id)
        and app_private.has_permission('employee.private.view',p_portfolio_id,b.company_id,b.id)))
    or (exists (select 1 from jsonb_array_elements(p_records) r where r->>'company_id' is null)
      and (not app_private.has_permission('employee.import',p_portfolio_id,null,null)
        or not app_private.has_permission('employee.private.view',p_portfolio_id,null,null))) then
    raise exception using errcode='42501', message='One or more company/branch assignments are outside the uploader’s authorized scope.';
  end if;

  v_digest := encode(extensions.digest(p_records::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_portfolio_id::text || ':' || p_idempotency_key,0));
  select * into v_batch from public.employee_import_batches
    where portfolio_id=p_portfolio_id and uploaded_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if v_batch.source_sha256 <> p_source_sha256 or v_batch.request_sha256 <> v_digest
      or v_batch.total_records <> jsonb_array_length(p_records) then
      raise exception using errcode='22023', message='An idempotency key cannot be reused for a different workbook.';
    end if;
    return jsonb_build_object('batch_id',v_batch.id,'status',v_batch.status,'total_records',v_batch.total_records,'replayed',true);
  end if;
  insert into public.employee_import_batches(portfolio_id,uploaded_by,uploaded_filename,source_sha256,request_sha256,idempotency_key,sheet_summary,reconciliation,total_records)
    values(p_portfolio_id,auth.uid(),p_uploaded_filename,p_source_sha256,v_digest,p_idempotency_key,p_sheet_summary,p_reconciliation,jsonb_array_length(p_records))
    returning * into v_batch;
  for v_record in select value from jsonb_array_elements(p_records) loop
    v_errors := app_private.employee_import_staging_validate(v_record->'current_data');
    v_warnings := '[]'::jsonb;
    if v_record->>'company_id' is not null and nullif(btrim(v_record->'current_data'->>'employee_number'),'') is not null then
      if exists (select 1 from public.employees e where e.company_id=(v_record->>'company_id')::uuid
          and lower(btrim(e.employee_number))=lower(btrim(v_record->'current_data'->>'employee_number'))) then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','EMPLOYEE_NUMBER','message','Employee number already exists in this company. Resolve the potential duplicate before submission.'));
      end if;
      if exists (select 1 from public.employee_import_staging_records s where s.batch_id=v_batch.id
          and s.company_id=(v_record->>'company_id')::uuid
          and lower(btrim(s.current_data->>'employee_number'))=lower(btrim(v_record->'current_data'->>'employee_number'))) then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_DUPLICATE','message','Employee number is repeated in this import batch.'));
      end if;
    end if;
    if v_record->>'company_id' is not null and nullif(btrim(v_record->'current_data'->>'identity_document_number'),'') is not null
      and exists (select 1 from public.employees e join public.employee_private_details d on d.employee_id=e.id
        where e.company_id=(v_record->>'company_id')::uuid
          and lower(btrim(d.identity_document_number))=lower(btrim(v_record->'current_data'->>'identity_document_number'))) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','IDENTITY_MATCH','message','Identity reference matches an employee already registered in this company.'));
    end if;
    if v_record->>'company_id' is not null and nullif(btrim(v_record->'current_data'->>'identity_document_number'),'') is not null
      and exists (select 1 from public.employee_import_staging_records s where s.batch_id=v_batch.id
        and s.company_id=(v_record->>'company_id')::uuid
        and lower(btrim(s.current_data->>'identity_document_number'))=lower(btrim(v_record->'current_data'->>'identity_document_number'))) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_IDENTITY_DUPLICATE','message','Identity reference is repeated in this import batch.'));
    end if;
    if v_record->>'company_id' is not null and nullif(btrim(v_record->'current_data'->>'first_name'),'') is not null
      and nullif(btrim(v_record->'current_data'->>'last_name'),'') is not null
      and exists (select 1 from public.employees e where e.company_id=(v_record->>'company_id')::uuid
        and lower(btrim(e.first_name))=lower(btrim(v_record->'current_data'->>'first_name'))
        and lower(btrim(e.last_name))=lower(btrim(v_record->'current_data'->>'last_name'))) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','NAME_MATCH','message','Name matches an employee already registered in this company. Confirm whether this is the same person.'));
    end if;
    if v_record->>'company_id' is not null and nullif(btrim(v_record->'current_data'->>'first_name'),'') is not null
      and nullif(btrim(v_record->'current_data'->>'last_name'),'') is not null
      and exists (select 1 from public.employee_import_staging_records s where s.batch_id=v_batch.id
        and s.company_id=(v_record->>'company_id')::uuid
        and lower(btrim(s.current_data->>'first_name'))=lower(btrim(v_record->'current_data'->>'first_name'))
        and lower(btrim(s.current_data->>'last_name'))=lower(btrim(v_record->'current_data'->>'last_name'))) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_NAME_DUPLICATE','message','Name is repeated in this import batch; review the source rows.'));
    end if;
    v_status := case when jsonb_array_length(v_warnings)>0 then 'DUPLICATE_REVIEW'
      when jsonb_array_length(v_errors)>0 or v_record->>'company_id' is null or v_record->>'branch_id' is null then 'NEEDS_INFORMATION'
      else 'PENDING_REVIEW' end;
    insert into public.employee_import_staging_records(batch_id,portfolio_id,company_id,branch_id,source_sheet,source_row,original_data,current_data,payroll_data,validation_errors,duplicate_warnings,review_status)
      values(v_batch.id,p_portfolio_id,nullif(v_record->>'company_id','')::uuid,nullif(v_record->>'branch_id','')::uuid,
        v_record->>'source_sheet',(v_record->>'source_row')::integer,v_record->'original_data',v_record->'current_data',coalesce(v_record->'payroll_data','{}'::jsonb),v_errors,v_warnings,v_status)
      returning id into v_id;
    insert into public.employee_import_review_history(staging_record_id,portfolio_id,company_id,branch_id,actor_id,action)
      values(v_id,p_portfolio_id,nullif(v_record->>'company_id','')::uuid,nullif(v_record->>'branch_id','')::uuid,auth.uid(),'UPLOADED');
    v_uploaded := v_uploaded + 1;
  end loop;
  perform app_private.employee_import_staging_recount(v_batch.id);
  select * into v_batch from public.employee_import_batches where id=v_batch.id;
  insert into public.audit_logs(portfolio_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,auth.uid(),'EMPLOYEE_IMPORT_STAGED','employees',v_batch.id::text,
      jsonb_build_object('records',v_uploaded,'filename',p_uploaded_filename,'source_sha256',p_source_sha256));
  return jsonb_build_object('batch_id',v_batch.id,'status',v_batch.status,'total_records',v_batch.total_records,'replayed',false);
end;
$$;
revoke all on function public.employee_import_stage_batch(uuid,text,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.employee_import_stage_batch(uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;


create or replace function public.employee_import_stage_review(
  p_record_id uuid, p_company_id uuid, p_branch_id uuid,
  p_current_data jsonb, p_payroll_data jsonb, p_decision text, p_reason text default null,
  p_duplicate_resolution text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_record public.employee_import_staging_records%rowtype;
  v_errors jsonb;
  v_warnings jsonb;
  v_status text;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('SAVE','MARK_READY','REJECT')
    or (p_duplicate_resolution is not null and p_duplicate_resolution <> 'CONFIRMED_DISTINCT')
    or jsonb_typeof(p_current_data) is distinct from 'object' or jsonb_typeof(p_payroll_data) is distinct from 'object' then
    raise exception using errcode='22023', message='Review update is invalid.';
  end if;
  select * into v_record from public.employee_import_staging_records where id=p_record_id for update;
  if not found then raise exception using errcode='P0002', message='Staged import record was not found.'; end if;
  if v_record.review_status in ('SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED') then
    raise exception using errcode='55000', message='This staged record is already terminal or submitted and cannot be edited.';
  end if;
  if v_record.resulting_employee_id is not null then
    raise exception using errcode='55000', message='This staged row is already linked to an employee. Use the existing employee correction workflow instead of importing it again.';
  end if;
  if p_company_id is null then
    if p_branch_id is not null
      or not app_private.has_permission('employee.import',v_record.portfolio_id,null,null)
      or not app_private.has_permission('employee.private.view',v_record.portfolio_id,null,null) then
      raise exception using errcode='42501', message='Portfolio-level import review permission is required when no company is assigned.';
    end if;
  elsif p_branch_id is null then
    if not exists (select 1 from public.companies c where c.id=p_company_id and c.portfolio_id=v_record.portfolio_id)
      or not app_private.has_permission('employee.import',v_record.portfolio_id,p_company_id,null)
      or not app_private.has_permission('employee.private.view',v_record.portfolio_id,p_company_id,null) then
      raise exception using errcode='42501', message='The selected company is invalid or outside your authorized scope.';
    end if;
  elsif not exists (select 1 from public.branches b where b.id=p_branch_id and b.company_id=p_company_id
      and b.portfolio_id=v_record.portfolio_id and b.status='ACTIVE')
    or not app_private.has_permission('employee.import',v_record.portfolio_id,p_company_id,p_branch_id)
    or not app_private.has_permission('employee.private.view',v_record.portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501', message='The selected company/branch is invalid or outside your authorized scope.';
  end if;
  if p_decision='REJECT' and nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023', message='A reason is required to reject an import record.';
  end if;
  if v_record.company_id is not null and (not app_private.has_permission('employee.import',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
      or not app_private.has_permission('employee.private.view',v_record.portfolio_id,v_record.company_id,v_record.branch_id)) then
    raise exception using errcode='42501', message='The current record is outside your authorized scope.';
  end if;
  if v_record.company_id is null and (not app_private.has_permission('employee.import',v_record.portfolio_id,null,null)
      or not app_private.has_permission('employee.private.view',v_record.portfolio_id,null,null)) then
    raise exception using errcode='42501', message='Portfolio-level import and private-data permissions are required for this record.';
  end if;
  if p_decision='REJECT' and not app_private.has_permission('employee.reject',v_record.portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501', message='Employee rejection permission is required for this company and branch.';
  end if;
  v_before := v_record.current_data;
  if p_company_id is not null and not app_private.has_permission('employee.create',v_record.portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501', message='Employee creation permission is required for the selected branch.';
  end if;
  if p_decision='MARK_READY' and p_company_id is not null
    and not app_private.has_permission('employee.submit',v_record.portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501', message='Employee submission permission is required before this row can be marked ready.';
  end if;
  select coalesce(jsonb_agg(k),'[]'::jsonb) into v_changed
    from (select key k from jsonb_each(v_record.current_data) union select key from jsonb_each(p_current_data)) keys
    where (v_record.current_data->keys.k) is distinct from (p_current_data->keys.k);
  v_errors := app_private.employee_import_staging_validate(p_current_data);
  v_warnings := '[]'::jsonb;
  if p_company_id is not null and nullif(btrim(p_current_data->>'employee_number'),'') is not null then
    if exists(select 1 from public.employees e where e.company_id=p_company_id and lower(btrim(e.employee_number))=lower(btrim(p_current_data->>'employee_number'))) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','EMPLOYEE_NUMBER','message','Employee number already exists in this company.'));
    end if;
    if exists(select 1 from public.employee_import_staging_records s where s.batch_id=v_record.batch_id and s.id<>v_record.id and s.company_id=p_company_id and lower(btrim(s.current_data->>'employee_number'))=lower(btrim(p_current_data->>'employee_number')) and s.review_status not in ('REJECTED','IMPORT_FAILED')) then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_DUPLICATE','message','Employee number is repeated in this import batch.'));
    end if;
  end if;
  if p_company_id is not null and nullif(btrim(p_current_data->>'identity_document_number'),'') is not null
    and exists (select 1 from public.employees e join public.employee_private_details d on d.employee_id=e.id
      where e.company_id=p_company_id and lower(btrim(d.identity_document_number))=lower(btrim(p_current_data->>'identity_document_number'))) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','IDENTITY_MATCH','message','Identity reference matches an employee already registered in this company.'));
  end if;
  if p_company_id is not null and nullif(btrim(p_current_data->>'identity_document_number'),'') is not null
    and exists (select 1 from public.employee_import_staging_records s where s.batch_id=v_record.batch_id and s.id<>v_record.id
      and s.company_id=p_company_id and lower(btrim(s.current_data->>'identity_document_number'))=lower(btrim(p_current_data->>'identity_document_number'))) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_IDENTITY_DUPLICATE','message','Identity reference is repeated in this import batch.'));
  end if;
  if p_company_id is not null and nullif(btrim(p_current_data->>'first_name'),'') is not null
    and nullif(btrim(p_current_data->>'last_name'),'') is not null
    and exists (select 1 from public.employees e where e.company_id=p_company_id
      and lower(btrim(e.first_name))=lower(btrim(p_current_data->>'first_name'))
      and lower(btrim(e.last_name))=lower(btrim(p_current_data->>'last_name'))) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','NAME_MATCH','message','Name matches an employee already registered in this company. Confirm whether this is the same person.'));
  end if;
  if p_company_id is not null and nullif(btrim(p_current_data->>'first_name'),'') is not null
    and nullif(btrim(p_current_data->>'last_name'),'') is not null
    and exists (select 1 from public.employee_import_staging_records s where s.batch_id=v_record.batch_id and s.id<>v_record.id
      and s.company_id=p_company_id and lower(btrim(s.current_data->>'first_name'))=lower(btrim(p_current_data->>'first_name'))
      and lower(btrim(s.current_data->>'last_name'))=lower(btrim(p_current_data->>'last_name'))) then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('type','BATCH_NAME_DUPLICATE','message','Name is repeated in this import batch; review the source rows.'));
  end if;
  if p_duplicate_resolution='CONFIRMED_DISTINCT' and nullif(btrim(p_reason),'') is not null then
    select coalesce(jsonb_agg(w),'[]'::jsonb) into v_warnings from jsonb_array_elements(v_warnings) w
      where w->>'type' not in ('IDENTITY_MATCH','NAME_MATCH');
  end if;
  if p_decision='REJECT' then v_status:='REJECTED';
  elsif p_decision='MARK_READY' and jsonb_array_length(v_errors)=0 and jsonb_array_length(v_warnings)=0 and p_company_id is not null and p_branch_id is not null then v_status:='READY_FOR_APPROVAL';
  elsif jsonb_array_length(v_warnings)>0 then v_status:='DUPLICATE_REVIEW';
  elsif jsonb_array_length(v_errors)>0 or p_company_id is null or p_branch_id is null then v_status:='NEEDS_INFORMATION';
  else v_status:='PENDING_REVIEW'; end if;
  if p_decision='MARK_READY' and v_status<>'READY_FOR_APPROVAL' then
    raise exception using errcode='22023', message='The record has validation errors, duplicate warnings, or no authorized company assignment.';
  end if;
  update public.employee_import_staging_records set company_id=p_company_id,branch_id=p_branch_id,
    current_data=p_current_data,payroll_data=p_payroll_data,validation_errors=v_errors,duplicate_warnings=v_warnings,
    review_status=v_status,review_reason=case when p_decision='REJECT' then btrim(p_reason) else null end,
    duplicate_resolution=case when p_duplicate_resolution='CONFIRMED_DISTINCT' and nullif(btrim(p_reason),'') is not null then p_duplicate_resolution else null end,
    duplicate_resolution_reason=case when p_duplicate_resolution='CONFIRMED_DISTINCT' and nullif(btrim(p_reason),'') is not null then btrim(p_reason) else null end,
    reviewer_id=auth.uid(),reviewed_at=now(),updated_at=now() where id=p_record_id returning * into v_record;
  insert into public.employee_import_review_history(staging_record_id,portfolio_id,company_id,branch_id,actor_id,action,reason,changed_fields,before_data,after_data)
    values(v_record.id,v_record.portfolio_id,v_record.company_id,v_record.branch_id,auth.uid(),
      case p_decision when 'REJECT' then 'REJECTED' when 'MARK_READY' then 'MARKED_READY' else 'EDITED' end,
      nullif(btrim(p_reason),''),v_changed,v_before,p_current_data);
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_record.portfolio_id,v_record.company_id,v_record.branch_id,auth.uid(),'EMPLOYEE_IMPORT_'||p_decision,'employees',v_record.id::text,
      jsonb_build_object('status',v_status,'changed_fields',v_changed));
  perform app_private.employee_import_staging_recount(v_record.batch_id);
  return jsonb_build_object('record_id',v_record.id,'review_status',v_status,'validation_errors',v_errors,'duplicate_warnings',v_warnings);
end;
$$;
revoke all on function public.employee_import_stage_review(uuid,uuid,uuid,jsonb,jsonb,text,text,text) from public,anon;
grant execute on function public.employee_import_stage_review(uuid,uuid,uuid,jsonb,jsonb,text,text,text) to authenticated;
