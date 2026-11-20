-- Secure, durable staging for employee workbooks. This extends the existing
-- Portfolio -> Company -> Branch model and leaves employee/payroll workflows
-- unchanged until an explicitly reviewed row is submitted to employee_import_atomic.

create table public.employee_import_batches (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.client_portfolios(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_filename text not null check (char_length(uploaded_filename) between 1 and 255),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','IN_REVIEW','COMPLETED','PARTIAL','FAILED')),
  sheet_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(sheet_summary) = 'array'),
  reconciliation jsonb not null default '{}'::jsonb check (jsonb_typeof(reconciliation) = 'object'),
  total_records integer not null default 0 check (total_records between 0 and 5000),
  valid_records integer not null default 0 check (valid_records between 0 and total_records),
  incomplete_records integer not null default 0 check (incomplete_records between 0 and total_records),
  duplicate_warnings integer not null default 0 check (duplicate_warnings between 0 and total_records),
  rejected_records integer not null default 0 check (rejected_records between 0 and total_records),
  reviewed_records integer not null default 0 check (reviewed_records between 0 and total_records),
  ready_records integer not null default 0 check (ready_records between 0 and total_records),
  approved_records integer not null default 0 check (approved_records between 0 and total_records),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (portfolio_id, uploaded_by, idempotency_key),
  unique (portfolio_id, id)
);

create index employee_import_batches_scope_idx
  on public.employee_import_batches(portfolio_id, created_at desc, id);

create table public.employee_import_staging_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  portfolio_id uuid not null,
  company_id uuid,
  branch_id uuid,
  source_sheet text not null check (char_length(source_sheet) between 1 and 128),
  source_row integer not null check (source_row > 0),
  original_data jsonb not null check (jsonb_typeof(original_data) = 'object'),
  current_data jsonb not null check (jsonb_typeof(current_data) = 'object'),
  payroll_data jsonb not null default '{}'::jsonb check (jsonb_typeof(payroll_data) = 'object'),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  duplicate_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(duplicate_warnings) = 'array'),
  review_status text not null default 'PENDING_REVIEW' check (review_status in (
    'PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL',
    'SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED','IMPORT_FAILED'
  )),
  review_reason text,
  duplicate_resolution text check (duplicate_resolution is null or duplicate_resolution = 'CONFIRMED_DISTINCT'),
  duplicate_resolution_reason text,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  resulting_employee_id uuid references public.employees(id) on delete restrict,
  submission_job_id uuid references public.employee_import_jobs(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_sheet, source_row),
  foreign key (portfolio_id, batch_id) references public.employee_import_batches(portfolio_id, id) on delete cascade,
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id) references public.branches(portfolio_id, company_id, id) on delete restrict,
  check ((company_id is null and branch_id is null) or (company_id is not null and branch_id is not null))
);

create index employee_import_staging_scope_idx
  on public.employee_import_staging_records(portfolio_id, company_id, branch_id, review_status, created_at desc);
create index employee_import_staging_batch_idx
  on public.employee_import_staging_records(batch_id, source_sheet, source_row);
create unique index employee_import_staging_result_employee_idx
  on public.employee_import_staging_records(resulting_employee_id) where resulting_employee_id is not null;

create table public.employee_import_review_history (
  id bigint generated always as identity primary key,
  staging_record_id uuid not null references public.employee_import_staging_records(id) on delete cascade,
  portfolio_id uuid not null,
  company_id uuid,
  branch_id uuid,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('UPLOADED','EDITED','MARKED_READY','REJECTED','SUBMITTED','APPROVAL_SYNCED','IMPORT_FAILED')),
  reason text,
  changed_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_fields) = 'array'),
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict
);
create index employee_import_review_history_record_idx
  on public.employee_import_review_history(staging_record_id, occurred_at desc);

alter table public.employee_import_batches enable row level security;
alter table public.employee_import_staging_records enable row level security;
alter table public.employee_import_review_history enable row level security;
revoke all on public.employee_import_batches, public.employee_import_staging_records,
  public.employee_import_review_history from public, anon, authenticated;

