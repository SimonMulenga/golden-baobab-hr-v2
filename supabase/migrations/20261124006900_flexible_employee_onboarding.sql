-- Flexible onboarding: keep organizational assignment and positive earnings
-- mandatory while allowing legitimate personal/employment details to be added
-- later. No existing employee or payroll rows are rewritten.

alter table public.employees
  alter column date_of_birth drop not null,
  alter column nationality drop not null,
  alter column job_title drop not null,
  alter column employment_type drop not null,
  alter column contract_type drop not null,
  alter column contract_start_date drop not null;

alter table public.employee_private_details
  alter column residential_address drop not null,
  alter column phone drop not null,
  alter column emergency_contact_name drop not null,
  alter column emergency_contact_relationship drop not null,
  alter column emergency_contact_phone drop not null,
  alter column payment_method drop not null,
  drop constraint if exists employee_private_details_check,
  drop constraint if exists employee_private_details_check_1,
  drop constraint if exists employee_private_details_check_2,
  add constraint employee_private_details_email_reason_check
    check (email is null or email_unavailable_reason is null);

do $$
declare v_constraint record;
begin
  for v_constraint in
    select conname,pg_get_constraintdef(oid) definition
    from pg_constraint
    where conrelid='public.employee_private_details'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%email%' or pg_get_constraintdef(oid) ilike '%bank_account_number%'
        or pg_get_constraintdef(oid) ilike '%mobile_money_number%')
      and conname <> 'employee_private_details_email_reason_check'
  loop
    execute format('alter table public.employee_private_details drop constraint %I',v_constraint.conname);
  end loop;
end;
$$;

alter table public.employee_compensation
  alter column effective_from drop not null,
  alter column salary_frequency drop not null,
  alter column payment_method drop not null;

create or replace function app_private.employee_import_staging_validate(p_data jsonb)
returns jsonb language plpgsql stable
set search_path = pg_catalog
as $$
declare
  v_errors jsonb := '[]'::jsonb;
  v_key text;
  v_value text;
  v_basic text;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then
    return jsonb_build_array(jsonb_build_object('field','employee','message','Employee row is invalid.'));
  end if;
  foreach v_key in array array['first_name','last_name','department'] loop
    if nullif(btrim(coalesce(p_data->>v_key,'')), '') is null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('field',v_key,'message',case v_key when 'department' then 'Department is required.' else 'Employee full name is required.' end));
    end if;
  end loop;
  v_basic := nullif(btrim(coalesce(p_data->>'basic_pay','')), '');
  if v_basic is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','basic_pay','message','Basic salary is required.'));
  elsif v_basic !~ '^\d{1,12}(\.\d{1,2})?$' or v_basic::numeric <= 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','basic_pay','message','Basic salary must be a valid positive amount with at most two decimal places.'));
  end if;
  foreach v_key in array array['housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances'] loop
    v_value := nullif(btrim(coalesce(p_data->>v_key,'')), '');
    if v_value is not null and (v_value !~ '^\d{1,12}(\.\d{1,2})?$' or v_value::numeric < 0) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('field',v_key,'message','Earnings must be a valid non-negative amount with at most two decimal places.'));
    end if;
  end loop;
  if nullif(btrim(coalesce(p_data->>'email','')),'') is not null
    and p_data->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','email','message','Email address is invalid.'));
  end if;
  foreach v_key in array array['date_of_birth','contract_start_date','contract_end_date'] loop
    v_value := nullif(btrim(coalesce(p_data->>v_key,'')), '');
    if v_value is not null then
      if v_value !~ '^\d{4}-\d{2}-\d{2}$' then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field',v_key,'message','Date must use YYYY-MM-DD and be a valid calendar date.'));
      else
        begin perform v_value::date;
        exception when others then v_errors := v_errors || jsonb_build_array(jsonb_build_object('field',v_key,'message','Date must be a valid calendar date.')); end;
      end if;
    end if;
  end loop;
  if nullif(p_data->>'date_of_birth','') is not null and p_data->>'date_of_birth' ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      if (p_data->>'date_of_birth')::date > current_date then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','date_of_birth','message','Date of birth cannot be in the future.'));
      end if;
    exception when others then null;
    end;
  end if;
  if nullif(p_data->>'contract_end_date','') is not null and nullif(p_data->>'contract_start_date','') is not null
    and p_data->>'contract_end_date' ~ '^\d{4}-\d{2}-\d{2}$' and p_data->>'contract_start_date' ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      if (p_data->>'contract_end_date')::date < (p_data->>'contract_start_date')::date then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','contract_end_date','message','Contract end date cannot precede the start date.'));
      end if;
    exception when others then null;
    end;
  end if;
  if nullif(p_data->>'gender','') is not null and p_data->>'gender' not in ('FEMALE','MALE','NON_BINARY','UNDISCLOSED') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','gender','message','Gender value is unsupported.'));
  end if;
  if nullif(p_data->>'employment_type','') is not null and p_data->>'employment_type' not in ('PERMANENT','FIXED_TERM','PART_TIME','CASUAL','DAILY_RATED') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','employment_type','message','Employment type is unsupported.'));
  end if;
  if nullif(p_data->>'salary_frequency','') is not null and p_data->>'salary_frequency' not in ('MONTHLY','FORTNIGHTLY','WEEKLY','DAILY') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','salary_frequency','message','Salary frequency is unsupported.'));
  end if;
  if nullif(p_data->>'payment_method','') is not null and p_data->>'payment_method' not in ('BANK_TRANSFER','MOBILE_MONEY','CASH') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','payment_method','message','Payment method is unsupported.'));
  end if;
  if nullif(p_data->>'email','') is not null and nullif(p_data->>'email_unavailable_reason','') is not null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','email','message','Provide an email or an unavailable reason, not both.'));
  end if;
  return v_errors;
