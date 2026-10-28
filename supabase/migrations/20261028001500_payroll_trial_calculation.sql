-- Persisted, trusted payroll trial calculation.
-- This is deliberately non-payable: NAPSA 2026 application details and the
-- NHIMA earnings base are unresolved. It never writes payroll_run_items,
-- changes a payroll_run status, or enables submit/approval/finalization.

create table public.payroll_trial_calculations (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  status text not null default 'TRIAL_ONLY' check (status = 'TRIAL_ONLY'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, idempotency_key),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict
);

create index payroll_trial_calculations_scope_idx
  on public.payroll_trial_calculations(portfolio_id, company_id, branch_id, payroll_run_id, created_at desc);

alter table public.payroll_trial_calculations enable row level security;
revoke all on table public.payroll_trial_calculations from public, anon, authenticated;
grant select on table public.payroll_trial_calculations to authenticated;
create policy payroll_trial_calculations_read_authorized on public.payroll_trial_calculations
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );

create or replace function public.payroll_calculate_trial(
  p_payroll_run_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype;
  v_existing public.payroll_trial_calculations%rowtype;
  v_inputs jsonb;
  v_employee jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_item_blockers jsonb;
  v_global_blockers jsonb := jsonb_build_array(
    'NAPSA_2026_CONFIGURATION_UNVERIFIED',
    'NHIMA_CONTRIBUTION_BASE_UNRESOLVED',
    'BONUS_AND_COMMISSION_INPUTS_NOT_CONNECTED',
    'TRIAL_CANNOT_BE_SUBMITTED_OR_FINALIZED'
  );
  v_snapshot jsonb;
  v_employee_id uuid;
  v_employee_number text;
  v_frequency text;
  v_basic numeric(14,2);
  v_housing numeric(14,2);
  v_meal numeric(14,2);
  v_transport numeric(14,2);
  v_other numeric(14,2);
  v_gross numeric(14,2);
  v_paye numeric(14,2);
  v_napsa_base numeric(14,2);
  v_napsa_employee numeric(14,2);
  v_napsa_employer numeric(14,2);
  v_nhima_employee_base numeric(14,2);
  v_nhima_employer_base numeric(14,2);
  v_nhima_employee numeric(14,2);
  v_nhima_employer numeric(14,2);
  v_other_deductions numeric(14,2);
  v_candidate_net numeric(14,2);
  v_total_gross numeric(14,2) := 0;
  v_total_paye numeric(14,2) := 0;
  v_total_napsa_employee numeric(14,2) := 0;
  v_total_napsa_employer numeric(14,2) := 0;
  v_total_nhima_employee numeric(14,2) := 0;
  v_total_nhima_employer numeric(14,2) := 0;
  v_total_other_deductions numeric(14,2) := 0;
  v_total_candidate_net numeric(14,2) := 0;
  v_covering_comp_count integer;
  v_attempt uuid;
  v_key text;
begin
  if auth.uid() is null or p_payroll_run_id is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 12
    or length(p_idempotency_key) > 120 then
    raise exception using errcode = '22023', message = 'A valid payroll run and idempotency key are required.';
  end if;

  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or v_run.created_by <> auth.uid()
    or not app_private.has_permission('payroll.prepare', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Payroll trial calculation is not authorized.';
  end if;

  select * into v_existing from public.payroll_trial_calculations
  where payroll_run_id = v_run.id and idempotency_key = btrim(p_idempotency_key);
  if found then return v_existing.snapshot; end if;

  if v_run.status not in ('DRAFT', 'RETURNED_FOR_CORRECTION') then
    raise exception using errcode = '22023', message = 'Only a draft or returned payroll run can be trial-calculated.';
  end if;
  select * into v_period from public.payroll_periods
  where id = v_run.payroll_period_id and portfolio_id = v_run.portfolio_id
    and company_id = v_run.company_id and branch_id = v_run.branch_id;
  if not found then
    raise exception using errcode = '22023', message = 'Payroll period was not found for this run.';
  end if;

  v_inputs := public.payroll_preview_inputs(v_run.company_id, v_run.branch_id, v_period.period_start, v_period.period_end);
  for v_employee in select value from jsonb_array_elements(coalesce(v_inputs->'items', '[]'::jsonb)) loop
    v_employee_id := nullif(v_employee->>'employee_id', '')::uuid;
    v_employee_number := v_employee->>'employee_number';
    v_frequency := v_employee->>'salary_frequency';
    v_item_blockers := coalesce(v_employee->'input_warnings', '[]'::jsonb);

    if v_frequency is distinct from 'MONTHLY' and not (v_item_blockers ? 'NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE') then
      v_item_blockers := v_item_blockers || jsonb_build_array('NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE');
    end if;
    if coalesce((v_employee->>'overtime_eligible')::boolean, false) then
      v_item_blockers := v_item_blockers || jsonb_build_array('OVERTIME_ENTRY_SOURCE_NOT_CONNECTED');
    end if;
    if coalesce((v_employee #>> '{attendance,unpaid_leave_days}')::numeric, 0) > 0 then
      v_item_blockers := v_item_blockers || jsonb_build_array('UNPAID_LEAVE_FORMULA_REQUIRES_APPROVED_CONTRACT_RULE');
    end if;

    select count(*) into v_covering_comp_count
    from public.employee_compensation ec
    where ec.employee_id = v_employee_id and ec.portfolio_id = v_run.portfolio_id
      and ec.company_id = v_run.company_id
      and ec.effective_from <= v_period.period_start
      and (ec.effective_to is null or ec.effective_to >= v_period.period_end);
    if v_covering_comp_count <> 1 then
      v_item_blockers := v_item_blockers || jsonb_build_array('COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD');
    end if;

    if v_employee->>'basic_pay' is null or v_employee->>'salary_frequency' is null
      or v_frequency is distinct from 'MONTHLY'
      or v_item_blockers ? 'MISSING_EFFECTIVE_COMPENSATION'
      or v_item_blockers ? 'MISSING_APPROVED_ATTENDANCE_ENTRY'
      or v_covering_comp_count <> 1 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'employee_id', v_employee_id, 'employee_number', v_employee_number,
        'employee_name', v_employee->>'employee_name', 'calculable', false,
        'blockers', v_item_blockers, 'basic_pay', null, 'gross_pay', null,
        'paye_candidate', null, 'napsa_employee_candidate', null,
        'nhima_employee_candidate', null, 'approved_other_deductions', null,
        'candidate_net_pay', null
      ));
      continue;
    end if;

    v_basic := round((v_employee->>'basic_pay')::numeric, 2);
    v_housing := round(coalesce((v_employee->>'housing_allowance')::numeric, 0), 2);
    v_meal := round(coalesce((v_employee->>'meal_allowance')::numeric, 0), 2);
    v_transport := round(coalesce((v_employee->>'transport_allowance')::numeric, 0), 2);
    v_other := round(coalesce((v_employee->>'other_allowances')::numeric, 0), 2);
    v_gross := round(v_basic + v_housing + v_meal + v_transport + v_other, 2);

    -- ZRA's published 2026 ordinary monthly PAYE bands; cash allowances are
    -- included as emoluments. NAPSA contributions are not deducted first.
    if extract(year from v_period.period_start) = 2026 then
      v_paye := round(
        greatest(0, least(v_gross, 7100) - 5100) * 0.20
        + greatest(0, least(v_gross, 9200) - 7100) * 0.30
        + greatest(0, v_gross - 9200) * 0.37, 2);
    else
      v_paye := null;
      v_item_blockers := v_item_blockers || jsonb_build_array('PAYE_RULE_VERSION_NOT_CONFIGURED_FOR_PERIOD');
    end if;

    -- Explicit candidate-only scenarios from current regulator pages; never
    -- treat these as verified 2026 statutory amounts or final payroll values.
    v_napsa_base := least(v_gross, 28920.30);
    v_napsa_employee := round(v_napsa_base * 0.05, 2);
    v_napsa_employer := round(v_napsa_base * 0.05, 2);
    v_nhima_employee_base := v_gross; -- FAQ's employee "declared income" candidate.
    v_nhima_employer_base := v_basic; -- FAQ's employer basic salary candidate.
    v_nhima_employee := round(v_nhima_employee_base * 0.01, 2);
    v_nhima_employer := round(v_nhima_employer_base * 0.01, 2);
    select round(coalesce(sum((value->>'scheduled_amount')::numeric), 0), 2)
      into v_other_deductions
      from jsonb_array_elements(coalesce(v_employee->'due_approved_deductions', '[]'::jsonb));

    v_candidate_net := round(v_gross - coalesce(v_paye, 0) - v_napsa_employee - v_nhima_employee - v_other_deductions, 2);
    if v_candidate_net < 0 then
      v_candidate_net := null;
      v_item_blockers := v_item_blockers || jsonb_build_array('CANDIDATE_DEDUCTIONS_EXCEED_GROSS_PAY');
    end if;

    v_total_gross := v_total_gross + v_gross;
    v_total_paye := v_total_paye + coalesce(v_paye, 0);
    v_total_napsa_employee := v_total_napsa_employee + v_napsa_employee;
    v_total_napsa_employer := v_total_napsa_employer + v_napsa_employer;
    v_total_nhima_employee := v_total_nhima_employee + v_nhima_employee;
    v_total_nhima_employer := v_total_nhima_employer + v_nhima_employer;
    v_total_other_deductions := v_total_other_deductions + v_other_deductions;
    v_total_candidate_net := v_total_candidate_net + coalesce(v_candidate_net, 0);

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'employee_id', v_employee_id, 'employee_number', v_employee_number,
      'employee_name', v_employee->>'employee_name', 'salary_frequency', v_frequency,
      'calculable', jsonb_array_length(v_item_blockers) = 0,
      'blockers', v_item_blockers,
      'basic_pay', v_basic,
      'housing_allowance', v_housing, 'meal_allowance', v_meal,
      'transport_allowance', v_transport, 'other_allowances', v_other,
      'overtime', 0, 'gross_pay', v_gross,
      'paye_taxable_income_candidate', v_gross, 'paye_candidate', v_paye,
      'napsa_pensionable_base_candidate', v_napsa_base,
      'napsa_employee_candidate', v_napsa_employee, 'napsa_employer_candidate', v_napsa_employer,
      'nhima_employee_base_candidate', v_nhima_employee_base,
      'nhima_employer_base_candidate', v_nhima_employer_base,
      'nhima_employee_candidate', v_nhima_employee, 'nhima_employer_candidate', v_nhima_employer,
      'approved_other_deductions', v_other_deductions, 'candidate_net_pay', v_candidate_net,
      'employer_cost_candidate', round(v_gross + v_napsa_employer + v_nhima_employer, 2),
      'due_deduction_items', coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)
    ));
  end loop;

  v_snapshot := jsonb_build_object(
    'status', 'TRIAL_ONLY', 'payroll_run_id', v_run.id, 'payroll_run_version', v_run.version,
    'company_id', v_run.company_id, 'branch_id', v_run.branch_id,
    'period_start', v_period.period_start, 'period_end', v_period.period_end,
    'attendance_approved_at', v_inputs->>'attendance_approved_at',
    'is_authoritative', false, 'can_submit', false, 'can_approve', false, 'can_finalize', false,
    'rules', jsonb_build_object(
      'paye', 'ZM ordinary monthly 2026 bands published by ZRA; special categories not covered',
      'napsa', 'Illustrative 5% + 5% and published cap candidate; 2026 Act/SI application unresolved',
      'nhima', 'Illustrative 1% employee declared-income and 1% employer basic-pay candidates; base unresolved',
      'rounding', 'PostgreSQL numeric round to two decimal places; statutory payroll rounding confirmation pending'
    ),
    'blockers', v_global_blockers,
    'totals', jsonb_build_object(
      'employee_count', jsonb_array_length(coalesce(v_inputs->'items', '[]'::jsonb)),
      'gross_pay_candidate', round(v_total_gross, 2), 'paye_candidate', round(v_total_paye, 2),
      'napsa_employee_candidate', round(v_total_napsa_employee, 2),
      'napsa_employer_candidate', round(v_total_napsa_employer, 2),
      'nhima_employee_candidate', round(v_total_nhima_employee, 2),
      'nhima_employer_candidate', round(v_total_nhima_employer, 2),
      'approved_other_deductions', round(v_total_other_deductions, 2),
      'candidate_net_pay', round(v_total_candidate_net, 2),
      'employer_cost_candidate', round(v_total_gross + v_total_napsa_employer + v_total_nhima_employer, 2)
    ),
    'items', v_lines
  );

  insert into public.payroll_trial_calculations(
    portfolio_id, company_id, branch_id, payroll_run_id, actor_id, idempotency_key, snapshot
  ) values (
    v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, auth.uid(),
    btrim(p_idempotency_key), v_snapshot
  ) returning id into v_attempt;

  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_run.portfolio_id, v_run.company_id, v_run.branch_id, auth.uid(), 'PAYROLL_TRIAL_CALCULATED', 'payroll',
    v_run.id::text, jsonb_build_object('trial_calculation_id', v_attempt, 'run_version', v_run.version,
      'employee_count', jsonb_array_length(coalesce(v_inputs->'items', '[]'::jsonb)), 'status', 'TRIAL_ONLY'));
  return v_snapshot;
end;
$$;

revoke all on function public.payroll_calculate_trial(uuid, text) from public, anon;
grant execute on function public.payroll_calculate_trial(uuid, text) to authenticated;
comment on function public.payroll_calculate_trial(uuid, text) is
  'Persists a scoped numeric trial snapshot. Candidate statutory estimates are explicitly non-authoritative; the run remains DRAFT and cannot submit or finalize.';
