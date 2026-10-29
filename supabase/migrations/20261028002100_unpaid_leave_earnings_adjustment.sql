-- Apply an explicitly selected unpaid-leave rule to recurring earnings before
-- gross, PAYE, pension and health contribution bases are computed.
-- PostgreSQL NUMERIC rounds each adjusted component to cents, half away from zero.

create or replace function public.payroll_calculate(
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
  v_rule public.payroll_calculation_rule_versions%rowtype;
  v_paye_rule public.statutory_rule_versions%rowtype;
  v_napsa_rule public.statutory_rule_versions%rowtype;
  v_nhima_rule public.statutory_rule_versions%rowtype;
  v_existing public.payroll_calculation_history%rowtype;
  v_inputs jsonb;
  v_employee jsonb;
  v_amounts jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_ids uuid[];
  v_version integer;
  v_employee_id uuid;
  v_basic numeric(14,2);
  v_housing numeric(14,2);
  v_meal numeric(14,2);
  v_transport numeric(14,2);
  v_other numeric(14,2);
  v_taxable_allowances numeric(14,2);
  v_non_taxable_allowances numeric(14,2);
  v_other_deductions numeric(14,2);
  v_overtime numeric(14,2);
  v_taxable_overtime numeric(14,2);
  v_bonus numeric(14,2);
  v_taxable_bonus numeric(14,2);
  v_attendance_deduction numeric(14,2);
  v_original_recurring_gross numeric(14,2);
  v_adjusted_recurring_gross numeric(14,2);
  v_leave_factor numeric;
  v_unpaid_days numeric(8,2);
  v_scheduled_days numeric(8,2);
  v_unpaid_method text;
  v_frequency text;
  v_tax_treatment text;
  v_name text;
  v_snapshot jsonb;
  v_deduction jsonb;
  v_deduction_sum numeric(14,2);
  v_total_gross numeric(14,2) := 0;
  v_total_paye numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
  v_total_employer_cost numeric(14,2) := 0;
  v_total_napsa_employee numeric(14,2) := 0;
  v_total_napsa_employer numeric(14,2) := 0;
  v_total_nhima_employee numeric(14,2) := 0;
  v_total_nhima_employer numeric(14,2) := 0;
begin
  if auth.uid() is null or p_payroll_run_id is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 12
    or length(p_idempotency_key) > 120 then
    raise exception using errcode = '22023', message = 'A payroll run and valid idempotency key are required.';
  end if;

  select * into v_run from public.payroll_runs where id = p_payroll_run_id for update;
  if not found or not app_private.has_permission('payroll.prepare', v_run.portfolio_id, v_run.company_id, v_run.branch_id) then
    raise exception using errcode = '42501', message = 'Payroll calculation is not authorized.';
  end if;
  select * into v_existing from public.payroll_calculation_history
    where payroll_run_id = v_run.id and idempotency_key = btrim(p_idempotency_key);
  if found then return v_existing.snapshot; end if;
  if v_run.status not in ('DRAFT', 'CALCULATED', 'RETURNED_FOR_CORRECTION') then
    raise exception using errcode = '22023', message = 'Only draft, calculated, or returned payroll can be recalculated.';
  end if;

  select * into v_period from public.payroll_periods where id = v_run.payroll_period_id
    and portfolio_id = v_run.portfolio_id and company_id = v_run.company_id and branch_id = v_run.branch_id;
  if not found then raise exception using errcode = '22023', message = 'Payroll period was not found.'; end if;
  if v_period.frequency <> 'MONTHLY' or extract(day from v_period.period_start) <> 1
    or v_period.period_end <> (date_trunc('month', v_period.period_start) + interval '1 month - 1 day')::date then
    raise exception using errcode = '22023', message = 'The verified ordinary monthly rule set only supports complete calendar months.';
  end if;

  select * into v_rule from public.payroll_calculation_rule_versions
    where jurisdiction = 'ZM' and regulatory_verification_status = 'VERIFIED'
      and verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
      and development_period_start <= v_period.period_start and development_period_end >= v_period.period_end
    order by client_approved_at desc limit 1;
  if not found then raise exception using errcode = '22023', message = 'No verified calculation version covers this entire payroll period.'; end if;

  select * into v_paye_rule from public.statutory_rule_versions where jurisdiction = 'ZM' and rule_code = 'PAYE'
    and active and verified_at is not null and verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
    and effective_from <= v_period.period_end and (effective_to is null or effective_to >= v_period.period_start)
    order by effective_from desc limit 1;
  select * into v_napsa_rule from public.statutory_rule_versions where jurisdiction = 'ZM' and rule_code = 'NAPSA'
    and active and verified_at is not null and verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
    and effective_from <= v_period.period_end and (effective_to is null or effective_to >= v_period.period_start)
    order by effective_from desc limit 1;
  select * into v_nhima_rule from public.statutory_rule_versions where jurisdiction = 'ZM' and rule_code = 'NHIMA'
    and active and verified_at is not null and verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
    and effective_from <= v_period.period_end and (effective_to is null or effective_to >= v_period.period_start)
    order by effective_from desc limit 1;
  if v_paye_rule.id is null or v_napsa_rule.id is null or v_nhima_rule.id is null then
    raise exception using errcode = '22023', message = 'A complete verified PAYE, NAPSA, and NHIMA rule set is required.';
  end if;
  v_ids := array[v_paye_rule.id, v_napsa_rule.id, v_nhima_rule.id];

  v_inputs := public.payroll_preview_inputs(v_run.company_id, v_run.branch_id, v_period.period_start, v_period.period_end);
  if jsonb_array_length(coalesce(v_inputs->'items', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'No approved employees with approved attendance are available for this run.';
  end if;
  v_version := case when v_run.status in ('CALCULATED', 'RETURNED_FOR_CORRECTION') then v_run.version + 1 else v_run.version end;

  for v_employee in select value from jsonb_array_elements(v_inputs->'items') loop
    v_employee_id := (v_employee->>'employee_id')::uuid;
    v_frequency := v_employee->>'salary_frequency';
    if v_frequency is distinct from 'MONTHLY' then
      raise exception using errcode = '22023', message = 'A non-monthly employee requires a separately verified frequency rule.';
    end if;
    if not coalesce((v_employee->>'overtime_eligible')::boolean, false)
      and exists(select 1 from jsonb_array_elements(coalesce(v_employee->'approved_earnings','[]'::jsonb)) x
        where x->>'earning_type'='OVERTIME') then
      raise exception using errcode = '22023', message = 'Overtime earnings are not allowed for an employee whose compensation is not overtime-eligible.';
    end if;
    v_unpaid_days:=coalesce((v_employee #>> '{attendance,unpaid_leave_days}')::numeric,0);
    v_scheduled_days:=coalesce((v_employee #>> '{attendance,scheduled_working_days}')::numeric,0);
    v_unpaid_method:=coalesce(v_employee->>'unpaid_leave_deduction_method','BLOCK');
    v_attendance_deduction:=0;
    if v_unpaid_days>0 and v_scheduled_days<=0 then
      raise exception using errcode='22023',message='Unpaid leave cannot be calculated without scheduled working days.';
    end if;
    if coalesce(jsonb_array_length(coalesce(v_employee->'input_warnings', '[]'::jsonb)), 0) > 0 then
      raise exception using errcode = '22023', message = 'Payroll inputs contain missing or ambiguous compensation or attendance.';
    end if;

    v_basic := round((v_employee->>'basic_pay')::numeric, 2);
    v_housing := round(coalesce((v_employee->>'housing_allowance')::numeric, 0), 2);
    v_meal := round(coalesce((v_employee->>'meal_allowance')::numeric, 0), 2);
    v_transport := round(coalesce((v_employee->>'transport_allowance')::numeric, 0), 2);
    v_other := round(coalesce((v_employee->>'other_allowances')::numeric, 0), 2);
    if v_unpaid_days>0 then
      if v_unpaid_method='BASIC_PER_SCHEDULED_WORKDAY' then
        v_attendance_deduction:=round(v_basic/v_scheduled_days*v_unpaid_days,2);
        v_basic:=round(v_basic-v_attendance_deduction,2);
      elsif v_unpaid_method='GROSS_PER_SCHEDULED_WORKDAY' then
        v_original_recurring_gross:=v_basic+v_housing+v_meal+v_transport+v_other;
        v_leave_factor:=(v_scheduled_days-v_unpaid_days)/v_scheduled_days;
        v_basic:=round(v_basic*v_leave_factor,2);
        v_housing:=round(v_housing*v_leave_factor,2);
        v_meal:=round(v_meal*v_leave_factor,2);
        v_transport:=round(v_transport*v_leave_factor,2);
        v_other:=round(v_other*v_leave_factor,2);
        v_adjusted_recurring_gross:=v_basic+v_housing+v_meal+v_transport+v_other;
        v_attendance_deduction:=round(v_original_recurring_gross-v_adjusted_recurring_gross,2);
      else
        raise exception using errcode='22023',message='Unpaid leave requires an explicit compensation deduction method.';
      end if;
    end if;
    v_taxable_allowances := 0;
    v_non_taxable_allowances := 0;
    foreach v_name in array array['housing_allowance','meal_allowance','transport_allowance','other_allowances'] loop
      v_tax_treatment := upper(coalesce(v_employee->'allowance_tax_treatment'->>v_name, 'TAXABLE'));
      if v_tax_treatment = 'TAXABLE' then
        v_taxable_allowances := v_taxable_allowances + case v_name when 'housing_allowance' then v_housing when 'meal_allowance' then v_meal when 'transport_allowance' then v_transport else v_other end;
      elsif v_tax_treatment = 'NON_TAXABLE' then
        v_non_taxable_allowances := v_non_taxable_allowances + case v_name when 'housing_allowance' then v_housing when 'meal_allowance' then v_meal when 'transport_allowance' then v_transport else v_other end;
      else
        raise exception using errcode = '22023', message = 'An allowance has an unsupported statutory tax treatment.';
      end if;
    end loop;
    select round(coalesce(sum((d->>'scheduled_amount')::numeric), 0), 2)
      into v_other_deductions from jsonb_array_elements(coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)) d;
    select round(coalesce(sum((e->>'amount')::numeric) filter(where e->>'earning_type'='OVERTIME'),0),2),
      round(coalesce(sum((e->>'amount')::numeric) filter(where e->>'earning_type'='OVERTIME' and coalesce((e->>'taxable_for_paye')::boolean,false)),0),2),
      round(coalesce(sum((e->>'amount')::numeric) filter(where e->>'earning_type'<>'OVERTIME'),0),2),
      round(coalesce(sum((e->>'amount')::numeric) filter(where e->>'earning_type'<>'OVERTIME' and coalesce((e->>'taxable_for_paye')::boolean,false)),0),2)
      into v_overtime,v_taxable_overtime,v_bonus,v_taxable_bonus
      from jsonb_array_elements(coalesce(v_employee->'approved_earnings','[]'::jsonb)) e;

    v_amounts := app_private.payroll_calculate_client_policy_amounts(
      v_basic, v_taxable_allowances, v_non_taxable_allowances, v_overtime, v_taxable_overtime,
      v_bonus, v_taxable_bonus, v_other_deductions, v_rule.configuration
    );
    if (v_amounts->>'net_pay_blocked')::boolean then
      raise exception using errcode = '22023', message = 'Approved deductions exceed available employee net pay.';
    end if;

    v_line := jsonb_build_object(
      'employee_id', v_employee_id, 'employee_number', v_employee->>'employee_number',
      'employee_name', v_employee->>'employee_name', 'version', v_version,
      'basic_salary', v_basic, 'housing_allowance', v_housing, 'meal_allowance', v_meal,
      'transport_allowance', v_transport, 'other_allowances', v_other,
      'taxable_allowances', round(v_taxable_allowances,2), 'non_taxable_allowances', round(v_non_taxable_allowances,2),
      'overtime', v_overtime, 'taxable_overtime',v_taxable_overtime, 'bonuses_and_other_earnings', v_bonus, 'taxable_bonuses_and_other_earnings',v_taxable_bonus, 'attendance_deduction',v_attendance_deduction,
      'gross_earnings', v_amounts->'gross_earnings', 'paye_taxable_income', v_amounts->'paye_taxable_income',
      'paye', v_amounts->'paye', 'napsa_employee', v_amounts->'napsa_employee',
      'napsa_employer', v_amounts->'napsa_employer', 'nhima_employee', v_amounts->'nhima_employee',
      'nhima_employer', v_amounts->'nhima_employer', 'other_approved_deductions', v_other_deductions, 'attendance_deduction',v_attendance_deduction,
      'net_pay', v_amounts->'net_pay', 'total_employer_cost', v_amounts->'total_employer_cost',
      'statutory_rule_version_ids', to_jsonb(v_ids), 'calculation_rule_version_id', v_rule.id,
      'due_deduction_items', coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)
    );

    insert into public.payroll_run_items(
      portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version,
      basic_pay, housing_allowance, meal_allowance, transport_allowance, other_allowances,
      overtime, bonuses_and_other_earnings, attendance_deduction, gross_pay, statutory_deductions, voluntary_deductions, net_pay,
      calculation_breakdown, paye_taxable_income, napsa_employee, napsa_employer,
      nhima_employee, nhima_employer, total_employer_cost, calculation_rule_version_id, calculated_at
    ) values (
      v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, v_employee_id, v_version,
      v_basic, v_housing, v_meal, v_transport, v_other, v_overtime, v_bonus, v_attendance_deduction,
      (v_amounts->>'gross_earnings')::numeric,
      jsonb_build_object('PAYE',(v_amounts->>'paye')::numeric,'NAPSA_EMPLOYEE',(v_amounts->>'napsa_employee')::numeric,'NHIMA_EMPLOYEE',(v_amounts->>'nhima_employee')::numeric),
      v_other_deductions, (v_amounts->>'net_pay')::numeric, v_line,
      (v_amounts->>'paye_taxable_income')::numeric, (v_amounts->>'napsa_employee')::numeric,
      (v_amounts->>'napsa_employer')::numeric, (v_amounts->>'nhima_employee')::numeric,
      (v_amounts->>'nhima_employer')::numeric, (v_amounts->>'total_employer_cost')::numeric, v_rule.id, now()
    );

    for v_deduction in select value from jsonb_array_elements(coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)) loop
      insert into public.payroll_item_deductions(
        payroll_run_id, employee_id, version, deduction_id, installment_id, amount,
        portfolio_id, company_id, branch_id
      ) values (
        v_run.id, v_employee_id, v_version, (v_deduction->>'deduction_id')::uuid,
        (v_deduction->>'installment_id')::uuid, (v_deduction->>'scheduled_amount')::numeric,
        v_run.portfolio_id, v_run.company_id, v_run.branch_id
      );
    end loop;

    v_lines := v_lines || jsonb_build_array(v_line);
    v_total_gross := v_total_gross + (v_amounts->>'gross_earnings')::numeric;
    v_total_paye := v_total_paye + (v_amounts->>'paye')::numeric;
    v_total_net := v_total_net + (v_amounts->>'net_pay')::numeric;
    v_total_employer_cost := v_total_employer_cost + (v_amounts->>'total_employer_cost')::numeric;
    v_total_napsa_employee := v_total_napsa_employee + (v_amounts->>'napsa_employee')::numeric;
    v_total_napsa_employer := v_total_napsa_employer + (v_amounts->>'napsa_employer')::numeric;
    v_total_nhima_employee := v_total_nhima_employee + (v_amounts->>'nhima_employee')::numeric;
    v_total_nhima_employer := v_total_nhima_employer + (v_amounts->>'nhima_employer')::numeric;
  end loop;

  delete from public.payroll_run_statutory_rules where payroll_run_id = v_run.id;
  insert into public.payroll_run_statutory_rules(portfolio_id, company_id, branch_id, payroll_run_id, statutory_rule_version_id)
  select v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, unnest(v_ids);

  v_snapshot := jsonb_build_object(
    'status','CALCULATED','payroll_run_id',v_run.id,'payroll_run_version',v_version,
    'company_id',v_run.company_id,'branch_id',v_run.branch_id,'period_start',v_period.period_start,
    'period_end',v_period.period_end,'calculation_version','POSTGRES_NUMERIC_ZM_2026_V1',
    'calculation_rule_version_id',v_rule.id,'statutory_rule_version_ids',to_jsonb(v_ids),
    'source_verification_status','VERIFIED_BY_OFFICIAL_PUBLICATION_REVIEW',
    'rounding','PostgreSQL NUMERIC round to 2 decimal places (half away from zero)',
    'totals',jsonb_build_object('employee_count',jsonb_array_length(v_lines),
      'gross_earnings',round(v_total_gross,2),'paye',round(v_total_paye,2),
      'napsa_employee',round(v_total_napsa_employee,2),'napsa_employer',round(v_total_napsa_employer,2),
      'nhima_employee',round(v_total_nhima_employee,2),'nhima_employer',round(v_total_nhima_employer,2),
      'net_pay',round(v_total_net,2),'total_employer_cost',round(v_total_employer_cost,2)),
    'items',v_lines
  );
  update public.payroll_runs set status='CALCULATED', version=v_version,
    calculations=v_snapshot, updated_at=now() where id=v_run.id;
  insert into public.payroll_calculation_history(
    portfolio_id,company_id,branch_id,payroll_run_id,payroll_version,actor_id,
    idempotency_key,calculation_version,calculation_rule_version_id,statutory_rule_version_ids,snapshot
  ) values (
    v_run.portfolio_id,v_run.company_id,v_run.branch_id,v_run.id,v_version,auth.uid(),btrim(p_idempotency_key),
    'POSTGRES_NUMERIC_ZM_2026_V1',v_rule.id,v_ids,v_snapshot
  );
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values (v_run.portfolio_id,v_run.company_id,v_run.branch_id,auth.uid(),'PAYROLL_CALCULATED','payroll',v_run.id::text,
    jsonb_build_object('version',v_version,'employees',jsonb_array_length(v_lines),'rules',to_jsonb(v_ids),'idempotency_key',btrim(p_idempotency_key)));
  return v_snapshot;
end;
$$;

revoke all on function public.payroll_calculate(uuid,text) from public,anon;
grant execute on function public.payroll_calculate(uuid,text) to authenticated;
comment on function public.payroll_calculate(uuid,text) is 'Trusted NUMERIC calculation applies approved unpaid leave to effective recurring earnings before gross and statutory bases, then adds approved variable earnings and deductions.';