end;
$$;
revoke all on function app_private.employee_import_staging_validate(jsonb) from public, anon, authenticated;

create or replace function app_private.employee_import_department_guard()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_department text := nullif(btrim(coalesce(new.current_data->>'department','')), '');
  v_company public.companies%rowtype;
  v_branch public.branches%rowtype;
  v_errors jsonb;
  v_payment text := upper(coalesce(new.current_data->>'payment_method',''));
  v_bank text := nullif(btrim(coalesce(new.current_data->>'bank_name','')), '');
  v_normalized_bank text;
begin
  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_errors
  from jsonb_array_elements(coalesce(new.validation_errors,'[]'::jsonb)) x(value)
  where value->>'type' not in ('DEPARTMENT_REVIEW','BANK_NAME_REVIEW','COMPANY_REVIEW','BRANCH_REVIEW');

  if new.company_id is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','company_name','type','COMPANY_REVIEW','message','Company is not registered or is unavailable to your account.'));
  else
    select * into v_company from public.companies c where c.id=new.company_id and c.portfolio_id=new.portfolio_id;
    if not found or v_company.status <> 'ACTIVE' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','company_name','type','COMPANY_REVIEW','message','Company is not registered, active, or available for onboarding.'));
    elsif lower(regexp_replace(btrim(v_company.name),'\s+',' ','g')) <> lower(regexp_replace(btrim(coalesce(new.current_data->>'company_name','')),'\s+',' ','g')) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','company_name','type','COMPANY_REVIEW','message','Selected company does not match the registered company in this row.'));
    end if;
  end if;
  if new.branch_id is null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','branch_name','type','BRANCH_REVIEW','message','An active branch belonging to the selected company is required.'));
  else
    select * into v_branch from public.branches b where b.id=new.branch_id and b.company_id=new.company_id and b.portfolio_id=new.portfolio_id;
    if not found or v_branch.status <> 'ACTIVE' or lower(regexp_replace(btrim(v_branch.name),'\s+',' ','g')) <> lower(regexp_replace(btrim(coalesce(new.current_data->>'branch_name','')),'\s+',' ','g')) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','branch_name','type','BRANCH_REVIEW','message','Branch does not belong to the selected company or is not active.'));
    end if;
  end if;
  if v_department is null or not exists (
    select 1 from public.departments d where d.portfolio_id=new.portfolio_id and d.company_id=new.company_id
      and d.status='ACTIVE' and lower(regexp_replace(btrim(d.name),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(v_department,'')),'\s+',' ','g'))
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('field','department','type','DEPARTMENT_REVIEW','message','Select an active department registered for the selected company.'));
  end if;
  if new.review_status='SUBMITTED_FOR_APPROVAL' and new.resulting_employee_id is not null
    and nullif(btrim(coalesce(new.current_data->>'employee_number','')),'') is null then
    new.current_data:=jsonb_set(new.current_data,'{employee_number}',to_jsonb((select e.employee_number from public.employees e where e.id=new.resulting_employee_id)),true);
  end if;
  if v_payment='BANK_TRANSFER' and v_bank is not null then
    v_normalized_bank:=regexp_replace(lower(v_bank),'[^a-z0-9]','','g');
    if v_normalized_bank <> all(array['abbankzambia','absabankzambia','accessbankzambia','bankofchinazambia','citibankzambia','ecobankzambia','firstalliancebankzambia','firstcapitalbankzambia','firstnationalbankzambiafnb','indozambiabank','stanbicbankzambia','standardcharteredzambia','unitedbankforafricaubazambia','zambiaindustrialcommercialbankzicb','zambianationalcommercialbankzanaco','absa','fnb','zanaco','uba','zicb']) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('type','BANK_NAME_REVIEW','field','bank_name','message','Select a supported bank from the HR bank directory.'));
    end if;
  end if;
  new.validation_errors:=v_errors;
  if jsonb_array_length(v_errors)>0 and new.review_status='READY_FOR_APPROVAL' then
    raise exception using errcode='22023',message='Correct the row validation errors before marking it ready.';
  elsif jsonb_array_length(v_errors)>0 and new.review_status not in ('REJECTED','IMPORT_FAILED','SUBMITTED_FOR_APPROVAL','APPROVED') then
    new.review_status:='NEEDS_INFORMATION';
  end if;
  return new;
end;
$$;
revoke all on function app_private.employee_import_department_guard() from public, anon, authenticated;
drop trigger if exists employee_import_department_guard on public.employee_import_staging_records;
create trigger employee_import_department_guard
before insert or update of company_id, branch_id, current_data, validation_errors, review_status
on public.employee_import_staging_records for each row execute function app_private.employee_import_department_guard();