create or replace function app_private.employee_import_batch_read_authorized(p_batch_id uuid, p_portfolio_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select app_private.has_permission('employee.import',p_portfolio_id,null,null)
      and app_private.has_permission('employee.private.view',p_portfolio_id,null,null)
    or (
      exists (select 1 from public.employee_import_staging_records r where r.batch_id=p_batch_id and r.portfolio_id=p_portfolio_id)
      and not exists (
        select 1 from public.employee_import_staging_records r where r.batch_id=p_batch_id and r.portfolio_id=p_portfolio_id
          and (r.company_id is null
            or not app_private.has_permission('employee.import',r.portfolio_id,r.company_id,r.branch_id)
            or not app_private.has_permission('employee.private.view',r.portfolio_id,r.company_id,r.branch_id))
      )
    );
$$;
revoke all on function app_private.employee_import_batch_read_authorized(uuid,uuid) from public, anon;
grant execute on function app_private.employee_import_batch_read_authorized(uuid,uuid) to authenticated;

create policy employee_import_batches_read_scoped on public.employee_import_batches
  for select to authenticated using (app_private.employee_import_batch_read_authorized(id,portfolio_id));
create policy employee_import_staging_read_scoped on public.employee_import_staging_records
  for select to authenticated using (
    (company_id is null
      and app_private.has_permission('employee.import', portfolio_id, null, null)
      and app_private.has_permission('employee.private.view', portfolio_id, null, null))
    or (company_id is not null
      and app_private.has_permission('employee.import', portfolio_id, company_id, branch_id)
      and app_private.has_permission('employee.private.view', portfolio_id, company_id, branch_id))
  );
create policy employee_import_review_history_read_scoped on public.employee_import_review_history
  for select to authenticated using (
    app_private.has_permission('employee.import', portfolio_id, company_id, branch_id)
    and app_private.has_permission('employee.private.view', portfolio_id, company_id, branch_id)
  );
grant select on public.employee_import_batches, public.employee_import_staging_records,
  public.employee_import_review_history to authenticated;

create or replace function app_private.employee_import_staging_validate(p_data jsonb)
returns jsonb language plpgsql stable
set search_path = pg_catalog
as $$
declare
  v_missing text[] := array[]::text[];
  v_key text;
  v_amount text;
  v_issue jsonb := '[]'::jsonb;
  v_date date;
begin
  foreach v_key in array array[
    'employee_number','first_name','last_name','date_of_birth','nationality','job_title',
    'department','employment_type','contract_type','contract_start_date','residential_address',
    'phone','payment_method','emergency_contact_name','emergency_contact_relationship',
    'emergency_contact_phone','salary_frequency','basic_pay'
  ] loop
    if nullif(btrim(coalesce(p_data->>v_key,'')), '') is null then
      v_missing := array_append(v_missing, v_key);
    end if;
  end loop;
  if nullif(btrim(coalesce(p_data->>'email','')), '') is null
      and nullif(btrim(coalesce(p_data->>'email_unavailable_reason','')), '') is null then
    v_missing := array_append(v_missing, 'email_or_email_unavailable_reason');
  elsif nullif(btrim(coalesce(p_data->>'email','')), '') is not null
      and nullif(btrim(coalesce(p_data->>'email_unavailable_reason','')), '') is not null then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','email','message','Provide an email or an unavailable reason, not both.'));
  end if;
  if coalesce(upper(p_data->>'payment_method'),'') = 'BANK_TRANSFER' then
    foreach v_key in array array['bank_name','bank_account_name','bank_account_number'] loop
      if nullif(btrim(coalesce(p_data->>v_key,'')), '') is null then v_missing := array_append(v_missing, v_key); end if;
    end loop;
  elsif coalesce(upper(p_data->>'payment_method'),'') in ('AIRTEL_MONEY','MTN_MOMO','ZAMTEL_KWACHA','MOBILE_MONEY') then
    foreach v_key in array array['mobile_money_provider','mobile_money_number'] loop
      if nullif(btrim(coalesce(p_data->>v_key,'')), '') is null then v_missing := array_append(v_missing, v_key); end if;
    end loop;
  end if;
  if jsonb_typeof(p_data->'basic_pay') = 'number' then
    v_amount := p_data->>'basic_pay';
  else
    v_amount := nullif(btrim(coalesce(p_data->>'basic_pay','')), '');
  end if;
  v_issue := v_issue || coalesce((select jsonb_agg(jsonb_build_object('field', x, 'message', 'Required information is missing.')) from unnest(v_missing) x),'[]'::jsonb);
  if v_amount is not null and v_amount !~ '^\d{1,12}(\.\d{1,2})?$' then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','basic_pay','message','Basic salary must be a positive amount with at most two decimal places.'));
  elsif v_amount is not null and v_amount::numeric <= 0 then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','basic_pay','message','Basic salary must be a positive amount with at most two decimal places.'));
  end if;
  foreach v_key in array array['housing_allowance','meal_allowance','transport_allowance','other_allowances'] loop
    if nullif(btrim(coalesce(p_data->>v_key,'')),'') is not null then
      if p_data->>v_key !~ '^\d{1,12}(\.\d{1,2})?$' then
        v_issue := v_issue || jsonb_build_array(jsonb_build_object('field',v_key,'message','Compensation amount must be a non-negative amount with at most two decimal places.'));
      end if;
    end if;
  end loop;
  if nullif(btrim(coalesce(p_data->>'email','')),'') is not null and p_data->>'email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','email','message','Email address is invalid.'));
  end if;
  if p_data->>'employment_type' is not null and p_data->>'employment_type' not in ('PERMANENT','FIXED_TERM','PART_TIME','CASUAL','DAILY_RATED') then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','employment_type','message','Employment type is unsupported by the existing employee schema.'));
  end if;
  if nullif(btrim(coalesce(p_data->>'retirement_age','')),'') is not null then
    if p_data->>'retirement_age' !~ '^\d{1,3}$' then
      v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','retirement_age','message','Retirement age must be a whole number from 18 to 100.'));
    elsif (p_data->>'retirement_age')::integer not between 18 and 100 then
      v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','retirement_age','message','Retirement age must be a whole number from 18 to 100.'));
    end if;
  end if;
  if nullif(btrim(coalesce(p_data->>'overtime_eligible','')),'') is not null and lower(p_data->>'overtime_eligible') not in ('true','false','yes','no','1','0','eligible','not eligible') then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','overtime_eligible','message','Overtime eligibility must be yes or no.'));
  end if;
  if p_data->>'salary_frequency' is not null and p_data->>'salary_frequency' not in ('MONTHLY','FORTNIGHTLY','WEEKLY','DAILY') then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','salary_frequency','message','Salary frequency is unsupported by the existing compensation schema.'));
  end if;
  if p_data->>'payment_method' is not null and p_data->>'payment_method' not in ('BANK_TRANSFER','MOBILE_MONEY','CASH') then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','payment_method','message','Payment method is unsupported by the existing employee schema.'));
  end if;
  if p_data->>'gender' is not null and p_data->>'gender' <> '' and p_data->>'gender' not in ('FEMALE','MALE','NON_BINARY','UNDISCLOSED') then
    v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','gender','message','Gender value is unsupported by the existing employee schema.'));
  end if;
  foreach v_key in array array['date_of_birth','contract_start_date','contract_end_date'] loop
    if nullif(p_data->>v_key,'') is not null then
      if p_data->>v_key !~ '^\d{4}-\d{2}-\d{2}$' then
        v_issue := v_issue || jsonb_build_array(jsonb_build_object('field',v_key,'message','Date must be supplied as YYYY-MM-DD.'));
      else
        begin
          v_date := (p_data->>v_key)::date;
          if v_key='date_of_birth' and v_date > current_date then
            v_issue := v_issue || jsonb_build_array(jsonb_build_object('field',v_key,'message','Date of birth cannot be in the future.'));
          end if;
        exception when others then
          v_issue := v_issue || jsonb_build_array(jsonb_build_object('field',v_key,'message','Date is not a valid calendar date.'));
        end;
      end if;
    end if;
  end loop;
  if nullif(p_data->>'contract_end_date','') is not null and nullif(p_data->>'contract_start_date','') is not null
    and p_data->>'contract_end_date' ~ '^\d{4}-\d{2}-\d{2}$' and p_data->>'contract_start_date' ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      if (p_data->>'contract_end_date')::date < (p_data->>'contract_start_date')::date then
        v_issue := v_issue || jsonb_build_array(jsonb_build_object('field','contract_end_date','message','Contract end date cannot precede the start date.'));
      end if;
    exception when others then null;
    end;
  end if;
  return v_issue;
