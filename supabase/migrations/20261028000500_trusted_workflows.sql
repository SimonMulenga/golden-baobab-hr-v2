-- M5 workflow checkpoint: server-owned actor identity, tenant checks, immutable
-- transition history, row locks, and deduction posting inside payroll finalization.
alter table public.payroll_runs add column reviewed_version integer;

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
  if (p_private_details ->> 'payment_method') is distinct from (p_compensation ->> 'payment_method') then
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
    other_allowances, overtime_eligible, payment_method, created_by
  ) values (
    v.portfolio_id, v.company_id, v.workplace_branch_id, v.id,
    (p_compensation ->> 'effective_from')::date, nullif(p_compensation ->> 'effective_to', '')::date,
    p_compensation ->> 'salary_frequency', (p_compensation ->> 'basic_pay')::numeric,
    coalesce(nullif(p_compensation ->> 'housing_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'meal_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'transport_allowance', '')::numeric, 0),
    coalesce(nullif(p_compensation ->> 'other_allowances', '')::numeric, 0),
    coalesce((p_compensation ->> 'overtime_eligible')::boolean, false), v_payment_method, auth.uid()
  );
  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, v.id, auth.uid(), 'DRAFT_CREATED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, auth.uid(), 'EMPLOYEE_DRAFT_CREATED', 'employees', v.id::text);
  return v.id;
end $$;