create or replace function app_private.employee_onboarding_approval_guard()
returns trigger language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
begin
  if new.approval_status='APPROVED' and old.approval_status is distinct from 'APPROVED' then
    if not exists(select 1 from public.companies c where c.id=new.company_id and c.portfolio_id=new.portfolio_id and c.status='ACTIVE')
      or not exists(select 1 from public.branches b where b.id=new.workplace_branch_id and b.company_id=new.company_id and b.portfolio_id=new.portfolio_id and b.status='ACTIVE')
      or not exists(select 1 from public.departments d where d.id=new.department_id and d.company_id=new.company_id and d.portfolio_id=new.portfolio_id and d.status='ACTIVE')
      or nullif(btrim(concat_ws(' ',new.first_name,new.last_name)),'') is null
      or not exists(select 1 from public.employee_compensation ec where ec.employee_id=new.id and ec.company_id=new.company_id and ec.basic_pay>0) then
      raise exception using errcode='22023',message='Company, branch, department, employee name, and positive earnings are required before approval.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.employee_onboarding_approval_guard() from public,anon,authenticated;
drop trigger if exists employees_onboarding_approval_guard on public.employees;
create trigger employees_onboarding_approval_guard before update of approval_status on public.employees
for each row execute function app_private.employee_onboarding_approval_guard();

create or replace function app_private.employee_allocate_number(p_company_id uuid)
returns text language plpgsql volatile security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_next bigint; v_number text;
begin
  perform pg_advisory_xact_lock(hashtextextended('employee-number:'||p_company_id::text, 0));
  select coalesce(max(substring(e.employee_number from '^GB-([0-9]+)$')::bigint),0)+1
    into v_next from public.employees e where e.company_id=p_company_id
      and e.employee_number ~ '^GB-[0-9]{1,18}$';
  loop
    v_number:='GB-'||case when length(v_next::text)<5 then lpad(v_next::text,5,'0') else v_next::text end;
    exit when not exists (select 1 from public.employees e where e.company_id=p_company_id and lower(e.employee_number)=lower(v_number));
    v_next:=v_next+1;
  end loop;
  return v_number;
end;
$$;
revoke all on function app_private.employee_allocate_number(uuid) from public, anon, authenticated;

create or replace function public.employee_create_draft(
  p_portfolio_id uuid,p_company_id uuid,p_branch_id uuid,p_employee jsonb,p_private_details jsonb,p_compensation jsonb
) returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_department public.departments%rowtype;
  v_number text;
  v_basic text;
  v_key text;
  v_amount text;
  v_email text;
