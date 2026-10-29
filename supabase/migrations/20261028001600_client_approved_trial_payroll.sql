-- Client-approved 2026 calculation policy for non-payable payroll trials.
-- This is not independent statutory verification. Production approval and
-- finalization continue to require verified statutory_rule_versions.

create table public.payroll_calculation_rule_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'ZM' check (jurisdiction = 'ZM'),
  version text not null,
  development_period_start date not null,
  development_period_end date not null,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  policy_reference text not null,
  client_approval_status text not null check (client_approval_status = 'APPROVED_FOR_DEVELOPMENT'),
  client_approved_at timestamptz not null default now(),
  regulatory_verification_status text not null default 'UNVERIFIED'
    check (regulatory_verification_status in ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED')),
  regulatory_effective_date date,
  regulatory_verified_by uuid references public.profiles(id) on delete restrict,
  regulatory_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (jurisdiction, version),
  check (development_period_end >= development_period_start),
  check ((regulatory_verification_status = 'VERIFIED') =
    (regulatory_verified_by is not null and regulatory_verified_at is not null and regulatory_effective_date is not null))
);

alter table public.payroll_calculation_rule_versions enable row level security;
revoke all on table public.payroll_calculation_rule_versions from public, anon, authenticated;

insert into public.payroll_calculation_rule_versions (
  jurisdiction, version, development_period_start, development_period_end,
  configuration, policy_reference, client_approval_status,
  regulatory_verification_status, regulatory_effective_date
) values (
  'ZM', 'ZM-2026-CLIENT-APPROVED-V1', '2026-01-01', '2026-12-31',
  '{
    "currency": "ZMW",
    "rounding": {"scale": 2, "mode": "POSTGRES_NUMERIC_HALF_AWAY_FROM_ZERO"},
    "paye": {
      "taxable_income_basis": "BASIC_PLUS_TAXABLE_ALLOWANCES_AND_EARNINGS",
      "deduct_employee_napsa_before_tax": false,
      "deduct_employee_nhima_before_tax": false,
      "bands": [
        {"lower_exclusive": "0.00", "upper_inclusive": "5100.00", "rate": "0.00"},
        {"lower_exclusive": "5100.00", "upper_inclusive": "7100.00", "rate": "0.20"},
        {"lower_exclusive": "7100.00", "upper_inclusive": "9200.00", "rate": "0.30"},
        {"lower_exclusive": "9200.00", "upper_inclusive": null, "rate": "0.37"}
      ]
    },
    "napsa": {
      "employee_rate": "0.05", "employer_rate": "0.05",
      "base": "GROSS_MONTHLY_EARNINGS",
      "employee_monthly_cap": "1861.80", "employer_monthly_cap": "1861.80",
      "gross_earnings_ceiling_threshold": "37236.00",
      "policy_reference": "Client-provided: Act No. 40 of 1996; current amendments/effective dates not independently verified"
    },
    "nhima": {
      "employee_rate": "0.01", "employer_rate": "0.01",
      "base": "BASIC_SALARY_ONLY", "monthly_cap": null,
      "policy_reference": "Client-provided: SI No. 63 of 2019, Third Schedule; current effective date not independently verified"
    },
    "overtime_bonus_and_other_earnings": {
      "input_source_status": "NOT_CONNECTED",
      "trial_blocker": "APPROVED_OVERTIME_BONUS_INPUTS_NOT_CONNECTED"
    },
    "unpaid_leave": {"input_source_status": "NO_APPROVED_CONTRACT_FORMULA", "trial_blocker": "UNPAID_LEAVE_FORMULA_NOT_CONFIGURED"}
  }'::jsonb,
  'Project-owner instruction received 2026-10-28; development/acceptance policy only',
  'APPROVED_FOR_DEVELOPMENT', 'UNVERIFIED', null
) on conflict (jurisdiction, version) do nothing;

alter table public.payroll_trial_calculations
  add column if not exists rule_version_id uuid references public.payroll_calculation_rule_versions(id) on delete restrict,
  add column if not exists calculation_version text;

alter table public.payroll_trial_calculations
  add constraint payroll_trial_calculations_scope_unique
  unique (id, portfolio_id, company_id, branch_id, payroll_run_id);