end;
$$;
revoke all on function app_private.employee_import_staging_validate(jsonb) from public, anon, authenticated;

create or replace function app_private.employee_import_staging_recount(p_batch_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  update public.employee_import_batches b set
    valid_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and jsonb_array_length(r.validation_errors)=0 and r.company_id is not null and r.branch_id is not null),
    incomplete_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and (jsonb_array_length(r.validation_errors)>0 or r.company_id is null or r.branch_id is null)),
    duplicate_warnings=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and jsonb_array_length(r.duplicate_warnings)>0),
    rejected_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status='REJECTED'),
    reviewed_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and (r.reviewer_id is not null or r.review_status in ('READY_FOR_APPROVAL','SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED'))),
    ready_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status='READY_FOR_APPROVAL'),
    approved_records=(select count(*) from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status='APPROVED'),
    status=case
      when exists(select 1 from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status in ('PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL','SUBMITTED_FOR_APPROVAL')) then 'IN_REVIEW'
      when exists(select 1 from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status='IMPORT_FAILED') then 'PARTIAL'
      else 'COMPLETED' end,
    completed_at=case when exists(select 1 from public.employee_import_staging_records r where r.batch_id=b.id and r.review_status in ('PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL','SUBMITTED_FOR_APPROVAL')) then null else now() end
    where b.id=p_batch_id;