begin
  if auth.uid() is null or jsonb_typeof(p_employee) is distinct from 'object'
    or jsonb_typeof(p_private_details) is distinct from 'object' or jsonb_typeof(p_compensation) is distinct from 'object' then
    raise exception using errcode='22023',message='Employee details are incomplete.';
  end if;
  if not app_private.has_permission('employee.create',p_portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Employee creation is not authorized for this organization scope.';
  end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id and c.portfolio_id=p_portfolio_id and c.status='ACTIVE')
    or not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=p_company_id and b.portfolio_id=p_portfolio_id and b.status='ACTIVE') then
    raise exception using errcode='22023',message='Select an active company and a branch belonging to that company.';
  end if;
  if nullif(btrim(p_employee->>'first_name'),'') is null or nullif(btrim(p_employee->>'last_name'),'') is null then
    raise exception using errcode='22023',message='Employee full name is required.';
  end if;
  v_email:=nullif(btrim(p_private_details->>'email'),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Email address is invalid.';
  end if;
  if nullif(btrim(p_employee->>'date_of_birth'),'') is not null and (p_employee->>'date_of_birth')::date>current_date then
    raise exception using errcode='22023',message='Date of birth cannot be in the future.';
  end if;
  if nullif(p_employee->>'contract_start_date','') is not null and nullif(p_employee->>'contract_end_date','') is not null
    and (p_employee->>'contract_end_date')::date<(p_employee->>'contract_start_date')::date then
    raise exception using errcode='22023',message='Contract end date cannot precede the start date.';
  end if;
  if nullif(btrim(p_employee->>'department_id'),'') is not null then
    select * into v_department from public.departments d where d.id=(p_employee->>'department_id')::uuid
      and d.portfolio_id=p_portfolio_id and d.company_id=p_company_id and d.status='ACTIVE';
  else
    select * into v_department from public.departments d where d.portfolio_id=p_portfolio_id and d.company_id=p_company_id
      and d.status='ACTIVE' and lower(regexp_replace(btrim(d.name),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(p_employee->>'department','')),'\s+',' ','g'));
  end if;
  if not found then raise exception using errcode='22023',message='Select an active department registered for this company.'; end if;
  v_basic:=nullif(btrim(coalesce(p_compensation->>'basic_pay','')),'');
  if v_basic is null or v_basic !~ '^\d{1,12}(\.\d{1,2})?$' or v_basic::numeric<=0 then
    raise exception using errcode='22023',message='Basic salary is required and must be a valid positive amount.';
  end if;
  foreach v_key in array array['housing_allowance','meal_allowance','transport_allowance','other_allowances','medical_allowance'] loop
    v_amount:=nullif(btrim(coalesce(p_compensation->>v_key,'')),'');
    if v_amount is not null and (v_amount !~ '^\d{1,12}(\.\d{1,2})?$' or v_amount::numeric<0) then
      raise exception using errcode='22023',message='Optional earnings must be valid non-negative amounts.';
    end if;
  end loop;
  if p_compensation->>'salary_frequency' is not null and p_compensation->>'salary_frequency' not in ('MONTHLY','FORTNIGHTLY','WEEKLY','DAILY') then
    raise exception using errcode='22023',message='Salary frequency is not supported.';
  end if;
  if p_private_details->>'payment_method' is not null and p_private_details->>'payment_method' not in ('BANK_TRANSFER','MOBILE_MONEY','CASH') then
    raise exception using errcode='22023',message='Payment method is not supported.';
  end if;
  if (p_private_details->>'payment_method') is distinct from (p_compensation->>'payment_method') then
    raise exception using errcode='22023',message='Employee and compensation payment methods must match.';
  end if;
  if jsonb_typeof(coalesce(p_compensation->'allowance_proration_rules','{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_each_text(coalesce(p_compensation->'allowance_proration_rules','{}'::jsonb)) r
      where r.key not in ('housing_allowance','meal_allowance','transport_allowance','other_allowances') or r.value<>'SCHEDULED_DAYS') then
    raise exception using errcode='22023',message='Allowance proration must use the supported scheduled-days method.';
  end if;
  v_number:=nullif(btrim(p_employee->>'employee_number'),'');
  if v_number is null then v_number:=app_private.employee_allocate_number(p_company_id); end if;
  if exists(select 1 from public.employees e where e.company_id=p_company_id and lower(btrim(e.employee_number))=lower(btrim(v_number))) then
    raise exception using errcode='23505',message='Employee number is already in use for this company.';
  end if;
  insert into public.employees(
    portfolio_id,company_id,workplace_branch_id,employee_number,first_name,middle_name,last_name,date_of_birth,gender,
    nationality,job_title,department,department_id,employment_type,contract_type,contract_start_date,contract_end_date,retirement_age,created_by
  ) values (
    p_portfolio_id,p_company_id,p_branch_id,v_number,btrim(p_employee->>'first_name'),nullif(btrim(p_employee->>'middle_name'),''),
    btrim(p_employee->>'last_name'),nullif(p_employee->>'date_of_birth','')::date,nullif(p_employee->>'gender',''),
    nullif(btrim(p_employee->>'nationality'),''),nullif(btrim(p_employee->>'job_title'),''),v_department.name,v_department.id,
    nullif(p_employee->>'employment_type',''),nullif(btrim(p_employee->>'contract_type'),''),nullif(p_employee->>'contract_start_date','')::date,
    nullif(p_employee->>'contract_end_date','')::date,coalesce(nullif(p_employee->>'retirement_age','')::integer,65),auth.uid()
  ) returning * into v_employee;
  insert into public.employee_private_details(
    employee_id,portfolio_id,company_id,identity_document_type,identity_document_number,residential_address,phone,email,email_unavailable_reason,
    emergency_contact_name,emergency_contact_relationship,emergency_contact_phone,tpin,napsa_number,nhima_number,payment_method,
    bank_name,bank_account_name,bank_account_number,bank_branch_name,mobile_money_provider,mobile_money_number
  ) values (
    v_employee.id,p_portfolio_id,p_company_id,nullif(p_private_details->>'identity_document_type',''),nullif(btrim(p_private_details->>'identity_document_number'),''),
    nullif(btrim(p_private_details->>'residential_address'),''),nullif(btrim(p_private_details->>'phone'),''),nullif(btrim(p_private_details->>'email'),''),
    nullif(btrim(p_private_details->>'email_unavailable_reason'),''),nullif(btrim(p_private_details->>'emergency_contact_name'),''),
    nullif(btrim(p_private_details->>'emergency_contact_relationship'),''),nullif(btrim(p_private_details->>'emergency_contact_phone'),''),
    nullif(btrim(p_private_details->>'tpin'),''),nullif(btrim(p_private_details->>'napsa_number'),''),nullif(btrim(p_private_details->>'nhima_number'),''),
    nullif(p_private_details->>'payment_method',''),nullif(btrim(p_private_details->>'bank_name'),''),nullif(btrim(p_private_details->>'bank_account_name'),''),
    nullif(btrim(p_private_details->>'bank_account_number'),''),nullif(btrim(p_private_details->>'bank_branch_name'),''),
    nullif(btrim(p_private_details->>'mobile_money_provider'),''),nullif(btrim(p_private_details->>'mobile_money_number'),'')
  );
  insert into public.employee_compensation(
    portfolio_id,company_id,workplace_branch_id,employee_id,effective_from,effective_to,salary_frequency,basic_pay,housing_allowance,
    meal_allowance,transport_allowance,other_allowances,medical_allowance,overtime_eligible,allowance_proration_rules,payment_method,created_by
  ) values (
    p_portfolio_id,p_company_id,p_branch_id,v_employee.id,nullif(p_compensation->>'effective_from','')::date,nullif(p_compensation->>'effective_to','')::date,
    nullif(p_compensation->>'salary_frequency',''),v_basic::numeric,coalesce(nullif(p_compensation->>'housing_allowance','')::numeric,0),
    coalesce(nullif(p_compensation->>'meal_allowance','')::numeric,0),coalesce(nullif(p_compensation->>'transport_allowance','')::numeric,0),
    coalesce(nullif(p_compensation->>'other_allowances','')::numeric,0),nullif(p_compensation->>'medical_allowance','')::numeric,
    coalesce((p_compensation->>'overtime_eligible')::boolean,false),coalesce(p_compensation->'allowance_proration_rules','{}'::jsonb),
    nullif(p_compensation->>'payment_method',''),auth.uid()
  );
  insert into public.employee_approval_history(portfolio_id,company_id,branch_id,employee_id,actor_id,action)
    values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,v_employee.id,auth.uid(),'DRAFT_CREATED');
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id)
    values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),'EMPLOYEE_DRAFT_CREATED','employees',v_employee.id::text);
  return v_employee.id;
