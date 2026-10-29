-- Safe edit/resubmission for employee drafts and HR-returned submissions.
-- Creator-scoped private details are returned only to the original authorized submitter.

alter table public.employee_approval_history
  drop constraint employee_approval_history_action_check,
  add constraint employee_approval_history_action_check
    check (action in ('DRAFT_CREATED', 'SUBMITTED', 'CORRECTED', 'APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION', 'RESUBMITTED'));

create or replace function public.employee_correction_details(p_employee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_private public.employee_private_details%rowtype;
  v_compensation public.employee_compensation%rowtype;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found or v_employee.created_by is distinct from auth.uid()
    or v_employee.approval_status not in ('DRAFT', 'RETURNED_FOR_CORRECTION')
    or not app_private.has_permission('employee.create', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employee correction details are not authorized.';
  end if;

  select * into strict v_private from public.employee_private_details where employee_id = v_employee.id;
  select * into strict v_compensation from public.employee_compensation
    where employee_id = v_employee.id order by effective_from desc, created_at desc limit 1;

  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, auth.uid(),
    'EMPLOYEE_CORRECTION_DETAILS_READ', 'employees', v_employee.id::text, '{"sensitive_payload_returned_to_creator":true}'::jsonb);

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'employee_number', v_employee.employee_number, 'first_name', v_employee.first_name,
      'middle_name', v_employee.middle_name, 'last_name', v_employee.last_name,
      'date_of_birth', v_employee.date_of_birth, 'gender', v_employee.gender,
      'nationality', v_employee.nationality, 'job_title', v_employee.job_title,
      'department', v_employee.department, 'employment_type', v_employee.employment_type,
      'contract_type', v_employee.contract_type, 'contract_start_date', v_employee.contract_start_date,
      'contract_end_date', v_employee.contract_end_date, 'retirement_age', v_employee.retirement_age
    ),
    'private_details', jsonb_build_object(
      'identity_document_type', v_private.identity_document_type,
      'identity_document_number', v_private.identity_document_number,
      'residential_address', v_private.residential_address, 'phone', v_private.phone,
      'email', v_private.email, 'email_unavailable_reason', v_private.email_unavailable_reason,
      'emergency_contact_name', v_private.emergency_contact_name,
      'emergency_contact_relationship', v_private.emergency_contact_relationship,
      'emergency_contact_phone', v_private.emergency_contact_phone, 'tpin', v_private.tpin,
      'napsa_number', v_private.napsa_number, 'nhima_number', v_private.nhima_number,
      'payment_method', v_private.payment_method, 'bank_name', v_private.bank_name,
      'bank_account_name', v_private.bank_account_name, 'bank_account_number', v_private.bank_account_number,
      'bank_branch_name', v_private.bank_branch_name, 'mobile_money_provider', v_private.mobile_money_provider,
      'mobile_money_number', v_private.mobile_money_number
    ),
    'compensation', jsonb_build_object(
      'effective_from', v_compensation.effective_from, 'effective_to', v_compensation.effective_to,
      'salary_frequency', v_compensation.salary_frequency, 'basic_pay', v_compensation.basic_pay,
      'housing_allowance', v_compensation.housing_allowance, 'meal_allowance', v_compensation.meal_allowance,
      'transport_allowance', v_compensation.transport_allowance, 'other_allowances', v_compensation.other_allowances,
      'overtime_eligible', v_compensation.overtime_eligible, 'payment_method', v_compensation.payment_method
    ),
    'company_id', v_employee.company_id, 'branch_id', v_employee.workplace_branch_id,
    'portfolio_id', v_employee.portfolio_id, 'approval_status', v_employee.approval_status
  );
end;
$$;