create or replace function public.deduction_create_request(
  p_portfolio_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_employee_id uuid,
  p_idempotency_key text,
  p_details jsonb,
  p_schedule jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_deduction public.employee_deductions%rowtype;
  v_employee public.employees%rowtype;
  v_schedule_total numeric(14,2);
  v_entry jsonb;
  v_sequence integer := 0;
  v_count integer;
  v_principal_cents bigint;
  v_installment_cents bigint;
  v_amount_cents bigint;
  v_due_period date;
begin
  if jsonb_typeof(p_details) is distinct from 'object' or nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A complete repayment schedule and request key are required.';
  end if;
  if p_details ->> 'repayment_method' = 'MANUAL_SCHEDULE' then
    if jsonb_typeof(p_schedule) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Manual repayments must be provided as a schedule array.';
    end if;
    if jsonb_array_length(p_schedule) = 0 then
      raise exception using errcode = '22023', message = 'A manual repayment schedule cannot be empty.';
    end if;
  end if;
  if not app_private.has_permission('deduction.create', p_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Deduction creation is not authorized.';
  end if;
  select * into v_employee from public.employees
  where id = p_employee_id and portfolio_id = p_portfolio_id and company_id = p_company_id
    and workplace_branch_id = p_branch_id and approval_status = 'APPROVED';
  if not found then raise exception using errcode = '22023', message = 'Only an approved employee in the assigned branch may receive a deduction.'; end if;

  insert into public.employee_deductions(
    portfolio_id, company_id, branch_id, employee_id, deduction_type, principal_amount,
    repayment_method, requested_installments, fixed_installment_amount, start_period,
    installment_frequency, status, initiated_by,
    idempotency_key, reason, consent_reference
  ) values (
    p_portfolio_id, p_company_id, p_branch_id, p_employee_id,
    p_details ->> 'deduction_type', (p_details ->> 'principal_amount')::numeric,
    p_details ->> 'repayment_method', nullif(p_details ->> 'requested_installments', '')::integer,
    nullif(p_details ->> 'fixed_installment_amount', '')::numeric, (p_details ->> 'start_period')::date,
    coalesce(p_details ->> 'installment_frequency', 'MONTHLY'), 'SUBMITTED', auth.uid(),
    btrim(p_idempotency_key), nullif(btrim(p_details ->> 'reason'), ''),
    nullif(btrim(p_details ->> 'consent_reference'), '')
  ) returning * into v_deduction;

  v_principal_cents := round(v_deduction.principal_amount * 100)::bigint;
  if v_deduction.repayment_method = 'ONE_TIME' then
    v_count := 1;
    v_installment_cents := v_principal_cents;
  elsif v_deduction.repayment_method = 'EQUAL_INSTALLMENTS' then
    v_count := v_deduction.requested_installments;
    if v_count is null or v_count < 1 or v_count > 6000 or v_principal_cents < v_count then
      raise exception using errcode = '22023', message = 'Installment count must produce positive cent amounts and remain within the supported schedule size.';
    end if;
    v_installment_cents := v_principal_cents / v_count;
  elsif v_deduction.repayment_method = 'FIXED_RECURRING' then
    v_installment_cents := round(v_deduction.fixed_installment_amount * 100)::bigint;
    if v_installment_cents < 1 then
      raise exception using errcode = '22023', message = 'Recurring installment must be at least one ngwee.';
    end if;
    v_count := ceil(v_principal_cents::numeric / v_installment_cents)::integer;
    if v_count > 6000 then
      raise exception using errcode = '22023', message = 'Repayment schedule exceeds the supported period count.';
    end if;
  else
    v_count := jsonb_array_length(p_schedule);
    if v_count > 6000 then
      raise exception using errcode = '22023', message = 'Repayment schedule exceeds the supported period count.';
    end if;
  end if;

  if v_deduction.repayment_method = 'MANUAL_SCHEDULE' then
    for v_entry in select value from jsonb_array_elements(p_schedule) loop
      v_sequence := coalesce(nullif(v_entry ->> 'sequence_number', '')::integer, v_sequence + 1);
      v_due_period := (v_entry ->> 'due_period')::date;
      if v_due_period < v_deduction.start_period then
        raise exception using errcode = '22023', message = 'Repayment cannot be scheduled before its start period.';
      end if;
      insert into public.deduction_installments(
        portfolio_id, company_id, branch_id, employee_id, deduction_id,
        sequence_number, due_period, scheduled_amount
      ) values (
        p_portfolio_id, p_company_id, p_branch_id, p_employee_id, v_deduction.id,
        v_sequence, v_due_period, (v_entry ->> 'scheduled_amount')::numeric
      );
    end loop;
  else
    for v_sequence in 1..v_count loop
      v_amount_cents := case
        when v_deduction.repayment_method = 'EQUAL_INSTALLMENTS' and v_sequence = v_count
          then v_principal_cents - (v_installment_cents * (v_count - 1))
        when v_deduction.repayment_method = 'FIXED_RECURRING'
          then least(v_installment_cents, v_principal_cents - (v_installment_cents * (v_sequence - 1)))
        else v_installment_cents
      end;
      v_due_period := case v_deduction.installment_frequency
        when 'WEEKLY' then v_deduction.start_period + (7 * (v_sequence - 1))
        when 'FORTNIGHTLY' then v_deduction.start_period + (14 * (v_sequence - 1))
        else (v_deduction.start_period + make_interval(months => (v_sequence - 1)))::date
      end;
      insert into public.deduction_installments(
        portfolio_id, company_id, branch_id, employee_id, deduction_id,
        sequence_number, due_period, scheduled_amount
      ) values (
        p_portfolio_id, p_company_id, p_branch_id, p_employee_id, v_deduction.id,
        v_sequence, v_due_period, v_amount_cents::numeric / 100
      );
    end loop;
  end if;
  select sum(scheduled_amount) into v_schedule_total
  from public.deduction_installments where deduction_id = v_deduction.id;
  if v_schedule_total <> v_deduction.principal_amount then
    raise exception using errcode = '22023', message = 'Repayment schedule must exactly equal the requested principal.';
  end if;
  insert into public.deduction_approval_history(portfolio_id, company_id, branch_id, deduction_id, actor_id, action)
  values (p_portfolio_id, p_company_id, p_branch_id, v_deduction.id, auth.uid(), 'SUBMITTED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values (p_portfolio_id, p_company_id, p_branch_id, auth.uid(), 'DEDUCTION_SUBMITTED', 'deductions', v_deduction.id::text);
  return v_deduction.id;
end $$;

create or replace function public.employee_submit_for_hr_approval(p_employee_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.employees%rowtype;
begin
  select * into v from public.employees where id = p_employee_id for update;
  if not found or v.created_by <> auth.uid()
    or not app_private.has_permission('employee.submit', v.portfolio_id, v.company_id, v.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employee submission is not authorized.';
  end if;
  if v.approval_status not in ('DRAFT', 'RETURNED_FOR_CORRECTION', 'REJECTED') then
    raise exception using errcode = '22023', message = 'Employee record is not eligible for submission.';
  end if;
  update public.employees set approval_status = 'SUBMITTED_FOR_HR_APPROVAL', submitted_at = now(),
    reviewed_by = null, reviewed_at = null, updated_at = now() where id = v.id;
  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, v.id, auth.uid(),
    case when v.approval_status = 'DRAFT' then 'SUBMITTED' else 'RESUBMITTED' end);
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, auth.uid(), 'EMPLOYEE_SUBMITTED', 'employees', v.id::text);
  return v.id;
end $$;

create or replace function public.employee_review_submission(p_employee_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.employees%rowtype; v_status text;
begin
  if p_decision is null or p_decision not in ('APPROVE', 'REJECT', 'RETURN')
    or (p_decision in ('REJECT', 'RETURN') and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid decision and reason are required.';
  end if;
  select * into v from public.employees where id = p_employee_id for update;
  if not found or v.approval_status <> 'SUBMITTED_FOR_HR_APPROVAL' or v.created_by = auth.uid()
    or not app_private.has_permission(case when p_decision = 'APPROVE' then 'employee.approve' else 'employee.reject' end,
      v.portfolio_id, v.company_id, v.workplace_branch_id) then
    raise exception using errcode = '42501', message = 'Employee review is not authorized.';
  end if;
  v_status := case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED_FOR_CORRECTION' end;
  update public.employees set approval_status = v_status, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = v.id;
  insert into public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, actor_id, action, reason)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, v.id, auth.uid(), v_status, nullif(btrim(p_reason), ''));
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.workplace_branch_id, auth.uid(), 'EMPLOYEE_' || v_status, 'employees', v.id::text,
    jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  return v.id;
end $$;

create or replace function public.deduction_review_request(p_deduction_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.employee_deductions%rowtype; v_scheduled numeric(14,2);
begin
  if p_decision is null or p_decision not in ('APPROVE', 'REJECT')
    or (p_decision = 'REJECT' and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid decision and reason are required.';
  end if;
  select * into v from public.employee_deductions where id = p_deduction_id for update;
  if not found or v.status <> 'SUBMITTED' or v.initiated_by = auth.uid()
    or not app_private.has_permission('deduction.approve', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode = '42501', message = 'Deduction review is not authorized.';
  end if;
  select coalesce(sum(scheduled_amount), 0) into v_scheduled
  from public.deduction_installments where deduction_id = v.id;
  if p_decision = 'APPROVE' and (v_scheduled <> v.principal_amount or v_scheduled = 0) then
    raise exception using errcode = '22023', message = 'Deduction schedule must equal the approved principal.';
  end if;
  update public.employee_deductions set
    status = case when p_decision = 'APPROVE' then 'ACTIVE' else 'REJECTED' end,
    approved_by = case when p_decision = 'APPROVE' then auth.uid() else null end,
    approved_at = case when p_decision = 'APPROVE' then now() else null end,
    reason = case when p_decision = 'REJECT' then reason || ' | Rejected: ' || btrim(p_reason) else reason end,
    updated_at = now() where id = v.id;
  insert into public.deduction_approval_history(portfolio_id, company_id, branch_id, deduction_id, actor_id, action, reason)
  values (v.portfolio_id, v.company_id, v.branch_id, v.id, auth.uid(),
    case when p_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end, nullif(btrim(p_reason), ''));
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'DEDUCTION_' || p_decision, 'deductions', v.id::text,
    jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  return v.id;
end $$;

create or replace function public.payroll_submit_for_approval(p_payroll_run_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.payroll_runs%rowtype;
begin
  select * into v from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or v.created_by <> auth.uid()
    or not app_private.has_permission('payroll.submit', v.portfolio_id, v.company_id, v.branch_id)
    or v.status not in ('CALCULATED', 'RETURNED_FOR_CORRECTION') then
    raise exception using errcode = '42501', message = 'Payroll submission is not authorized.';
  end if;
  if exists (
    select 1 from public.payroll_run_items i
    join public.employees e on e.id = i.employee_id and e.portfolio_id = i.portfolio_id
      and e.company_id = i.company_id and e.workplace_branch_id = i.branch_id
    where i.payroll_run_id = v.id and i.version = v.version and e.approval_status <> 'APPROVED'
  ) then
    raise exception using errcode = '22023', message = 'Payroll includes an employee who has not been approved.';
  end if;
  update public.payroll_runs set status = 'SUBMITTED_FOR_APPROVAL', submitted_at = now(),
    reviewed_by = null, reviewed_at = null, approved_version = null, updated_at = now() where id = v.id;
  insert into public.payroll_approvals(portfolio_id, company_id, branch_id, payroll_run_id, payroll_version, actor_id, action)
  values (v.portfolio_id, v.company_id, v.branch_id, v.id, v.version, auth.uid(), 'SUBMITTED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'PAYROLL_SUBMITTED', 'payroll', v.id::text,
    jsonb_build_object('version', v.version));
  return v.id;
end $$;

create or replace function public.payroll_review_submission(
  p_payroll_run_id uuid, p_action text, p_expected_version integer, p_reason text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.payroll_runs%rowtype; v_status text; v_event text;
begin
  if p_action is null or p_action not in ('START_REVIEW', 'APPROVE', 'RETURN', 'REJECT')
    or (p_action in ('RETURN', 'REJECT') and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid action and reason are required.';
  end if;
  select * into v from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or v.created_by = auth.uid() or p_expected_version is null or v.version <> p_expected_version then
    raise exception using errcode = '42501', message = 'Payroll review is not authorized for this version.';
  end if;
  if p_action = 'START_REVIEW' then
    if v.status <> 'SUBMITTED_FOR_APPROVAL'
      or not app_private.has_permission('payroll.review', v.portfolio_id, v.company_id, v.branch_id) then
      raise exception using errcode = '42501', message = 'Payroll review is not authorized.';
    end if;
    v_status := 'UNDER_REVIEW'; v_event := 'REVIEW_STARTED';
  else
    if v.status <> 'UNDER_REVIEW'
      or not app_private.has_permission('payroll.approve', v.portfolio_id, v.company_id, v.branch_id) then
      raise exception using errcode = '42501', message = 'Payroll decision is not authorized.';
    end if;
    v_status := case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED_FOR_CORRECTION' end;
    v_event := case p_action when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end;
  end if;
  update public.payroll_runs set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(),
    reviewed_version = v.version, approved_version = case when p_action = 'APPROVE' then v.version else null end,
    updated_at = now() where id = v.id;
  insert into public.payroll_approvals(portfolio_id, company_id, branch_id, payroll_run_id, payroll_version, actor_id, action, reason)
  values (v.portfolio_id, v.company_id, v.branch_id, v.id, v.version, auth.uid(), v_event, nullif(btrim(p_reason), ''));
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'PAYROLL_' || p_action, 'payroll', v.id::text,
    jsonb_build_object('version', v.version, 'reason', nullif(btrim(p_reason), '')));
  return v.id;
end $$;

create or replace function public.payroll_finalize(p_payroll_run_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype;
  v_payment record;
  v_key text;
begin
  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or not app_private.has_permission('payroll.finalize', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Payroll finalization is not authorized.';
  end if;
  if v_run.status = 'FINALIZED' then return v_run.id; end if;
  if v_run.status <> 'APPROVED' or v_run.approved_version is distinct from v_run.version then
    raise exception using errcode = '42501', message = 'Only the approved payroll version can be finalized.';
  end if;
  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id
    and portfolio_id = v_run.portfolio_id and company_id = v_run.company_id and branch_id = v_run.branch_id;
  if not found or not exists (
    select 1 from public.payroll_run_statutory_rules prs where prs.payroll_run_id = v_run.id
  ) or exists (
    select 1 from public.payroll_run_statutory_rules prs
    left join public.statutory_rule_versions sr on sr.id = prs.statutory_rule_version_id
    where sr.id is null or not sr.active or sr.verified_at is null or sr.verified_by is null
      or sr.effective_from > v_period.period_end
      or (sr.effective_to is not null and sr.effective_to < v_period.period_start)
  ) or exists (
    select required.rule_code
    from (values ('PAYE'), ('NAPSA'), ('NHIMA')) as required(rule_code)
    except
    select sr.rule_code
    from public.payroll_run_statutory_rules prs
    join public.statutory_rule_versions sr on sr.id = prs.statutory_rule_version_id
    where prs.payroll_run_id = v_run.id and sr.jurisdiction = 'ZM' and sr.active and sr.verified_at is not null and sr.verified_by is not null
      and sr.effective_from <= v_period.period_end
      and (sr.effective_to is null or sr.effective_to >= v_period.period_start)
  ) then
    raise exception using errcode = '22023', message = 'Payroll cannot be finalized because verified effective statutory rules are unavailable.';
  end if;
  if exists (
    select 1 from public.payroll_run_items i
    join public.employees e on e.id = i.employee_id and e.portfolio_id = i.portfolio_id
      and e.company_id = i.company_id and e.workplace_branch_id = i.branch_id
    where i.payroll_run_id = v_run.id and i.version = v_run.version and e.approval_status <> 'APPROVED'
  ) then
    raise exception using errcode = '22023', message = 'Payroll includes an employee who has not been approved.';
  end if;
  if exists (
    select 1 from public.payroll_run_items i
    where i.payroll_run_id = v_run.id and i.version = v_run.version
      and i.voluntary_deductions <> coalesce((
        select sum(pid.amount) from public.payroll_item_deductions pid
        where pid.payroll_run_id = i.payroll_run_id and pid.employee_id = i.employee_id and pid.version = i.version
      ), 0)
  ) then
    raise exception using errcode = '22023', message = 'Payroll deductions do not match the approved repayment schedule.';
  end if;
  if exists (
    select 1
    from public.payroll_item_deductions pid
    join public.deduction_installments di on di.id = pid.installment_id and di.deduction_id = pid.deduction_id
    join public.employee_deductions d on d.id = pid.deduction_id
    where pid.payroll_run_id = v_run.id and pid.version = v_run.version
      and (d.status <> 'ACTIVE' or di.due_period not between v_period.period_start and v_period.period_end
        or pid.amount > di.scheduled_amount or pid.amount > d.principal_amount - d.amount_deducted)
  ) then
    raise exception using errcode = '22023', message = 'Payroll contains a deduction that is not currently due or exceeds its approved balance.';
  end if;

  -- Row locks plus unique transaction keys serialize and deduplicate repayment posting.
  perform d.id from public.employee_deductions d
  join public.payroll_item_deductions pid on pid.deduction_id = d.id
  where pid.payroll_run_id = v_run.id and pid.version = v_run.version order by d.id for update of d;

  for v_payment in
    select d.id deduction_id, d.portfolio_id, d.company_id, d.branch_id, di.employee_id, d.principal_amount,
      d.amount_deducted, d.status, di.id installment_id, di.scheduled_amount, pid.amount
    from public.payroll_item_deductions pid
    join public.deduction_installments di on di.id = pid.installment_id and di.deduction_id = pid.deduction_id
    join public.employee_deductions d on d.id = pid.deduction_id
    where pid.payroll_run_id = v_run.id and pid.version = v_run.version
      and d.status = 'ACTIVE' and di.due_period between v_period.period_start and v_period.period_end
    order by d.id, di.sequence_number
  loop
    if v_payment.amount > v_payment.scheduled_amount
      or v_payment.amount > v_payment.principal_amount - v_payment.amount_deducted then
      raise exception using errcode = '22023', message = 'Repayment exceeds scheduled amount or outstanding balance.';
    end if;
    v_key := v_run.id::text || ':' || v_payment.installment_id::text || ':PAYROLL_REPAYMENT';
    insert into public.deduction_transactions(
      portfolio_id, company_id, branch_id, employee_id, deduction_id, installment_id, payroll_run_id,
      amount, transaction_type, idempotency_key, posted_by
    ) values (
      v_payment.portfolio_id, v_payment.company_id, v_payment.branch_id, v_payment.employee_id, v_payment.deduction_id,
      v_payment.installment_id, v_run.id, v_payment.amount, 'PAYROLL_REPAYMENT', v_key, auth.uid()
    );
    update public.employee_deductions set amount_deducted = amount_deducted + v_payment.amount,
      status = case when amount_deducted + v_payment.amount = principal_amount then 'COMPLETED' else 'ACTIVE' end,
      updated_at = now() where id = v_payment.deduction_id;
  end loop;

  update public.payroll_runs set status = 'FINALIZED', finalized_at = now(), updated_at = now() where id = v_run.id;
  insert into public.payroll_approvals(portfolio_id, company_id, branch_id, payroll_run_id, payroll_version, actor_id, action)
  values (v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, v_run.version, auth.uid(), 'FINALIZED');
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_run.portfolio_id, v_run.company_id, v_run.branch_id, auth.uid(), 'PAYROLL_FINALIZED', 'payroll', v_run.id::text,
    jsonb_build_object('version', v_run.version, 'deduction_transactions',
      (select count(*) from public.deduction_transactions where payroll_run_id = v_run.id)));
  return v_run.id;
end $$;

revoke all on function public.employee_create_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.deduction_create_request(uuid, uuid, uuid, uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.employee_submit_for_hr_approval(uuid) from public, anon;
revoke all on function public.employee_review_submission(uuid, text, text) from public, anon;
revoke all on function public.deduction_review_request(uuid, text, text) from public, anon;
revoke all on function public.payroll_submit_for_approval(uuid) from public, anon;
revoke all on function public.payroll_review_submission(uuid, text, integer, text) from public, anon;
revoke all on function public.payroll_finalize(uuid) from public, anon;
grant execute on function public.employee_submit_for_hr_approval(uuid) to authenticated;
grant execute on function public.employee_create_draft(uuid, uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.deduction_create_request(uuid, uuid, uuid, uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.employee_review_submission(uuid, text, text) to authenticated;
grant execute on function public.deduction_review_request(uuid, text, text) to authenticated;
grant execute on function public.payroll_submit_for_approval(uuid) to authenticated;
grant execute on function public.payroll_review_submission(uuid, text, integer, text) to authenticated;
grant execute on function public.payroll_finalize(uuid) to authenticated;

comment on function public.payroll_finalize(uuid) is 'Atomic, idempotent finalization with one-time repayment posting; requires verified effective statutory rules.';