end;
$$;
revoke all on function public.employee_create_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.employee_create_draft(uuid,uuid,uuid,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.employee_update_draft(
  p_employee_id uuid,p_employee jsonb,p_private_details jsonb,p_compensation jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare
  v_employee public.employees%rowtype;
  v_department public.departments%rowtype;
  v_comp public.employee_compensation%rowtype;
  v_number text;
  v_basic text;
  v_key text;
  v_amount text;
  v_payment text;
  v_email text;
begin
  if auth.uid() is null or jsonb_typeof(p_employee) is distinct from 'object'
    or jsonb_typeof(p_private_details) is distinct from 'object' or jsonb_typeof(p_compensation) is distinct from 'object' then
    raise exception using errcode='22023',message='Employee correction details are incomplete.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or v_employee.created_by is distinct from auth.uid()
    or v_employee.approval_status not in ('DRAFT','RETURNED_FOR_CORRECTION')
    or not app_private.has_permission('employee.create',v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id) then
    raise exception using errcode='42501',message='Employee correction is not authorized.';
  end if;
  if not exists(select 1 from public.companies c where c.id=v_employee.company_id and c.portfolio_id=v_employee.portfolio_id and c.status='ACTIVE')
    or not exists(select 1 from public.branches b where b.id=v_employee.workplace_branch_id and b.company_id=v_employee.company_id and b.portfolio_id=v_employee.portfolio_id and b.status='ACTIVE') then
    raise exception using errcode='22023',message='The employee must have an active company and branch assignment.';
  end if;
  if nullif(btrim(p_employee->>'first_name'),'') is null or nullif(btrim(p_employee->>'last_name'),'') is null then
    raise exception using errcode='22023',message='Employee full name is required.';
  end if;
  v_email:=nullif(btrim(p_private_details->>'email'),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Email address is invalid.';
  end if;
  if nullif(btrim(p_employee->>'date_of_birth'),'') is not null and (p_employee->>'date_of_birth')::date>current_date then
    raise exception using errcode='22023',message='Date of birth cannot be in the future.';
  end if;
  if nullif(p_employee->>'contract_start_date','') is not null and nullif(p_employee->>'contract_end_date','') is not null
    and (p_employee->>'contract_end_date')::date<(p_employee->>'contract_start_date')::date then
    raise exception using errcode='22023',message='Contract end date cannot precede the start date.';
  end if;
  select * into v_department from public.departments d where d.portfolio_id=v_employee.portfolio_id
    and d.company_id=v_employee.company_id and d.status='ACTIVE'
    and lower(regexp_replace(btrim(d.name),'\s+',' ','g'))=lower(regexp_replace(btrim(coalesce(p_employee->>'department','')),'\s+',' ','g'));
  if not found then raise exception using errcode='22023',message='Select an active department registered for this company.'; end if;
  v_basic:=nullif(btrim(coalesce(p_compensation->>'basic_pay','')),'');
  if v_basic is null or v_basic !~ '^\d{1,12}(\.\d{1,2})?$' or v_basic::numeric<=0 then
    raise exception using errcode='22023',message='Basic salary is required and must be a valid positive amount.';
  end if;
  foreach v_key in array array['housing_allowance','meal_allowance','transport_allowance','other_allowances','medical_allowance'] loop
    v_amount:=nullif(btrim(coalesce(p_compensation->>v_key,'')),'');
    if v_amount is not null and (v_amount !~ '^\d{1,12}(\.\d{1,2})?$' or v_amount::numeric<0) then
      raise exception using errcode='22023',message='Optional earnings must be valid non-negative amounts.';
    end if;
  end loop;
  if p_compensation->>'salary_frequency' is not null and p_compensation->>'salary_frequency' not in ('MONTHLY','FORTNIGHTLY','WEEKLY','DAILY') then
    raise exception using errcode='22023',message='Salary frequency is not supported.';
  end if;
  v_payment:=nullif(p_private_details->>'payment_method','');
  if v_payment is not null and v_payment not in ('BANK_TRANSFER','MOBILE_MONEY','CASH') then
    raise exception using errcode='22023',message='Payment method is not supported.';
  end if;
  if v_payment is distinct from nullif(p_compensation->>'payment_method','') then
    raise exception using errcode='22023',message='Employee and compensation payment methods must match.';
  end if;
  if jsonb_typeof(coalesce(p_compensation->'allowance_proration_rules','{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_each_text(coalesce(p_compensation->'allowance_proration_rules','{}'::jsonb)) r
      where r.key not in ('housing_allowance','meal_allowance','transport_allowance','other_allowances') or r.value<>'SCHEDULED_DAYS') then
    raise exception using errcode='22023',message='Allowance proration must use the supported scheduled-days method.';
  end if;
  v_number:=coalesce(nullif(btrim(p_employee->>'employee_number'),''),v_employee.employee_number);
  if exists(select 1 from public.employees e where e.company_id=v_employee.company_id and e.id<>v_employee.id
    and lower(btrim(e.employee_number))=lower(btrim(v_number))) then
    raise exception using errcode='23505',message='Employee number is already in use for this company.';
  end if;
  update public.employees set employee_number=v_number,first_name=btrim(p_employee->>'first_name'),
    middle_name=nullif(btrim(p_employee->>'middle_name'),''),last_name=btrim(p_employee->>'last_name'),
    date_of_birth=nullif(p_employee->>'date_of_birth','')::date,gender=nullif(p_employee->>'gender',''),
    nationality=nullif(btrim(p_employee->>'nationality'),''),job_title=nullif(btrim(p_employee->>'job_title'),''),
    department=v_department.name,department_id=v_department.id,employment_type=nullif(p_employee->>'employment_type',''),
    contract_type=nullif(btrim(p_employee->>'contract_type'),''),contract_start_date=nullif(p_employee->>'contract_start_date','')::date,
    contract_end_date=nullif(p_employee->>'contract_end_date','')::date,
    retirement_age=coalesce(nullif(p_employee->>'retirement_age','')::integer,65),updated_at=now()
    where id=v_employee.id;
  update public.employee_private_details set identity_document_type=nullif(p_private_details->>'identity_document_type',''),
    identity_document_number=nullif(btrim(p_private_details->>'identity_document_number'),''),
    residential_address=nullif(btrim(p_private_details->>'residential_address'),''),phone=nullif(btrim(p_private_details->>'phone'),''),
    email=nullif(btrim(p_private_details->>'email'),''),email_unavailable_reason=nullif(btrim(p_private_details->>'email_unavailable_reason'),''),
    emergency_contact_name=nullif(btrim(p_private_details->>'emergency_contact_name'),''),
    emergency_contact_relationship=nullif(btrim(p_private_details->>'emergency_contact_relationship'),''),
    emergency_contact_phone=nullif(btrim(p_private_details->>'emergency_contact_phone'),''),tpin=nullif(btrim(p_private_details->>'tpin'),''),
    napsa_number=nullif(btrim(p_private_details->>'napsa_number'),''),nhima_number=nullif(btrim(p_private_details->>'nhima_number'),''),
    payment_method=v_payment,bank_name=nullif(btrim(p_private_details->>'bank_name'),''),
    bank_account_name=nullif(btrim(p_private_details->>'bank_account_name'),''),bank_account_number=nullif(btrim(p_private_details->>'bank_account_number'),''),
    bank_branch_name=nullif(btrim(p_private_details->>'bank_branch_name'),''),mobile_money_provider=nullif(btrim(p_private_details->>'mobile_money_provider'),''),
    mobile_money_number=nullif(btrim(p_private_details->>'mobile_money_number'),''),updated_at=now()
    where employee_id=v_employee.id;
  select * into v_comp from public.employee_compensation ec where ec.employee_id=v_employee.id
    order by ec.effective_from desc nulls last,ec.created_at desc limit 1 for update;
  if not found then raise exception using errcode='23503',message='Employee compensation is missing; correction was not saved.'; end if;
  update public.employee_compensation set effective_from=nullif(p_compensation->>'effective_from','')::date,
    effective_to=nullif(p_compensation->>'effective_to','')::date,salary_frequency=nullif(p_compensation->>'salary_frequency',''),
    basic_pay=v_basic::numeric,housing_allowance=coalesce(nullif(p_compensation->>'housing_allowance','')::numeric,0),
    meal_allowance=coalesce(nullif(p_compensation->>'meal_allowance','')::numeric,0),
    transport_allowance=coalesce(nullif(p_compensation->>'transport_allowance','')::numeric,0),
    other_allowances=coalesce(nullif(p_compensation->>'other_allowances','')::numeric,0),
    medical_allowance=nullif(p_compensation->>'medical_allowance','')::numeric,
    overtime_eligible=coalesce((p_compensation->>'overtime_eligible')::boolean,false),payment_method=v_payment
    where id=v_comp.id;
  insert into public.employee_approval_history(portfolio_id,company_id,branch_id,employee_id,actor_id,action)
    values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,v_employee.id,auth.uid(),'CORRECTED');
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),'EMPLOYEE_CORRECTED','employees',v_employee.id::text,
      jsonb_build_object('sensitive_values_omitted',true,'approval_status',v_employee.approval_status));
  return v_employee.id;
end;
$$;
revoke all on function public.employee_update_draft(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.employee_update_draft(uuid,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.employee_submit_for_hr_approval(p_employee_id uuid)
returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v public.employees%rowtype;
begin
  select * into v from public.employees where id=p_employee_id for update;
  if not found or v.created_by<>auth.uid() or not app_private.has_permission('employee.submit',v.portfolio_id,v.company_id,v.workplace_branch_id) then
    raise exception using errcode='42501',message='Employee submission is not authorized.';
  end if;
  if v.approval_status not in ('DRAFT','RETURNED_FOR_CORRECTION','REJECTED') then raise exception using errcode='22023',message='Employee record is not eligible for submission.'; end if;
  if nullif(btrim(concat_ws(' ',v.first_name,v.last_name)),'') is null or nullif(btrim(v.department),'') is null
    or not exists(select 1 from public.companies c where c.id=v.company_id and c.portfolio_id=v.portfolio_id and c.status='ACTIVE')
    or not exists(select 1 from public.branches b where b.id=v.workplace_branch_id and b.company_id=v.company_id and b.portfolio_id=v.portfolio_id and b.status='ACTIVE')
    or not exists(select 1 from public.departments d where d.id=v.department_id and d.company_id=v.company_id and d.portfolio_id=v.portfolio_id and d.status='ACTIVE')
    or not exists(select 1 from public.employee_compensation ec where ec.employee_id=v.id and ec.company_id=v.company_id and ec.basic_pay>0) then
    raise exception using errcode='22023',message='Company, branch, department, employee name, and positive earnings are required before submission.';
  end if;
  update public.employees set approval_status='SUBMITTED_FOR_HR_APPROVAL',submitted_at=now(),reviewed_by=null,reviewed_at=null,updated_at=now() where id=v.id;
  insert into public.employee_approval_history(portfolio_id,company_id,branch_id,employee_id,actor_id,action)
    values(v.portfolio_id,v.company_id,v.workplace_branch_id,v.id,auth.uid(),case when v.approval_status='DRAFT' then 'SUBMITTED' else 'RESUBMITTED' end);
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id)
    values(v.portfolio_id,v.company_id,v.workplace_branch_id,auth.uid(),'EMPLOYEE_SUBMITTED','employees',v.id::text);
  return v.id;
end;
$$;
revoke all on function public.employee_submit_for_hr_approval(uuid) from public,anon;
grant execute on function public.employee_submit_for_hr_approval(uuid) to authenticated;

create or replace function public.employee_import_submit_staged(p_record_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set row_security=off
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
    raise exception using errcode='22023',message='A valid authenticated submission key is required.';
  end if;
  select * into v_record from public.employee_import_staging_records where id=p_record_id for update;
  if not found then raise exception using errcode='P0002',message='Staged import record was not found.'; end if;
  if v_record.review_status='SUBMITTED_FOR_APPROVAL' and v_record.resulting_employee_id is not null then
    return jsonb_build_object('record_id',v_record.id,'employee_id',v_record.resulting_employee_id,'status',v_record.review_status,'replayed',true);
  end if;
  if v_record.review_status<>'READY_FOR_APPROVAL' or jsonb_array_length(v_record.validation_errors)>0 or jsonb_array_length(v_record.duplicate_warnings)>0 then
    raise exception using errcode='22023',message='Only validated, duplicate-free staged records can be submitted.';
  end if;
  if v_record.resulting_employee_id is not null then
    raise exception using errcode='55000',message='This staged row is already linked to an employee and cannot create a second employee.';
  end if;
  if not app_private.has_permission('employee.import',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.private.view',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.create',v_record.portfolio_id,v_record.company_id,v_record.branch_id)
    or not app_private.has_permission('employee.submit',v_record.portfolio_id,v_record.company_id,v_record.branch_id) then
    raise exception using errcode='42501',message='Employee import, create, and submit permissions are required for this branch.';
  end if;
  v_data:=v_record.current_data;
  if nullif(btrim(v_data->>'employee_number'),'') is null then
    v_data:=jsonb_set(v_data,'{employee_number}',to_jsonb(app_private.employee_allocate_number(v_record.company_id)),true);
    update public.employee_import_staging_records set current_data=v_data,updated_at=now() where id=v_record.id returning * into v_record;
  end if;
  v_private:=jsonb_build_object(
    'identity_document_type',nullif(v_data->>'identity_document_type',''),'identity_document_number',nullif(v_data->>'identity_document_number',''),
    'residential_address',v_data->>'residential_address','phone',v_data->>'phone','email',nullif(v_data->>'email',''),
    'email_unavailable_reason',nullif(v_data->>'email_unavailable_reason',''),'emergency_contact_name',v_data->>'emergency_contact_name',
    'emergency_contact_relationship',v_data->>'emergency_contact_relationship','emergency_contact_phone',v_data->>'emergency_contact_phone',
    'tpin',nullif(v_data->>'tpin',''),'napsa_number',nullif(v_data->>'napsa_number',''),'nhima_number',nullif(v_data->>'nhima_number',''),
    'payment_method',nullif(v_data->>'payment_method',''),'bank_name',nullif(v_data->>'bank_name',''),
    'bank_account_name',nullif(v_data->>'bank_account_name',''),'bank_account_number',nullif(v_data->>'bank_account_number',''),
    'bank_branch_name',nullif(v_data->>'bank_branch_name',''),'mobile_money_provider',nullif(v_data->>'mobile_money_provider',''),
    'mobile_money_number',nullif(v_data->>'mobile_money_number',''));
  v_compensation:=jsonb_build_object(
    'effective_from',nullif(v_data->>'contract_start_date',''),'effective_to',nullif(v_data->>'contract_end_date',''),
    'salary_frequency',nullif(v_data->>'salary_frequency',''),'basic_pay',(v_data->>'basic_pay')::numeric,
    'housing_allowance',coalesce(nullif(v_data->>'housing_allowance','')::numeric,0),
    'meal_allowance',coalesce(nullif(v_data->>'meal_allowance','')::numeric,0),
    'transport_allowance',coalesce(nullif(v_data->>'transport_allowance','')::numeric,0),
    'medical_allowance',nullif(v_data->>'medical_allowance','')::numeric,'other_allowances',coalesce(nullif(v_data->>'other_allowances','')::numeric,0),
    'overtime_eligible',case lower(coalesce(v_data->>'overtime_eligible','false'))
      when 'true' then true when 'yes' then true when '1' then true when 'eligible' then true
      when 'false' then false when 'no' then false when '0' then false when 'not eligible' then false else false end,
    'payment_method',nullif(v_data->>'payment_method',''));
  v_result:=public.employee_import_atomic(v_record.portfolio_id,v_record.company_id,v_record.branch_id,p_idempotency_key,
    jsonb_build_array(jsonb_build_object('line',v_record.source_row,'operation','CREATE','employee',jsonb_build_object(
      'employee_number',v_data->>'employee_number','first_name',v_data->>'first_name','middle_name',nullif(v_data->>'middle_name',''),
      'last_name',v_data->>'last_name','date_of_birth',nullif(v_data->>'date_of_birth',''),'gender',nullif(v_data->>'gender',''),
      'nationality',nullif(v_data->>'nationality',''),'job_title',nullif(v_data->>'job_title',''),'department',v_data->>'department',
      'employment_type',nullif(v_data->>'employment_type',''),'contract_type',nullif(v_data->>'contract_type',''),
      'contract_start_date',nullif(v_data->>'contract_start_date',''),'contract_end_date',nullif(v_data->>'contract_end_date',''),
      'retirement_age',coalesce(nullif(v_data->>'retirement_age','')::integer,65)),
      'private_details',v_private,'compensation',v_compensation)));
  if v_result->>'status'='COMPLETED' then
    select id into v_employee_id from public.employees where company_id=v_record.company_id
      and employee_number=v_data->>'employee_number';
    if v_employee_id is null then raise exception using errcode='XX000',message='Employee creation result could not be associated with the staged row.'; end if;
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
revoke all on function public.employee_import_submit_staged(uuid,text) from public,anon;
grant execute on function public.employee_import_submit_staged(uuid,text) to authenticated;

create or replace function public.employee_profile_completeness(p_employee_ids uuid[])
returns table(employee_id uuid,profile_status text,missing_fields text[])
language plpgsql stable security definer
set search_path=pg_catalog set row_security=off
as $$
begin
  if auth.uid() is null or coalesce(cardinality(p_employee_ids),0)>100 then raise exception using errcode='22023',message='Employee selection is invalid.'; end if;
  return query
  select e.id,
    case when cardinality(x.missing)=0 then 'COMPLETE' else 'INCOMPLETE' end,
    x.missing
  from public.employees e
  left join public.employee_private_details d on d.employee_id=e.id
  left join lateral (select ec.* from public.employee_compensation ec where ec.employee_id=e.id order by ec.effective_from desc nulls last limit 1) c on true
  cross join lateral (select array_remove(array[
    case when e.date_of_birth is null then 'Date of birth' end,
    case when e.gender is null then 'Gender' end,
    case when coalesce(d.identity_document_number,'')='' then 'NRC / identification number' end,
    case when coalesce(d.residential_address,'')='' then 'Residential address' end,
    case when coalesce(d.phone,'')='' then 'Phone number' end,
    case when coalesce(d.email,'')='' then 'Email address' end,
    case when coalesce(d.emergency_contact_name,'')='' or coalesce(d.emergency_contact_relationship,'')='' or coalesce(d.emergency_contact_phone,'')='' then 'Emergency contact' end,
    case when d.payment_method='BANK_TRANSFER' and (coalesce(d.bank_name,'')='' or coalesce(d.bank_account_name,'')='' or coalesce(d.bank_account_number,'')='') then 'Bank details' end,
    case when d.payment_method='MOBILE_MONEY' and (coalesce(d.mobile_money_provider,'')='' or coalesce(d.mobile_money_number,'')='') then 'Mobile money details' end,
    case when coalesce(d.tpin,'')='' then 'TPIN' end,
    case when coalesce(d.napsa_number,'')='' then 'NAPSA number' end,
    case when coalesce(d.nhima_number,'')='' then 'NHIMA number' end,
    case when e.nationality is null then 'Nationality' end,
    case when e.job_title is null then 'Job title' end,
    case when e.employment_type is null or e.contract_type is null or e.contract_start_date is null then 'Employment details' end,
    case when c.salary_frequency is null then 'Salary frequency' end
  ]::text[],null) missing) x
  where e.id=any(p_employee_ids) and app_private.has_permission('employee.private.view',e.portfolio_id,e.company_id,e.workplace_branch_id);
end;
$$;
revoke all on function public.employee_profile_completeness(uuid[]) from public,anon;
grant execute on function public.employee_profile_completeness(uuid[]) to authenticated;

comment on function public.employee_profile_completeness(uuid[]) is 'Returns only derived completeness state and missing-field labels for employees the caller may view; no private values are returned.';
