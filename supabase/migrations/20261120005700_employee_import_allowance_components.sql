-- Preserve an optional medical allowance and enforce the import workflow's
-- 30% housing default at the secure staging boundary. Payroll calculations are
-- intentionally unchanged.

alter table public.employee_compensation
  add column medical_allowance numeric(14,2) check (medical_allowance is null or medical_allowance >= 0);

comment on column public.employee_compensation.medical_allowance is
  'Optional effective-dated medical allowance captured from approved employee compensation; NULL means not provided. Existing payroll statutory bases are unchanged.';

create or replace function app_private.employee_compensation_preserve_medical_allowance()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.medical_allowance is null then
    select ec.medical_allowance into new.medical_allowance
    from public.employee_compensation ec
    where ec.employee_id = new.employee_id
      and ec.company_id = new.company_id
      and ec.effective_from < new.effective_from
    order by ec.effective_from desc
    limit 1;
  end if;
  return new;
end;
$$;

revoke all on function app_private.employee_compensation_preserve_medical_allowance() from public, anon, authenticated;
drop trigger if exists employee_compensation_preserve_medical_allowance on public.employee_compensation;
create trigger employee_compensation_preserve_medical_allowance
before insert on public.employee_compensation
for each row execute function app_private.employee_compensation_preserve_medical_allowance();

create or replace function app_private.employee_import_allowance_guard()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
declare
  v_data jsonb;
  v_errors jsonb;
  v_basic numeric;
  v_housing numeric;
  v_medical text;
  v_expected numeric;
  v_resolution text;
  v_source text;
  v_error jsonb;
begin
  v_data := new.current_data;
  v_errors := coalesce(new.validation_errors, '[]'::jsonb);
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_errors
  from jsonb_array_elements(v_errors) as entries(value)
  where value->>'type' is distinct from 'HOUSING_ALLOWANCE_REVIEW'
    and value->>'field' is distinct from 'medical_allowance';

  v_medical := nullif(btrim(coalesce(v_data->>'medical_allowance','')), '');
  if v_medical is not null then
    if v_medical !~ '^\d{1,12}(\.\d{1,2})?$' or v_medical::numeric < 0 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'field','medical_allowance','message','Medical allowance must be a non-negative amount with at most two decimal places.'));
      if new.review_status not in ('APPROVED','REJECTED','IMPORT_FAILED') then new.review_status := 'NEEDS_INFORMATION'; end if;
    end if;
  end if;

  if nullif(btrim(coalesce(v_data->>'basic_pay','')), '') ~ '^\d{1,12}(\.\d{1,2})?$' then
    v_basic := (v_data->>'basic_pay')::numeric;
    v_expected := round(v_basic * 0.30, 2);
    v_source := coalesce(v_data->>'housing_allowance_source','');
    v_resolution := coalesce(v_data->>'housing_allowance_resolution','');
    if v_source = 'DEFAULT_30' then
      v_data := jsonb_set(v_data, '{housing_allowance}', to_jsonb(v_expected::text), true);
      v_data := jsonb_set(v_data, '{housing_allowance_proposed}', to_jsonb(v_expected::text), true);
      v_data := jsonb_set(v_data, '{housing_allowance_review_required}', 'false'::jsonb, true);
      v_data := jsonb_set(v_data, '{housing_allowance_resolution}', '"USE_CALCULATED"'::jsonb, true);
    else
      begin v_housing := nullif(v_data->>'housing_allowance','')::numeric;
      exception when invalid_text_representation then v_housing := null; end;
      if v_housing is distinct from v_expected then
        v_data := jsonb_set(v_data, '{housing_allowance_proposed}', to_jsonb(v_expected::text), true);
        if v_resolution = 'USE_CALCULATED' then
          v_data := jsonb_set(v_data, '{housing_allowance}', to_jsonb(v_expected::text), true);
          v_data := jsonb_set(v_data, '{housing_allowance_review_required}', 'false'::jsonb, true);
        elsif v_resolution = 'USE_UPLOADED' and v_housing is not null and v_housing >= 0 then
          v_data := jsonb_set(v_data, '{housing_allowance_review_required}', 'false'::jsonb, true);
        else
          v_data := jsonb_set(v_data, '{housing_allowance_review_required}', 'true'::jsonb, true);
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'type','HOUSING_ALLOWANCE_REVIEW','field','housing_allowance',
            'message','Imported housing allowance differs from 30% of basic salary; HR must choose the calculated or reviewed uploaded amount.'));
          if new.review_status = 'READY_FOR_APPROVAL' then
            raise exception using errcode='22023', message='Resolve the housing allowance discrepancy before marking this record ready.';
          end if;
          if new.review_status not in ('APPROVED','REJECTED','IMPORT_FAILED','DUPLICATE_REVIEW') then new.review_status := 'NEEDS_INFORMATION'; end if;
        end if;
      else
        v_data := jsonb_set(v_data, '{housing_allowance_proposed}', to_jsonb(v_expected::text), true);
        v_data := jsonb_set(v_data, '{housing_allowance_review_required}', 'false'::jsonb, true);
      end if;
    end if;
  else
    v_data := jsonb_set(v_data, '{housing_allowance_proposed}', '""'::jsonb, true);
    if coalesce(v_data->>'housing_allowance_source','') = 'DEFAULT_30' then
      v_data := jsonb_set(v_data, '{housing_allowance}', '""'::jsonb, true);
    end if;
  end if;

  if v_data->>'housing_allowance_review_required' is distinct from 'true'
    and new.review_status = 'READY_FOR_APPROVAL'
    and jsonb_array_length(v_errors) > 0 then
    raise exception using errcode='22023', message='Resolve staged compensation validation errors before marking this record ready.';
  end if;
  new.current_data := v_data;
  new.validation_errors := v_errors;
  return new;