end;
$$;
revoke all on function app_private.employee_import_staging_recount(uuid) from public, anon, authenticated;

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
      or ((r->>'company_id') is null) <> ((r->>'branch_id') is null)) then
    raise exception using errcode='22023', message='Every staged row must include source coordinates and JSON objects; company and branch must be assigned together.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_records) r where r->>'company_id' is not null and not exists (
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
      when jsonb_array_length(v_errors)>0 then 'NEEDS_INFORMATION' else 'PENDING_REVIEW' end;
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
  if p_company_id is null or p_branch_id is null then
    if not app_private.has_permission('employee.import',v_record.portfolio_id,null,null)
      or not app_private.has_permission('employee.private.view',v_record.portfolio_id,null,null) then
      raise exception using errcode='42501', message='Portfolio-level import review permission is required to leave the company or branch unassigned.';
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
  elsif p_decision='MARK_READY' and jsonb_array_length(v_errors)=0 and jsonb_array_length(v_warnings)=0 and p_company_id is not null then v_status:='READY_FOR_APPROVAL';
  elsif jsonb_array_length(v_warnings)>0 then v_status:='DUPLICATE_REVIEW';
  elsif jsonb_array_length(v_errors)>0 or p_company_id is null then v_status:='NEEDS_INFORMATION';
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
revoke all on function public.employee_import_submit_staged(uuid,text) from public,anon;
grant execute on function public.employee_import_submit_staged(uuid,text) to authenticated;

create or replace function public.employee_import_sync_approval_status()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_status text;
begin
  if new.approval_status is distinct from old.approval_status then
    v_status := case when new.approval_status='APPROVED' then 'APPROVED'
      when new.approval_status='REJECTED' then 'REJECTED'
      when new.approval_status='RETURNED_FOR_CORRECTION' then 'NEEDS_INFORMATION' else null end;
    if v_status is not null then
      update public.employee_import_staging_records set review_status=v_status,updated_at=now()
        where resulting_employee_id=new.id and review_status='SUBMITTED_FOR_APPROVAL';
      insert into public.employee_import_review_history(staging_record_id,portfolio_id,company_id,branch_id,actor_id,action,reason)
        select r.id,r.portfolio_id,r.company_id,r.branch_id,new.reviewed_by,'APPROVAL_SYNCED','Employee approval workflow status: '||new.approval_status
          from public.employee_import_staging_records r where r.resulting_employee_id=new.id and new.reviewed_by is not null;
      perform app_private.employee_import_staging_recount(r.batch_id)
        from public.employee_import_staging_records r where r.resulting_employee_id=new.id;
    end if;
  end if;
  return new;
end;
$$;
-- Employee approvals continue through public.employee_review_submission; this
-- trigger mirrors that existing transition into the import batch status only.
revoke all on function public.employee_import_sync_approval_status() from public,anon,authenticated;
create trigger employee_import_sync_approval_status_trigger
  after update of approval_status on public.employees
  for each row execute function public.employee_import_sync_approval_status();

comment on table public.employee_import_staging_records is
  'Sensitive staged employee and payroll data. Browser writes are denied; authenticated scoped RPCs validate company/branch permissions and preserve original values.';
comment on table public.employee_import_review_history is
  'Append-only scoped history of employee import review actions. before_data/after_data may contain sensitive personal information and are protected by RLS.';
