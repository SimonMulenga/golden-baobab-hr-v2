-- Approved employee changes are staged and reviewed separately from onboarding.
-- Compensation rows remain immutable history: an approved change closes the
-- prior effective interval and inserts a new, effective-dated version.

alter table public.employee_compensation
  add column allowance_proration_rules jsonb not null default '{}'::jsonb
  check (jsonb_typeof(allowance_proration_rules) = 'object');

create table public.employee_change_requests (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED')),
  reason text not null,
  review_reason text,
  employment_changes jsonb not null default '{}',
  compensation_change jsonb not null default '{}',
  base_compensation_id uuid references public.employee_compensation(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (jsonb_typeof(employment_changes) = 'object'),
  check (jsonb_typeof(compensation_change) = 'object'),
  check (nullif(btrim(reason), '') is not null),
  check ((status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (status <> 'PENDING' and reviewed_by is not null and reviewed_at is not null))
);

create index employee_change_requests_queue_idx
  on public.employee_change_requests(portfolio_id, company_id, branch_id, requested_at)
  where status = 'PENDING';
create index employee_change_requests_employee_idx
  on public.employee_change_requests(portfolio_id, company_id, employee_id, requested_at desc);

alter table public.employee_change_requests enable row level security;
revoke all on public.employee_change_requests from public, anon, authenticated;

create or replace function public.employee_change_capabilities(p_employee_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_employee public.employees%rowtype;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or not app_private.has_permission('employee.view', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employee change access is not authorized.';
  end if;
  return jsonb_build_object(
    'can_request_employee', v_employee.approval_status = 'APPROVED' and v_employee.employment_status <> 'TERMINATED'
      and app_private.has_permission('employee.edit', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id),
    'can_request_compensation', v_employee.approval_status = 'APPROVED' and v_employee.employment_status <> 'TERMINATED'
      and app_private.has_permission('compensation.edit', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id)
      and app_private.has_permission('compensation.view', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id),
    'can_review', app_private.has_permission('employee.approve', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id)
      and app_private.has_permission('employee.view', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id),
    'has_pending_request', exists(select 1 from public.employee_change_requests r where r.employee_id = v_employee.id and r.status = 'PENDING'),
    'latest_request', (select jsonb_build_object('status', r.status, 'requested_at', r.requested_at,
      'reviewed_at', r.reviewed_at, 'review_reason', r.review_reason)
      from public.employee_change_requests r where r.employee_id = v_employee.id
      order by r.requested_at desc limit 1)
  );
end;
$$;

create or replace function public.employee_change_request_create(
  p_employee_id uuid,
  p_employment_changes jsonb,
  p_compensation_change jsonb,
  p_reason text
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_compensation public.employee_compensation%rowtype;
  v_employment jsonb := coalesce(p_employment_changes, '{}'::jsonb);
  v_comp_change jsonb := coalesce(p_compensation_change, '{}'::jsonb);
  v_request_id uuid;
  v_key text;
  v_effective_from date;
begin
  if jsonb_typeof(v_employment) <> 'object' or jsonb_typeof(v_comp_change) <> 'object'
     or (v_employment = '{}'::jsonb and v_comp_change = '{}'::jsonb)
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'Provide at least one permitted change and a reason.';
  end if;
  for v_key in select jsonb_object_keys(v_employment) loop
    if v_key not in ('first_name', 'middle_name', 'last_name', 'date_of_birth', 'gender', 'nationality', 'private_details',
                     'job_title', 'department', 'employment_type', 'contract_type', 'contract_start_date', 'contract_end_date') then
      raise exception using errcode = '22023', message = 'The employee change contains an unsupported field.';
    end if;
  end loop;
  if v_employment ? 'private_details' then
    if jsonb_typeof(v_employment -> 'private_details') <> 'object' then
      raise exception using errcode = '22023', message = 'Private contact corrections must be an object.';
    end if;
    if jsonb_object_length(v_employment -> 'private_details') = 0 then
      raise exception using errcode = '22023', message = 'Enter at least one private contact correction.';
    end if;
    for v_key in select jsonb_object_keys(v_employment -> 'private_details') loop
      if v_key not in ('residential_address', 'phone', 'email', 'email_unavailable_reason',
                       'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone') then
        raise exception using errcode = '22023', message = 'The private contact correction contains an unsupported field.';
      end if;
      if v_key in ('residential_address', 'phone', 'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone')
         and nullif(btrim(v_employment #>> array['private_details', v_key]), '') is null then
        raise exception using errcode = '22023', message = 'Address, phone, and emergency contact values cannot be blank.';
      end if;
      if length(v_employment #>> array['private_details', v_key]) > 500 then
        raise exception using errcode = '22023', message = 'Private contact values exceed the supported length.';
      end if;
    end loop;
    if (v_employment #> '{private_details}') ? 'email'
       and nullif(btrim(v_employment #>> '{private_details,email}'), '') is null
       and nullif(btrim(v_employment #>> '{private_details,email_unavailable_reason}'), '') is null then
      raise exception using errcode = '22023', message = 'Provide an email address or a reason it is unavailable.';
    end if;
    if (v_employment #> '{private_details}') ? 'email_unavailable_reason'
       and not ((v_employment #> '{private_details}') ? 'email') then
      raise exception using errcode = '22023', message = 'An email availability change must include the email field.';
    end if;
    if nullif(btrim(v_employment #>> '{private_details,email}'), '') is not null
       and nullif(btrim(v_employment #>> '{private_details,email_unavailable_reason}'), '') is not null then
      raise exception using errcode = '22023', message = 'Use either an email address or an unavailable reason, not both.';
    end if;
  end if;
  for v_key in select jsonb_object_keys(v_comp_change) loop
    if v_key not in ('effective_from', 'salary_frequency', 'basic_pay', 'housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances', 'overtime_eligible', 'allowance_tax_treatment', 'allowance_proration_rules') then
      raise exception using errcode = '22023', message = 'The compensation change contains an unsupported field.';
    end if;
  end loop;

  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or v_employee.approval_status <> 'APPROVED' or v_employee.employment_status = 'TERMINATED'
     or not app_private.has_permission('employee.edit', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Approved employee changes are not authorized for this record.';
  end if;
  if v_comp_change <> '{}'::jsonb and (
       not app_private.has_permission('compensation.edit', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id)
       or not app_private.has_permission('compensation.view', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id)) then
    raise exception using errcode = '42501', message = 'Compensation changes require compensation edit and view permissions.';
  end if;
  if exists (select 1 from public.employee_change_requests r where r.employee_id = v_employee.id and r.status = 'PENDING') then
    raise exception using errcode = '23505', message = 'Resolve the existing pending employee change before creating another.';
  end if;
  if v_employment ? 'job_title' and nullif(btrim(v_employment ->> 'job_title'), '') is null
     or v_employment ? 'department' and nullif(btrim(v_employment ->> 'department'), '') is null
     or v_employment ? 'contract_start_date' and nullif(v_employment ->> 'contract_start_date', '') is null then
    raise exception using errcode = '22023', message = 'Required employment change values cannot be blank.';
  end if;
  if (v_employment ? 'first_name' and nullif(btrim(v_employment ->> 'first_name'), '') is null)
     or (v_employment ? 'last_name' and nullif(btrim(v_employment ->> 'last_name'), '') is null)
     or (v_employment ? 'nationality' and nullif(btrim(v_employment ->> 'nationality'), '') is null) then
    raise exception using errcode = '22023', message = 'First name, surname, and nationality cannot be blank.';
  end if;
  if v_employment ? 'date_of_birth' then perform (v_employment ->> 'date_of_birth')::date; end if;
  if v_employment ? 'gender' and (nullif(btrim(v_employment ->> 'gender'), '') is null
     or upper(v_employment ->> 'gender') not in ('MALE', 'FEMALE')) then
    raise exception using errcode = '22023', message = 'Gender must be Male or Female.';
  end if;
  if v_employment ? 'contract_type' and nullif(btrim(v_employment ->> 'contract_type'), '') is null then
    raise exception using errcode = '22023', message = 'Contract type cannot be blank.';
  end if;
  if v_employment ? 'contract_start_date' then perform (v_employment ->> 'contract_start_date')::date; end if;
  if v_employment ? 'contract_end_date' and nullif(v_employment ->> 'contract_end_date', '') is not null then
    perform (v_employment ->> 'contract_end_date')::date;
  end if;
  if v_employment ? 'employment_type' and (nullif(v_employment ->> 'employment_type', '') is null or v_employment ->> 'employment_type' not in ('PERMANENT', 'FIXED_TERM', 'PART_TIME', 'CASUAL', 'DAILY_RATED')) then
    raise exception using errcode = '22023', message = 'Employment type is not supported.';
  end if;
  if v_employment ? 'contract_start_date' and v_employment ? 'contract_end_date'
     and nullif(v_employment ->> 'contract_end_date', '') is not null
     and (v_employment ->> 'contract_end_date')::date < (v_employment ->> 'contract_start_date')::date then
    raise exception using errcode = '22023', message = 'Contract end date cannot be before the start date.';
  end if;
  if (v_employment ? 'contract_start_date' or v_employment ? 'contract_end_date') and exists (
    select 1 from public.payroll_run_items pri
    join public.payroll_runs r on r.id = pri.payroll_run_id
    where pri.employee_id = v_employee.id and r.status not in ('CANCELED', 'REVERSED')
  ) then
    raise exception using errcode = '55000', message = 'Contract dates cannot change after this employee has payroll history; use a separately reviewed correction workflow.';
  end if;

  if v_comp_change <> '{}'::jsonb then
    if nullif(v_comp_change ->> 'effective_from', '') is null then
      raise exception using errcode = '22023', message = 'A compensation effective date is required.';
    end if;
    v_effective_from := (v_comp_change ->> 'effective_from')::date;
    if v_comp_change ? 'salary_frequency' and v_comp_change ->> 'salary_frequency' not in ('MONTHLY', 'FORTNIGHTLY', 'WEEKLY', 'DAILY') then
      raise exception using errcode = '22023', message = 'Salary frequency is not supported.';
    end if;
    for v_key in select unnest(array['basic_pay','housing_allowance','meal_allowance','transport_allowance','other_allowances']) loop
      if v_comp_change ? v_key and (v_comp_change ->> v_key) is not null then
        if (v_comp_change ->> v_key)::numeric < 0 or (v_comp_change ->> v_key)::numeric = 'NaN'::numeric
           or abs((v_comp_change ->> v_key)::numeric) > 999999999999.99 then
          raise exception using errcode = '22023', message = 'Compensation amounts must be valid, non-negative ZMW values.';
        end if;
      end if;
    end loop;
    if v_comp_change ? 'allowance_tax_treatment' and jsonb_typeof(v_comp_change -> 'allowance_tax_treatment') <> 'object' then
      raise exception using errcode = '22023', message = 'Allowance tax treatment must be an object.';
    end if;
    if v_comp_change ? 'allowance_proration_rules' then
      if jsonb_typeof(v_comp_change -> 'allowance_proration_rules') <> 'object' then
        raise exception using errcode = '22023', message = 'Allowance proration rules must be an object.';
      end if;
      if exists (select 1 from jsonb_each_text(v_comp_change -> 'allowance_proration_rules') r
        where r.key not in ('housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances')
          or r.value <> 'SCHEDULED_DAYS') then
        raise exception using errcode = '22023', message = 'Allowance proration rules must use the supported scheduled-days method.';
      end if;
    end if;
    select * into v_compensation from public.employee_compensation ec
      where ec.employee_id = v_employee.id and ec.effective_from < v_effective_from
        and (ec.effective_to is null or ec.effective_to >= v_effective_from)
      order by ec.effective_from desc limit 1 for update;
    if not found or v_compensation.effective_to is not null
       or exists (select 1 from public.employee_compensation ec where ec.employee_id = v_employee.id and ec.effective_from >= v_effective_from) then
      raise exception using errcode = '22023', message = 'The effective date must follow one current compensation version with no scheduled future version.';
    end if;
    if exists (
      select 1 from public.payroll_runs r
      join public.payroll_periods p on p.id = r.payroll_period_id
      where r.company_id = v_employee.company_id and r.branch_id = v_employee.workplace_branch_id
        and p.period_end >= v_effective_from and r.status not in ('CANCELED', 'REVERSED')
    ) then
      raise exception using errcode = '55000', message = 'A payroll run exists on or after this effective date; choose a later date.';
    end if;
  end if;

  insert into public.employee_change_requests(
    portfolio_id, company_id, branch_id, employee_id, requested_by, reason,
    employment_changes, compensation_change, base_compensation_id
  ) values (
    v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, v_employee.id,
    auth.uid(), btrim(p_reason), v_employment, v_comp_change,
    case when v_comp_change = '{}'::jsonb then null else v_compensation.id end
  ) returning id into v_request_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, auth.uid(),
    'EMPLOYEE_CHANGE_REQUESTED', 'employees', v_employee.id::text,
    jsonb_build_object('request_id', v_request_id, 'employment_fields', (select coalesce(jsonb_agg(keys.key), '[]'::jsonb) from jsonb_object_keys(v_employment) as keys(key)),
      'compensation_change_requested', v_comp_change <> '{}'::jsonb));
  return v_request_id;
end;
$$;

create or replace function public.employee_change_requests_list()
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'employee_id', r.employee_id, 'company_id', r.company_id, 'branch_id', r.branch_id,
    'employee_number', e.employee_number, 'first_name', e.first_name, 'last_name', e.last_name,
    'status', r.status, 'reason', r.reason, 'review_reason', r.review_reason,
    'employment_changes', case when app_private.has_permission('employee.private.view', r.portfolio_id, r.company_id, r.branch_id)
      then r.employment_changes else r.employment_changes - 'private_details' end, 'compensation_change',
      case when app_private.has_permission('compensation.view', r.portfolio_id, r.company_id, r.branch_id)
        then r.compensation_change else '{}'::jsonb end,
    'has_compensation_change', r.compensation_change <> '{}'::jsonb,
    'requested_by', r.requested_by, 'requested_at', r.requested_at
  ) order by r.requested_at), '[]'::jsonb) into v_result
  from public.employee_change_requests r
  join public.employees e on e.id = r.employee_id
  where r.status = 'PENDING'
    and app_private.has_permission('employee.approve', r.portfolio_id, r.company_id, r.branch_id)
    and app_private.has_permission('employee.view', r.portfolio_id, r.company_id, r.branch_id)
    and (r.compensation_change = '{}'::jsonb or app_private.has_permission('compensation.view', r.portfolio_id, r.company_id, r.branch_id));
  return v_result;
end;
$$;

create or replace function public.employee_change_request_review(p_request_id uuid, p_decision text, p_reason text default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_request public.employee_change_requests%rowtype;
  v_employee public.employees%rowtype;
  v_previous public.employee_compensation%rowtype;
  v_effective_from date;
begin
  if p_decision is null or p_decision not in ('APPROVE', 'RETURN', 'REJECT')
     or (p_decision <> 'APPROVE' and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A review decision and, when applicable, a reason are required.';
  end if;
  select * into v_request from public.employee_change_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' or v_request.requested_by = auth.uid()
     or not app_private.has_permission('employee.approve', v_request.portfolio_id, v_request.company_id, v_request.branch_id)
     or not app_private.has_permission('employee.view', v_request.portfolio_id, v_request.company_id, v_request.branch_id)
     or (v_request.employment_changes ? 'private_details' and not app_private.has_permission('employee.private.view', v_request.portfolio_id, v_request.company_id, v_request.branch_id))
     or (v_request.compensation_change <> '{}'::jsonb and not app_private.has_permission('compensation.view', v_request.portfolio_id, v_request.company_id, v_request.branch_id)) then
    raise exception using errcode = '42501', message = 'Employee change review is not authorized.';
  end if;
  select * into v_employee from public.employees where id = v_request.employee_id for update;
  if not found or v_employee.approval_status <> 'APPROVED' or v_employee.employment_status = 'TERMINATED' then
    raise exception using errcode = '55000', message = 'The employee is no longer eligible for this change.';
  end if;

  if p_decision = 'APPROVE' then
    if v_request.employment_changes ? 'private_details' then
      update public.employee_private_details set
        residential_address = case when (v_request.employment_changes #> '{private_details}') ? 'residential_address' then btrim(v_request.employment_changes #>> '{private_details,residential_address}') else residential_address end,
        phone = case when (v_request.employment_changes #> '{private_details}') ? 'phone' then btrim(v_request.employment_changes #>> '{private_details,phone}') else phone end,
        email = case when (v_request.employment_changes #> '{private_details}') ? 'email' then nullif(btrim(v_request.employment_changes #>> '{private_details,email}'), '') else email end,
        email_unavailable_reason = case
          when (v_request.employment_changes #> '{private_details}') ? 'email' then nullif(btrim(v_request.employment_changes #>> '{private_details,email_unavailable_reason}'), '')
          when (v_request.employment_changes #> '{private_details}') ? 'email_unavailable_reason' then nullif(btrim(v_request.employment_changes #>> '{private_details,email_unavailable_reason}'), '')
          else email_unavailable_reason end,
        emergency_contact_name = case when (v_request.employment_changes #> '{private_details}') ? 'emergency_contact_name' then btrim(v_request.employment_changes #>> '{private_details,emergency_contact_name}') else emergency_contact_name end,
        emergency_contact_relationship = case when (v_request.employment_changes #> '{private_details}') ? 'emergency_contact_relationship' then btrim(v_request.employment_changes #>> '{private_details,emergency_contact_relationship}') else emergency_contact_relationship end,
        emergency_contact_phone = case when (v_request.employment_changes #> '{private_details}') ? 'emergency_contact_phone' then btrim(v_request.employment_changes #>> '{private_details,emergency_contact_phone}') else emergency_contact_phone end,
        updated_at = now()
      where employee_id = v_employee.id;
      if not found then raise exception using errcode = '55000', message = 'Employee contact details are not available for correction.'; end if;
    end if;
    if v_request.employment_changes ?| array['first_name', 'middle_name', 'last_name', 'date_of_birth', 'gender', 'nationality'] then
      update public.employees set
        first_name = case when v_request.employment_changes ? 'first_name' then btrim(v_request.employment_changes ->> 'first_name') else first_name end,
        middle_name = case when v_request.employment_changes ? 'middle_name' then nullif(btrim(v_request.employment_changes ->> 'middle_name'), '') else middle_name end,
        last_name = case when v_request.employment_changes ? 'last_name' then btrim(v_request.employment_changes ->> 'last_name') else last_name end,
        date_of_birth = case when v_request.employment_changes ? 'date_of_birth' then (v_request.employment_changes ->> 'date_of_birth')::date else date_of_birth end,
        gender = case when v_request.employment_changes ? 'gender' then upper(v_request.employment_changes ->> 'gender') else gender end,
        nationality = case when v_request.employment_changes ? 'nationality' then btrim(v_request.employment_changes ->> 'nationality') else nationality end
      where id = v_employee.id;
    end if;
    if v_request.employment_changes ? 'job_title' then update public.employees set job_title = btrim(v_request.employment_changes ->> 'job_title') where id = v_employee.id; end if;
    if v_request.employment_changes ? 'department' then update public.employees set department = btrim(v_request.employment_changes ->> 'department') where id = v_employee.id; end if;
    if v_request.employment_changes ? 'employment_type' then update public.employees set employment_type = v_request.employment_changes ->> 'employment_type' where id = v_employee.id; end if;
    if v_request.employment_changes ? 'contract_type' then update public.employees set contract_type = nullif(btrim(v_request.employment_changes ->> 'contract_type'), '') where id = v_employee.id; end if;
    if v_request.employment_changes ? 'contract_start_date' then update public.employees set contract_start_date = (v_request.employment_changes ->> 'contract_start_date')::date where id = v_employee.id; end if;
    if v_request.employment_changes ? 'contract_end_date' then update public.employees set contract_end_date = nullif(v_request.employment_changes ->> 'contract_end_date', '')::date where id = v_employee.id; end if;
    if v_request.employment_changes <> '{}'::jsonb then update public.employees set updated_at = now() where id = v_employee.id; end if;

    if v_request.compensation_change <> '{}'::jsonb then
      v_effective_from := (v_request.compensation_change ->> 'effective_from')::date;
      select * into v_previous from public.employee_compensation where id = v_request.base_compensation_id for update;
      if not found or v_previous.employee_id <> v_employee.id or v_previous.effective_to is not null
         or exists (select 1 from public.employee_compensation ec where ec.employee_id = v_employee.id and ec.effective_from >= v_effective_from)
         or exists (
           select 1 from public.payroll_runs r join public.payroll_periods p on p.id = r.payroll_period_id
           where r.company_id = v_employee.company_id and r.branch_id = v_employee.workplace_branch_id
             and p.period_end >= v_effective_from and r.status not in ('CANCELED', 'REVERSED')
         ) then
        raise exception using errcode = '55000', message = 'Compensation or payroll history changed after this request; return it for review.';
      end if;
      update public.employee_compensation set effective_to = v_effective_from - 1 where id = v_previous.id;
      insert into public.employee_compensation(
        portfolio_id, company_id, workplace_branch_id, employee_id, effective_from, effective_to,
        salary_frequency, basic_pay, housing_allowance, meal_allowance, transport_allowance,
        other_allowances, overtime_eligible, allowance_tax_treatment, allowance_proration_rules, payment_method, created_by
      ) values (
        v_previous.portfolio_id, v_previous.company_id, v_previous.workplace_branch_id, v_previous.employee_id,
        v_effective_from, null,
        coalesce(v_request.compensation_change ->> 'salary_frequency', v_previous.salary_frequency),
        coalesce((v_request.compensation_change ->> 'basic_pay')::numeric, v_previous.basic_pay),
        coalesce((v_request.compensation_change ->> 'housing_allowance')::numeric, v_previous.housing_allowance),
        coalesce((v_request.compensation_change ->> 'meal_allowance')::numeric, v_previous.meal_allowance),
        coalesce((v_request.compensation_change ->> 'transport_allowance')::numeric, v_previous.transport_allowance),
        coalesce((v_request.compensation_change ->> 'other_allowances')::numeric, v_previous.other_allowances),
        coalesce((v_request.compensation_change ->> 'overtime_eligible')::boolean, v_previous.overtime_eligible),
        coalesce(v_request.compensation_change -> 'allowance_tax_treatment', v_previous.allowance_tax_treatment),
        coalesce(v_request.compensation_change -> 'allowance_proration_rules', v_previous.allowance_proration_rules),
        v_previous.payment_method, v_request.requested_by
      );
    end if;
    update public.employee_change_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = null where id = v_request.id;
  else
    update public.employee_change_requests set status = case when p_decision = 'RETURN' then 'RETURNED' else 'REJECTED' end,
      reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason) where id = v_request.id;
  end if;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_request.portfolio_id, v_request.company_id, v_request.branch_id, auth.uid(),
    'EMPLOYEE_CHANGE_' || p_decision, 'employees', v_request.employee_id::text,
    jsonb_build_object('request_id', v_request.id, 'employment_fields', (select coalesce(jsonb_agg(keys.key), '[]'::jsonb) from jsonb_object_keys(v_request.employment_changes) as keys(key)),
      'compensation_change', v_request.compensation_change <> '{}'::jsonb,
      'effective_from', nullif(v_request.compensation_change ->> 'effective_from', '')));
  return v_request.id;
end;
$$;

revoke all on function public.employee_change_request_create(uuid, jsonb, jsonb, text) from public, anon;
revoke all on function public.employee_change_capabilities(uuid) from public, anon;
revoke all on function public.employee_change_requests_list() from public, anon;
revoke all on function public.employee_change_request_review(uuid, text, text) from public, anon;
grant execute on function public.employee_change_request_create(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.employee_change_capabilities(uuid) to authenticated;
grant execute on function public.employee_change_requests_list() to authenticated;
grant execute on function public.employee_change_request_review(uuid, text, text) to authenticated;

comment on table public.employee_change_requests is 'Protected request payload for approved employee changes. Browser access is only through permission-checked RPCs.';
comment on function public.employee_change_request_review(uuid, text, text) is 'Applies approved changes only after a different employee.approve user reviews; salary changes create a new effective-dated compensation row.';


-- Preserve an explicitly selected allowance proration method when a new draft is created.
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
  end if;if (p_private_details ->> 'payment_method') is distinct from (p_compensation ->> 'payment_method') then
    raise exception using errcode = '22023', message = 'Employee and compensation payment methods must match.';
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
    other_allowances, overtime_eligible, allowance_proration_rules, payment_method, created_by
  ) values (
    v.portfolio_id, v.company_id, v.workplace_branch_id, v.id,
    (p_compensation ->> 'effective_from')::date, nullif(p_compensation ->> 'effective_to', '')::date,
    p_compensation ->> 'salary_frequency', (p_compensation ->> 'basic_pay')::numeric,
    coalesce(nullif(p_compensation ->> 'housing_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'meal_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'transport_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'other_allowances', '')::numeric, 0),
    coalesce((p_compensation ->> 'overtime_eligible')::boolean, false), coalesce(p_compensation -> 'allowance_proration_rules', '{}'::jsonb), v_payment_method, auth.uid()
  );
  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, v.id, auth.uid(), 'DRAFT_CREATED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, auth.uid(), 'EMPLOYEE_DRAFT_CREATED', 'employees', v.id::text);
  return v.id;
end $$;