create or replace function public.employee_update_draft(
  p_employee_id uuid,
  p_employee jsonb,
  p_private_details jsonb,
  p_compensation jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_payment_method text;
  v_updated_rows integer;
begin
  if jsonb_typeof(p_employee) is distinct from 'object'
    or jsonb_typeof(p_private_details) is distinct from 'object'
    or jsonb_typeof(p_compensation) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Employee correction details are incomplete.';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found or v_employee.created_by is distinct from auth.uid()
    or v_employee.approval_status not in ('DRAFT', 'RETURNED_FOR_CORRECTION')
    or not app_private.has_permission('employee.create', v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employee correction is not authorized.';
  end if;
  if (p_private_details ->> 'payment_method') is distinct from (p_compensation ->> 'payment_method') then
    raise exception using errcode = '22023', message = 'Employee and compensation payment methods must match.';
  end if;

  update public.employees set
    employee_number = nullif(btrim(p_employee ->> 'employee_number'), ''),
    first_name = nullif(btrim(p_employee ->> 'first_name'), ''),
    middle_name = nullif(btrim(p_employee ->> 'middle_name'), ''),
    last_name = nullif(btrim(p_employee ->> 'last_name'), ''),
    date_of_birth = (p_employee ->> 'date_of_birth')::date,
    gender = nullif(p_employee ->> 'gender', ''),
    nationality = nullif(btrim(p_employee ->> 'nationality'), ''),
    job_title = nullif(btrim(p_employee ->> 'job_title'), ''),
    department = nullif(btrim(p_employee ->> 'department'), ''),
    employment_type = p_employee ->> 'employment_type',
    contract_type = nullif(btrim(p_employee ->> 'contract_type'), ''),
    contract_start_date = (p_employee ->> 'contract_start_date')::date,
    contract_end_date = nullif(p_employee ->> 'contract_end_date', '')::date,
    retirement_age = coalesce(nullif(p_employee ->> 'retirement_age', '')::integer, 65),
    updated_at = now()
  where id = v_employee.id;

  v_payment_method := p_private_details ->> 'payment_method';
  update public.employee_private_details set
    identity_document_type = nullif(p_private_details ->> 'identity_document_type', ''),
    identity_document_number = nullif(p_private_details ->> 'identity_document_number', ''),
    residential_address = nullif(btrim(p_private_details ->> 'residential_address'), ''),
    phone = nullif(btrim(p_private_details ->> 'phone'), ''),
    email = nullif(btrim(p_private_details ->> 'email'), ''),
    email_unavailable_reason = nullif(btrim(p_private_details ->> 'email_unavailable_reason'), ''),
    emergency_contact_name = nullif(btrim(p_private_details ->> 'emergency_contact_name'), ''),
    emergency_contact_relationship = nullif(btrim(p_private_details ->> 'emergency_contact_relationship'), ''),
    emergency_contact_phone = nullif(btrim(p_private_details ->> 'emergency_contact_phone'), ''),
    tpin = nullif(p_private_details ->> 'tpin', ''), napsa_number = nullif(p_private_details ->> 'napsa_number', ''),
    nhima_number = nullif(p_private_details ->> 'nhima_number', ''), payment_method = v_payment_method,
    bank_name = nullif(btrim(p_private_details ->> 'bank_name'), ''),
    bank_account_name = nullif(btrim(p_private_details ->> 'bank_account_name'), ''),
    bank_account_number = nullif(btrim(p_private_details ->> 'bank_account_number'), ''),
    bank_branch_name = nullif(btrim(p_private_details ->> 'bank_branch_name'), ''),
    mobile_money_provider = nullif(btrim(p_private_details ->> 'mobile_money_provider'), ''),
    mobile_money_number = nullif(btrim(p_private_details ->> 'mobile_money_number'), ''),
    updated_at = now()
  where employee_id = v_employee.id;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception using errcode = '23503', message = 'Employee private details are missing; correction was not saved.';
  end if;

  update public.employee_compensation set
    effective_from = (p_compensation ->> 'effective_from')::date,
    effective_to = nullif(p_compensation ->> 'effective_to', '')::date,
    salary_frequency = p_compensation ->> 'salary_frequency',
    basic_pay = (p_compensation ->> 'basic_pay')::numeric,
    housing_allowance = coalesce(nullif(p_compensation ->> 'housing_allowance', '')::numeric, 0),
    meal_allowance = coalesce(nullif(p_compensation ->> 'meal_allowance', '')::numeric, 0),
    transport_allowance = coalesce(nullif(p_compensation ->> 'transport_allowance', '')::numeric, 0),
    other_allowances = coalesce(nullif(p_compensation ->> 'other_allowances', '')::numeric, 0),
    overtime_eligible = coalesce((p_compensation ->> 'overtime_eligible')::boolean, false),
    payment_method = v_payment_method
  where employee_id = v_employee.id and id = (
    select ec.id from public.employee_compensation ec where ec.employee_id = v_employee.id
    order by ec.effective_from desc, ec.created_at desc limit 1
  );
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception using errcode = '23503', message = 'Employee compensation is missing; correction was not saved.';
  end if;

  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, v_employee.id, auth.uid(), 'CORRECTED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_employee.portfolio_id, v_employee.company_id, v_employee.workplace_branch_id, auth.uid(), 'EMPLOYEE_CORRECTED', 'employees', v_employee.id::text,
    jsonb_build_object('sensitive_values_omitted', true, 'approval_status', v_employee.approval_status));
  return v_employee.id;
end;
$$;

revoke all on function public.employee_correction_details(uuid) from public, anon;
revoke all on function public.employee_update_draft(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.employee_correction_details(uuid) to authenticated;
grant execute on function public.employee_update_draft(uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.employee_correction_details(uuid) is
  'Returns sensitive draft/returned employee details only to the original creator while employee.create access remains active; read is audited.';
comment on function public.employee_update_draft(uuid, jsonb, jsonb, jsonb) is
  'Updates a creator-owned DRAFT or RETURNED_FOR_CORRECTION record atomically and records a correction audit event; it does not change status or resubmit.';