create table public.payroll_trial_calculation_items (
  id uuid primary key default gen_random_uuid(),
  trial_calculation_id uuid not null,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  employee_id uuid not null,
  rule_version_id uuid not null references public.payroll_calculation_rule_versions(id) on delete restrict,
  calculation_status text not null check (calculation_status in ('CALCULATED', 'BLOCKED')),
  basic_salary numeric(14,2) not null check (basic_salary >= 0),
  taxable_allowances numeric(14,2) not null check (taxable_allowances >= 0),
  non_taxable_allowances numeric(14,2) not null check (non_taxable_allowances >= 0),
  overtime numeric(14,2) not null default 0 check (overtime >= 0),
  bonuses_and_other_earnings numeric(14,2) not null default 0 check (bonuses_and_other_earnings >= 0),
  gross_earnings numeric(14,2) not null check (gross_earnings >= 0),
  paye_taxable_income numeric(14,2) not null check (paye_taxable_income >= 0),
  paye numeric(14,2) not null check (paye >= 0),
  napsa_employee numeric(14,2) not null check (napsa_employee >= 0),
  napsa_employer numeric(14,2) not null check (napsa_employer >= 0),
  nhima_employee numeric(14,2) not null check (nhima_employee >= 0),
  nhima_employer numeric(14,2) not null check (nhima_employer >= 0),
  other_approved_deductions numeric(14,2) not null check (other_approved_deductions >= 0),
  net_pay numeric(14,2),
  total_employer_cost numeric(14,2) not null check (total_employer_cost >= 0),
  breakdown jsonb not null check (jsonb_typeof(breakdown) = 'object'),
  blockers jsonb not null default '[]'::jsonb check (jsonb_typeof(blockers) = 'array'),
  calculated_at timestamptz not null default now(),
  unique (trial_calculation_id, employee_id),
  foreign key (trial_calculation_id, portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_trial_calculations(id, portfolio_id, company_id, branch_id, payroll_run_id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (net_pay is null or net_pay >= 0),
  check (total_employer_cost = gross_earnings + napsa_employer + nhima_employer)
);

create index payroll_trial_items_tenant_lookup_idx
  on public.payroll_trial_calculation_items(portfolio_id, company_id, branch_id, payroll_run_id, trial_calculation_id, employee_id);

alter table public.payroll_trial_calculation_items enable row level security;
revoke all on table public.payroll_trial_calculation_items from public, anon, authenticated;
grant select on table public.payroll_trial_calculation_items to authenticated;
create policy payroll_trial_items_read_authorized on public.payroll_trial_calculation_items
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );

create or replace function app_private.payroll_calculate_client_policy_amounts(
  p_basic numeric,
  p_taxable_allowances numeric,
  p_non_taxable_allowances numeric,
  p_overtime numeric,
  p_taxable_overtime numeric,
  p_bonuses_and_other_earnings numeric,
  p_taxable_bonuses_and_other_earnings numeric,
  p_other_approved_deductions numeric,
  p_configuration jsonb
)
returns jsonb
language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  v_gross numeric(14,2);
  v_taxable numeric(14,2);
  v_paye numeric(14,2);
  v_napsa_employee numeric(14,2);
  v_napsa_employer numeric(14,2);
  v_nhima_employee numeric(14,2);
  v_nhima_employer numeric(14,2);
  v_net numeric(14,2);
  v_cost numeric(14,2);
  v_bands jsonb;
  v_band jsonb;
  v_lower numeric := 0;
  v_upper numeric;
  v_rate numeric;
  v_slice numeric;
  v_napsa_cap numeric;
begin
  if p_basic is null or p_taxable_allowances is null or p_non_taxable_allowances is null
    or p_overtime is null or p_taxable_overtime is null or p_bonuses_and_other_earnings is null
    or p_taxable_bonuses_and_other_earnings is null or p_other_approved_deductions is null
    or p_configuration is null
    or least(p_basic, p_taxable_allowances, p_non_taxable_allowances, p_overtime,
      p_taxable_overtime, p_bonuses_and_other_earnings, p_taxable_bonuses_and_other_earnings,
      p_other_approved_deductions) < 0 then
    raise exception using errcode = '22023', message = 'Payroll amounts must be present and non-negative.';
  end if;

  v_gross := round(p_basic + p_taxable_allowances + p_non_taxable_allowances
    + p_overtime + p_bonuses_and_other_earnings, 2);
  v_taxable := round(p_basic + p_taxable_allowances + p_taxable_overtime
    + p_taxable_bonuses_and_other_earnings, 2);
  v_paye := 0;
  v_bands := p_configuration #> '{paye,bands}';
  if jsonb_typeof(v_bands) <> 'array' or jsonb_array_length(v_bands) = 0 then
    raise exception using errcode = '22023', message = 'The client-approved PAYE rule version is invalid.';
  end if;
  for v_band in select value from jsonb_array_elements(v_bands) loop
    v_upper := nullif(v_band->>'upper_inclusive', '')::numeric;
    v_rate := (v_band->>'rate')::numeric;
    if v_upper is null then
      v_slice := greatest(0, v_taxable - v_lower);
    else
      v_slice := greatest(0, least(v_taxable, v_upper) - v_lower);
    end if;
    v_paye := v_paye + v_slice * v_rate;
    if v_upper is null then exit; end if;
    v_lower := v_upper;
  end loop;
  v_paye := round(v_paye, 2);

  v_napsa_cap := (p_configuration #>> '{napsa,employee_monthly_cap}')::numeric;
  v_napsa_employee := least(round(v_gross * (p_configuration #>> '{napsa,employee_rate}')::numeric, 2), v_napsa_cap);
  v_napsa_cap := (p_configuration #>> '{napsa,employer_monthly_cap}')::numeric;
  v_napsa_employer := least(round(v_gross * (p_configuration #>> '{napsa,employer_rate}')::numeric, 2), v_napsa_cap);
  v_nhima_employee := round(p_basic * (p_configuration #>> '{nhima,employee_rate}')::numeric, 2);
  v_nhima_employer := round(p_basic * (p_configuration #>> '{nhima,employer_rate}')::numeric, 2);
  v_net := round(v_gross - v_paye - v_napsa_employee - v_nhima_employee - p_other_approved_deductions, 2);
  v_cost := round(v_gross + v_napsa_employer + v_nhima_employer, 2);

  return jsonb_build_object(
    'gross_earnings', v_gross,
    'paye_taxable_income', v_taxable,
    'paye', v_paye,
    'napsa_employee', v_napsa_employee,
    'napsa_employer', v_napsa_employer,
    'nhima_employee', v_nhima_employee,
    'nhima_employer', v_nhima_employer,
    'other_approved_deductions', p_other_approved_deductions,
    'net_pay', case when v_net < 0 then null else v_net end,
    'total_employer_cost', v_cost,
    'statutory_deductions', jsonb_build_object(
      'paye', v_paye, 'napsa_employee', v_napsa_employee, 'nhima_employee', v_nhima_employee
    ),
    'employer_contributions', jsonb_build_object(
      'napsa', v_napsa_employer, 'nhima', v_nhima_employer
    ),
    'net_pay_blocked', v_net < 0
  );
end;
$$;

revoke all on function app_private.payroll_calculate_client_policy_amounts(
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, jsonb
) from public, anon, authenticated;

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
  v_rule public.payroll_calculation_rule_versions%rowtype;
  v_inputs jsonb;
  v_employee jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_item_blockers jsonb;
  v_global_blockers jsonb := jsonb_build_array(
    'CLIENT_APPROVED_FOR_DEVELOPMENT_ONLY',
    'NAPSA_CEILING_AND_EFFECTIVE_DATES_NOT_LEGALLY_VERIFIED',
    'NHIMA_BASE_EFFECTIVE_DATES_AND_EXEMPTIONS_NOT_LEGALLY_VERIFIED',
    'OVERTIME_BONUS_AND_OTHER_EARNINGS_SOURCES_NOT_CONNECTED',
    'TRIAL_CANNOT_BE_SUBMITTED_APPROVED_OR_FINALIZED'
  );
  v_snapshot jsonb;
  v_amounts jsonb;
  v_employee_id uuid;
  v_employee_number text;
  v_frequency text;
  v_basic numeric(14,2);
  v_taxable_allowances numeric(14,2);
  v_non_taxable_allowances numeric(14,2);
  v_housing numeric(14,2);
  v_meal numeric(14,2);
  v_transport numeric(14,2);
  v_other numeric(14,2);
  v_overtime numeric(14,2);
  v_taxable_overtime numeric(14,2);
  v_bonus numeric(14,2);
  v_taxable_bonus numeric(14,2);
  v_other_deductions numeric(14,2);
  v_covering_comp_count integer;
  v_trial_id uuid;
  v_key text;
  v_calc_status text;
  v_total_gross numeric(14,2) := 0;
  v_total_taxable numeric(14,2) := 0;
  v_total_paye numeric(14,2) := 0;
  v_total_napsa_employee numeric(14,2) := 0;
  v_total_napsa_employer numeric(14,2) := 0;
  v_total_nhima_employee numeric(14,2) := 0;
  v_total_nhima_employer numeric(14,2) := 0;
  v_total_other_deductions numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
  v_total_employer_cost numeric(14,2) := 0;
  v_calculated_count integer := 0;
  v_blocked_count integer := 0;
begin
  if auth.uid() is null or p_payroll_run_id is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 12
    or length(p_idempotency_key) > 120 then
    raise exception using errcode = '22023', message = 'A valid payroll run and idempotency key are required.';
  end if;

  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or not app_private.has_permission('payroll.prepare', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
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
  if not found then raise exception using errcode = '22023', message = 'Payroll period was not found for this run.'; end if;
  select * into v_rule from public.payroll_calculation_rule_versions
    where jurisdiction = 'ZM' and client_approval_status = 'APPROVED_FOR_DEVELOPMENT'
      and development_period_start <= v_period.period_start
      and development_period_end >= v_period.period_end
    order by client_approved_at desc limit 1;
  if not found then raise exception using errcode = '22023', message = 'No client-approved calculation policy covers the full payroll period.'; end if;

  v_inputs := public.payroll_preview_inputs(v_run.company_id, v_run.branch_id, v_period.period_start, v_period.period_end);
  v_key := btrim(p_idempotency_key);
  insert into public.payroll_trial_calculations(
    portfolio_id, company_id, branch_id, payroll_run_id, actor_id, idempotency_key,
    rule_version_id, calculation_version, snapshot
  ) values (
    v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, auth.uid(), v_key,
    v_rule.id, 'POSTGRES_NUMERIC_CLIENT_POLICY_V1',
    jsonb_build_object('status', 'TRIAL_ONLY', 'payroll_run_id', v_run.id,
      'payroll_run_version', v_run.version, 'rule_version_id', v_rule.id,
      'calculation_version', 'POSTGRES_NUMERIC_CLIENT_POLICY_V1')
  ) returning id into v_trial_id;

  for v_employee in select value from jsonb_array_elements(coalesce(v_inputs->'items', '[]'::jsonb)) loop
    v_employee_id := nullif(v_employee->>'employee_id', '')::uuid;
    v_employee_number := v_employee->>'employee_number';
    v_frequency := v_employee->>'salary_frequency';
    v_basic := round(coalesce((v_employee->>'basic_pay')::numeric, 0), 2);
    v_housing := round(coalesce((v_employee->>'housing_allowance')::numeric, 0), 2);
    v_meal := round(coalesce((v_employee->>'meal_allowance')::numeric, 0), 2);
    v_transport := round(coalesce((v_employee->>'transport_allowance')::numeric, 0), 2);
    v_other := round(coalesce((v_employee->>'other_allowances')::numeric, 0), 2);
    v_taxable_allowances := 0;
    v_non_taxable_allowances := 0;
    v_item_blockers := coalesce(v_employee->'input_warnings', '[]'::jsonb);
    foreach v_key in array array['housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances'] loop
      declare v_allowance numeric; v_treatment text;
      begin
        v_allowance := case v_key
          when 'housing_allowance' then v_housing
          when 'meal_allowance' then v_meal
          when 'transport_allowance' then v_transport
          else v_other end;
        v_treatment := coalesce(v_employee->'allowance_tax_treatment'->>v_key, 'TAXABLE');
        if upper(v_treatment) = 'TAXABLE' then v_taxable_allowances := v_taxable_allowances + v_allowance;
        elsif upper(v_treatment) = 'NON_TAXABLE' then v_non_taxable_allowances := v_non_taxable_allowances + v_allowance;
        else
          -- Keep all earnings in gross and use the conservative taxable
          -- scenario while explicitly blocking this employee's trial line.
          v_taxable_allowances := v_taxable_allowances + v_allowance;
          v_item_blockers := v_item_blockers || jsonb_build_array('UNKNOWN_ALLOWANCE_TAX_TREATMENT_' || upper(v_key));
        end if;
      end;
    end loop;

    v_overtime := 0;
    v_taxable_overtime := 0;
    v_bonus := 0;
    v_taxable_bonus := 0;
    if coalesce((v_employee->>'overtime_eligible')::boolean, false) then
      v_item_blockers := v_item_blockers || jsonb_build_array('APPROVED_OVERTIME_INPUTS_NOT_CONNECTED');
    end if;
    if coalesce((v_employee #>> '{attendance,unpaid_leave_days}')::numeric, 0) > 0 then
      v_item_blockers := v_item_blockers || jsonb_build_array('UNPAID_LEAVE_FORMULA_NOT_CONFIGURED');
    end if;
    if v_frequency is distinct from 'MONTHLY' then
      v_item_blockers := v_item_blockers || jsonb_build_array('NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE');
    end if;
    select count(*) into v_covering_comp_count from public.employee_compensation ec
      where ec.employee_id = v_employee_id and ec.portfolio_id = v_run.portfolio_id and ec.company_id = v_run.company_id
        and ec.effective_from <= v_period.period_start and (ec.effective_to is null or ec.effective_to >= v_period.period_end);
    if v_covering_comp_count <> 1 then v_item_blockers := v_item_blockers || jsonb_build_array('COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD'); end if;

    select round(coalesce(sum((value->>'scheduled_amount')::numeric), 0), 2) into v_other_deductions
      from jsonb_array_elements(coalesce(v_employee->'due_approved_deductions', '[]'::jsonb));
    v_amounts := app_private.payroll_calculate_client_policy_amounts(
      v_basic, v_taxable_allowances, v_non_taxable_allowances, v_overtime, v_taxable_overtime,
      v_bonus, v_taxable_bonus, v_other_deductions, v_rule.configuration
    );
    if (v_amounts->>'net_pay_blocked')::boolean then v_item_blockers := v_item_blockers || jsonb_build_array('DEDUCTIONS_EXCEED_GROSS_PAY'); end if;
    v_calc_status := case when jsonb_array_length(v_item_blockers) > 0 then 'BLOCKED' else 'CALCULATED' end;
    v_line := jsonb_build_object(
      'employee_id', v_employee_id, 'employee_number', v_employee_number,
      'employee_name', v_employee->>'employee_name', 'salary_frequency', v_frequency,
      'calculation_status', v_calc_status, 'blockers', v_item_blockers,
      'basic_salary', v_basic, 'taxable_allowances', v_taxable_allowances,
      'non_taxable_allowances', v_non_taxable_allowances, 'overtime', v_overtime,
      'bonuses_and_other_earnings', v_bonus,
      'allowance_breakdown', jsonb_build_object(
        'housing', v_housing, 'meal', v_meal, 'transport', v_transport, 'other', v_other
      ),
      'gross_earnings', v_amounts->'gross_earnings',
      'paye_taxable_income', v_amounts->'paye_taxable_income',
      'paye', v_amounts->'paye',
      'napsa_employee', v_amounts->'napsa_employee', 'napsa_employer', v_amounts->'napsa_employer',
      'nhima_employee', v_amounts->'nhima_employee', 'nhima_employer', v_amounts->'nhima_employer',
      'other_approved_deductions', v_amounts->'other_approved_deductions',
      'net_pay', v_amounts->'net_pay', 'total_employer_cost', v_amounts->'total_employer_cost',
      'due_deduction_items', coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)
    );

    insert into public.payroll_trial_calculation_items (
      trial_calculation_id, portfolio_id, company_id, branch_id, payroll_run_id,
      employee_id, rule_version_id, calculation_status, basic_salary,
      taxable_allowances, non_taxable_allowances, overtime, bonuses_and_other_earnings,
      gross_earnings, paye_taxable_income, paye, napsa_employee, napsa_employer,
      nhima_employee, nhima_employer, other_approved_deductions, net_pay,
      total_employer_cost, breakdown, blockers
    ) values (
      v_trial_id, v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id,
      v_employee_id, v_rule.id, v_calc_status, v_basic, v_taxable_allowances,
      v_non_taxable_allowances, v_overtime, v_bonus,
      (v_amounts->>'gross_earnings')::numeric, (v_amounts->>'paye_taxable_income')::numeric,
      (v_amounts->>'paye')::numeric, (v_amounts->>'napsa_employee')::numeric,
      (v_amounts->>'napsa_employer')::numeric, (v_amounts->>'nhima_employee')::numeric,
      (v_amounts->>'nhima_employer')::numeric, (v_amounts->>'other_approved_deductions')::numeric,
      (v_amounts->>'net_pay')::numeric, (v_amounts->>'total_employer_cost')::numeric,
      v_line, v_item_blockers
    );
    v_lines := v_lines || jsonb_build_array(v_line);
    if v_calc_status = 'CALCULATED' then
      v_calculated_count := v_calculated_count + 1;
      v_total_gross := v_total_gross + (v_amounts->>'gross_earnings')::numeric;
      v_total_taxable := v_total_taxable + (v_amounts->>'paye_taxable_income')::numeric;
      v_total_paye := v_total_paye + (v_amounts->>'paye')::numeric;
      v_total_napsa_employee := v_total_napsa_employee + (v_amounts->>'napsa_employee')::numeric;
      v_total_napsa_employer := v_total_napsa_employer + (v_amounts->>'napsa_employer')::numeric;
      v_total_nhima_employee := v_total_nhima_employee + (v_amounts->>'nhima_employee')::numeric;
      v_total_nhima_employer := v_total_nhima_employer + (v_amounts->>'nhima_employer')::numeric;
      v_total_other_deductions := v_total_other_deductions + (v_amounts->>'other_approved_deductions')::numeric;
      v_total_net := v_total_net + coalesce((v_amounts->>'net_pay')::numeric, 0);
      v_total_employer_cost := v_total_employer_cost + (v_amounts->>'total_employer_cost')::numeric;
    else
      v_blocked_count := v_blocked_count + 1;
    end if;
  end loop;

  v_snapshot := jsonb_build_object(
    'status', 'TRIAL_ONLY', 'payroll_run_id', v_run.id, 'payroll_run_version', v_run.version,
    'company_id', v_run.company_id, 'branch_id', v_run.branch_id,
    'period_start', v_period.period_start, 'period_end', v_period.period_end,
    'attendance_approved_at', v_inputs->>'attendance_approved_at',
    'rule_version_id', v_rule.id, 'calculation_version', 'POSTGRES_NUMERIC_CLIENT_POLICY_V1',
    'client_approval_status', v_rule.client_approval_status,
    'regulatory_verification_status', v_rule.regulatory_verification_status,
    'is_authoritative', false, 'can_submit', false, 'can_approve', false, 'can_finalize', false,
    'rounding', 'PostgreSQL numeric round to 2 decimal places (half away from zero)',
    'rules', v_rule.configuration,
    'blockers', v_global_blockers,
    'totals', jsonb_build_object(
      'employee_count', jsonb_array_length(coalesce(v_inputs->'items', '[]'::jsonb)),
      'calculable_employee_count', v_calculated_count, 'blocked_employee_count', v_blocked_count,
      'gross_earnings', round(v_total_gross, 2), 'paye_taxable_income', round(v_total_taxable, 2),
      'paye', round(v_total_paye, 2), 'napsa_employee', round(v_total_napsa_employee, 2),
      'napsa_employer', round(v_total_napsa_employer, 2), 'nhima_employee', round(v_total_nhima_employee, 2),
      'nhima_employer', round(v_total_nhima_employer, 2),
      'employee_statutory_deductions', round(v_total_paye + v_total_napsa_employee + v_total_nhima_employee, 2),
      'other_approved_deductions', round(v_total_other_deductions, 2),
      'net_pay', round(v_total_net, 2), 'employer_statutory_contributions', round(v_total_napsa_employer + v_total_nhima_employer, 2),
      'total_employer_cost', round(v_total_employer_cost, 2)
    ),
    'items', v_lines
  );
  update public.payroll_trial_calculations set snapshot = v_snapshot where id = v_trial_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_run.portfolio_id, v_run.company_id, v_run.branch_id, auth.uid(), 'PAYROLL_TRIAL_CALCULATED', 'payroll',
    v_run.id::text, jsonb_build_object('trial_calculation_id', v_trial_id, 'run_version', v_run.version,
      'rule_version_id', v_rule.id, 'employee_count', jsonb_array_length(coalesce(v_inputs->'items', '[]'::jsonb)),
      'status', 'TRIAL_ONLY'));
  return v_snapshot;
end;
$$;

revoke all on function public.payroll_calculate_trial(uuid, text) from public, anon;
grant execute on function public.payroll_calculate_trial(uuid, text) to authenticated;
comment on table public.payroll_calculation_rule_versions is
  'Immutable-by-application client-approved calculation configurations for development trials. Regulatory verification is tracked separately.';
comment on table public.payroll_trial_calculation_items is
  'Persisted employee-level client-policy trial calculations; never used as finalized payroll or payment instructions.';
comment on function public.payroll_calculate_trial(uuid, text) is
  'Calculates and persists an idempotent client-approved rule-set trial with PostgreSQL NUMERIC. It cannot submit, approve, or finalize payroll.';