end;
$$;

revoke all on function app_private.employee_import_allowance_guard() from public, anon, authenticated;
drop trigger if exists employee_import_allowance_guard on public.employee_import_staging_records;
create trigger employee_import_allowance_guard
before insert or update of current_data, validation_errors, review_status
on public.employee_import_staging_records
for each row execute function app_private.employee_import_allowance_guard();

create or replace function public.employee_create_draft(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_employee jsonb,
  p_private_details jsonb,
  p_compensation jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.employees%rowtype; v_payment_method text;
begin
  if jsonb_typeof(p_employee) is distinct from 'object'
    or jsonb_typeof(p_private_details) is distinct from 'object'
    or jsonb_typeof(p_compensation) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Employee details are incomplete.';
  end if;
  if not app_private.has_permission('employee.create', p_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Employee creation is not authorized.';
  end if;
  if jsonb_typeof(coalesce(p_compensation -> 'allowance_proration_rules', '{}'::jsonb)) <> 'object'
     or exists (select 1 from jsonb_each_text(coalesce(p_compensation -> 'allowance_proration_rules', '{}'::jsonb)) r
       where r.key not in ('housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances')
         or r.value <> 'SCHEDULED_DAYS') then
    raise exception using errcode = '22023', message = 'Allowance proration must use the supported scheduled-days method.';
  end if;
  if (p_private_details ->> 'payment_method') is distinct from (p_compensation ->> 'payment_method') then
    raise exception using errcode = '22023', message = 'Employee and compensation payment methods must match.';
  end if;
  if nullif(p_compensation ->> 'medical_allowance','') is not null
     and (p_compensation ->> 'medical_allowance') !~ '^\d{1,12}(\.\d{1,2})?$' then
    raise exception using errcode='22023', message='Medical allowance must be a non-negative amount with at most two decimal places.';
  end if;
  insert into public.employees(
    portfolio_id, company_id, workplace_branch_id, employee_number, first_name, middle_name,
    last_name, date_of_birth, gender, nationality, job_title, department, employment_type,
    contract_type, contract_start_date, contract_end_date, retirement_age, created_by
  ) values (
    p_portfolio_id, p_company_id, p_branch_id,
    nullif(btrim(p_employee ->> 'employee_number'), ''), nullif(btrim(p_employee ->> 'first_name'), ''),
    nullif(btrim(p_employee ->> 'middle_name'), ''), nullif(btrim(p_employee ->> 'last_name'), ''),
    (p_employee ->> 'date_of_birth')::date, nullif(p_employee ->> 'gender', ''),
    nullif(btrim(p_employee ->> 'nationality'), ''), nullif(btrim(p_employee ->> 'job_title'), ''),
    nullif(btrim(p_employee ->> 'department'), ''), p_employee ->> 'employment_type',
    nullif(btrim(p_employee ->> 'contract_type'), ''), (p_employee ->> 'contract_start_date')::date,
    nullif(p_employee ->> 'contract_end_date', '')::date,
    coalesce(nullif(p_employee ->> 'retirement_age', '')::integer, 65), auth.uid()
  ) returning * into v;

  v_payment_method := p_private_details ->> 'payment_method';
  insert into public.employee_private_details(
    employee_id, portfolio_id, company_id, identity_document_type, identity_document_number,
    residential_address, phone, email, email_unavailable_reason, emergency_contact_name,
    emergency_contact_relationship, emergency_contact_phone, tpin, napsa_number, nhima_number,
    payment_method, bank_name, bank_account_name, bank_account_number, bank_branch_name,
    mobile_money_provider, mobile_money_number
  ) values (
    v.id, v.portfolio_id, v.company_id, nullif(p_private_details ->> 'identity_document_type', ''),
    nullif(p_private_details ->> 'identity_document_number', ''),
    nullif(btrim(p_private_details ->> 'residential_address'), ''), nullif(btrim(p_private_details ->> 'phone'), ''),
    nullif(btrim(p_private_details ->> 'email'), ''), nullif(btrim(p_private_details ->> 'email_unavailable_reason'), ''),
    nullif(btrim(p_private_details ->> 'emergency_contact_name'), ''),
    nullif(btrim(p_private_details ->> 'emergency_contact_relationship'), ''),
    nullif(btrim(p_private_details ->> 'emergency_contact_phone'), ''),
    nullif(p_private_details ->> 'tpin', ''), nullif(p_private_details ->> 'napsa_number', ''),
    nullif(p_private_details ->> 'nhima_number', ''), v_payment_method,
    nullif(btrim(p_private_details ->> 'bank_name'), ''), nullif(btrim(p_private_details ->> 'bank_account_name'), ''),
    nullif(btrim(p_private_details ->> 'bank_account_number'), ''), nullif(btrim(p_private_details ->> 'bank_branch_name'), ''),
    nullif(btrim(p_private_details ->> 'mobile_money_provider'), ''), nullif(btrim(p_private_details ->> 'mobile_money_number'), '')
  );
  insert into public.employee_compensation(
    portfolio_id, company_id, workplace_branch_id, employee_id, effective_from, effective_to,
    salary_frequency, basic_pay, housing_allowance, meal_allowance, transport_allowance,
    other_allowances, medical_allowance, overtime_eligible, allowance_proration_rules, payment_method, created_by
  ) values (
    v.portfolio_id, v.company_id, v.workplace_branch_id, v.id,
    (p_compensation ->> 'effective_from')::date, nullif(p_compensation ->> 'effective_to', '')::date,
    p_compensation ->> 'salary_frequency', (p_compensation ->> 'basic_pay')::numeric,
    coalesce(nullif(p_compensation ->> 'housing_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'meal_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'transport_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'other_allowances', '')::numeric, 0),
    nullif(p_compensation ->> 'medical_allowance', '')::numeric,
    coalesce((p_compensation ->> 'overtime_eligible')::boolean, false), coalesce(p_compensation -> 'allowance_proration_rules', '{}'::jsonb),
    v_payment_method, auth.uid()
  );
  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, v.id, auth.uid(), 'DRAFT_CREATED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, auth.uid(), 'EMPLOYEE_DRAFT_CREATED', 'employees', v.id::text);
  return v.id;
end;
$$;

revoke all on function public.employee_create_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.employee_create_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.employee_import_submit_staged(p_record_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_record public.employee_import_staging_records%rowtype;
  v_data jsonb;
  v_private jsonb;
  v_compensation jsonb;
  v_result jsonb;
  v_employee_id uuid;
  v_job_id uuid;
begin
  if auth.uid() is null or length(p_idempotency_key) not between 8 and 160 then
    raise exception using errcode='22023', message='A valid authenticated submission key is required.';
  end if;
  select * into v_record from public.employee_import_staging_records where id=p_record_id for update;
  if not found then raise exception using errcode='P0002', message='Staged import record was not found.'; end if;
  if v_record.review_status='SUBMITTED_FOR_APPROVAL' and v_record.resulting_employee_id is not null then
    return jsonb_build_object('record_id',v_record.id,'employee_id',v_record.resulting_employee_id,'status',v_record.review_status,'replayed',true);
  end if;
  if v_record.review_status<>'READY_FOR_APPROVAL' or jsonb_array_length(v_record.validation_errors)>0 or jsonb_array_length(v_record.duplicate_warnings)>0 then
    raise exception using errcode='22023', message='Only validated, duplicate-free staged records can be submitted.';
  end if;
  if v_record.resulting_employee_id is not null then
    raise exception using errcode='55000', message='This staged row is already linked to an employee and cannot create a second employee.';
  end if;
  if not app_private.has_permission('employee.import',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.private.view',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.create',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.submit',v_record.portfolio_id,v_record.company_id,v_record.branch_id) then
    raise exception using errcode='42501', message='Employee import, create, and submit permissions are required for this branch.';
  end if;
  v_data:=v_record.current_data;
  v_private:=jsonb_build_object(
    'identity_document_type',nullif(v_data->>'identity_document_type',''),
    'identity_document_number',nullif(v_data->>'identity_document_number',''),
    'residential_address',v_data->>'residential_address','phone',v_data->>'phone',
    'email',nullif(v_data->>'email',''),'email_unavailable_reason',nullif(v_data->>'email_unavailable_reason',''),
    'emergency_contact_name',v_data->>'emergency_contact_name','emergency_contact_relationship',v_data->>'emergency_contact_relationship',
    'emergency_contact_phone',v_data->>'emergency_contact_phone','tpin',nullif(v_data->>'tpin',''),
    'napsa_number',nullif(v_data->>'napsa_number',''),'nhima_number',nullif(v_data->>'nhima_number',''),
    'payment_method',v_data->>'payment_method','bank_name',nullif(v_data->>'bank_name',''),
    'bank_account_name',nullif(v_data->>'bank_account_name',''),'bank_account_number',nullif(v_data->>'bank_account_number',''),
    'bank_branch_name',nullif(v_data->>'bank_branch_name',''),'mobile_money_provider',nullif(v_data->>'mobile_money_provider',''),
    'mobile_money_number',nullif(v_data->>'mobile_money_number',''));
  v_compensation:=jsonb_build_object(
    'effective_from',v_data->>'contract_start_date','effective_to',nullif(v_data->>'contract_end_date',''),
    'salary_frequency',v_data->>'salary_frequency','basic_pay',(v_data->>'basic_pay')::numeric,
    'housing_allowance',coalesce(nullif(v_data->>'housing_allowance','')::numeric,0),
    'meal_allowance',coalesce(nullif(v_data->>'meal_allowance','')::numeric,0),
    'transport_allowance',coalesce(nullif(v_data->>'transport_allowance','')::numeric,0),
    'medical_allowance',nullif(v_data->>'medical_allowance','')::numeric,
    'other_allowances',coalesce(nullif(v_data->>'other_allowances','')::numeric,0),
    'overtime_eligible',case lower(coalesce(v_data->>'overtime_eligible','false'))
      when 'true' then true when 'yes' then true when '1' then true when 'eligible' then true
      when 'false' then false when 'no' then false when '0' then false when 'not eligible' then false
      else false end,
    'payment_method',v_data->>'payment_method');
  v_result:=public.employee_import_atomic(v_record.portfolio_id,v_record.company_id,v_record.branch_id,p_idempotency_key,
    jsonb_build_array(jsonb_build_object('line',v_record.source_row,'operation','CREATE','employee',jsonb_build_object(
      'employee_number',v_data->>'employee_number','first_name',v_data->>'first_name','middle_name',nullif(v_data->>'middle_name',''),
      'last_name',v_data->>'last_name','date_of_birth',v_data->>'date_of_birth','gender',nullif(v_data->>'gender',''),
      'nationality',v_data->>'nationality','job_title',v_data->>'job_title','department',v_data->>'department',
      'employment_type',v_data->>'employment_type','contract_type',v_data->>'contract_type',
      'contract_start_date',v_data->>'contract_start_date','contract_end_date',nullif(v_data->>'contract_end_date',''),
      'retirement_age',coalesce(nullif(v_data->>'retirement_age','')::integer,65),'retirement_status',coalesce(nullif(v_data->>'retirement_status',''),'NOT_RETIRED')),
      'private_details',v_private,'compensation',v_compensation)));
  if v_result->>'status'='COMPLETED' then
    select id into v_employee_id from public.employees where company_id=v_record.company_id
      and lower(btrim(employee_number))=lower(btrim(v_data->>'employee_number'));
    v_job_id:=nullif(v_result->>'id','')::uuid;
    update public.employee_import_staging_records set review_status='SUBMITTED_FOR_APPROVAL',resulting_employee_id=v_employee_id,
      submission_job_id=v_job_id,reviewer_id=auth.uid(),reviewed_at=now(),updated_at=now() where id=v_record.id returning * into v_record;
    insert into public.employee_import_review_history(staging_record_id,portfolio_id,company_id,branch_id,actor_id,action,reason)
      values(v_record.id,v_record.portfolio_id,v_record.company_id,v_record.branch_id,auth.uid(),'SUBMITTED','Submitted to existing employee HR approval workflow.');
    insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
      values(v_record.portfolio_id,v_record.company_id,v_record.branch_id,auth.uid(),'EMPLOYEE_IMPORT_SUBMITTED','employees',v_record.id::text,
        jsonb_build_object('employee_id',v_employee_id,'import_job_id',v_job_id));
    perform app_private.employee_import_staging_recount(v_record.batch_id);
    return jsonb_build_object('record_id',v_record.id,'employee_id',v_employee_id,'import_job',v_result,'status',v_record.review_status,'replayed',false);
  end if;
  update public.employee_import_staging_records set review_status='IMPORT_FAILED',review_reason='Existing employee import workflow returned '||coalesce(v_result->>'status','unknown'),updated_at=now() where id=v_record.id returning * into v_record;
  perform app_private.employee_import_staging_recount(v_record.batch_id);
  insert into public.employee_import_review_history(staging_record_id,portfolio_id,company_id,branch_id,actor_id,action,reason)
    values(v_record.id,v_record.portfolio_id,v_record.company_id,v_record.branch_id,auth.uid(),'IMPORT_FAILED',v_record.review_reason);
  return jsonb_build_object('record_id',v_record.id,'import_job',v_result,'status',v_record.review_status,'replayed',false);
end;
$$;

revoke all on function public.employee_import_submit_staged(uuid,text) from public, anon;
grant execute on function public.employee_import_submit_staged(uuid,text) to authenticated;
