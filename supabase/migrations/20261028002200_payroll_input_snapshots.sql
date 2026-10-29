-- Snapshot the source references and classifications used for each calculated
-- employee item, so subsequent HR edits cannot obscure what was reviewed.

create or replace function public.payroll_preview_inputs(
  p_company_id uuid,
  p_branch_id uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_portfolio_id uuid; v_attendance public.attendance_periods%rowtype; v_result jsonb;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception using errcode = '22023', message = 'A valid payroll period is required.';
  end if;
  select b.portfolio_id into v_portfolio_id from public.branches b where b.company_id = p_company_id and b.id = p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare', v_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Payroll inputs are not authorized for this branch.';
  end if;
  select ap.* into v_attendance from public.attendance_periods ap
  where ap.portfolio_id = v_portfolio_id and ap.company_id = p_company_id and ap.branch_id = p_branch_id
    and ap.period_start = p_period_start and ap.period_end = p_period_end;
  if not found or v_attendance.status <> 'APPROVED' then
    raise exception using errcode = '22023', message = 'An approved attendance period matching the payroll dates is required.';
  end if;
  select jsonb_build_object(
    'portfolio_id', v_portfolio_id, 'company_id', p_company_id, 'branch_id', p_branch_id,
    'period_start', p_period_start, 'period_end', p_period_end, 'attendance_period_id', v_attendance.id,
    'attendance_approved_at', v_attendance.reviewed_at,
    'earning_inputs', coalesce((select jsonb_agg(jsonb_build_object(
      'id',pi.id,'employee_id',pi.employee_id,'employee_number',e2.employee_number,
      'employee_name',concat_ws(' ',e2.first_name,nullif(e2.middle_name,''),e2.last_name),
      'earning_type',pi.earning_type,'amount',pi.amount,'taxable_for_paye',pi.taxable_for_paye,
      'source_reference',pi.source_reference,'description',pi.description,'status',pi.status,
      'created_by',pi.created_by,'approved_by',pi.approved_by,'created_at',pi.created_at)
      order by pi.created_at,pi.id)
      from public.payroll_earning_inputs pi join public.employees e2 on e2.id=pi.employee_id
      where pi.portfolio_id=v_portfolio_id and pi.company_id=p_company_id and pi.branch_id=p_branch_id
        and pi.period_start=p_period_start and pi.period_end=p_period_end),'[]'::jsonb),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id, 'employee_number', e.employee_number,
      'employee_name', concat_ws(' ', e.first_name, nullif(e.middle_name, ''), e.last_name),
      'contract_type', e.contract_type, 'employment_type', e.employment_type,
      'salary_frequency', comp.salary_frequency, 'compensation_effective_from', comp.effective_from,
      'basic_pay', comp.basic_pay, 'housing_allowance', comp.housing_allowance, 'meal_allowance', comp.meal_allowance,
      'transport_allowance', comp.transport_allowance, 'other_allowances', comp.other_allowances,
      'overtime_eligible', comp.overtime_eligible, 'unpaid_leave_deduction_method', comp.unpaid_leave_deduction_method, 'allowance_tax_treatment', comp.allowance_tax_treatment,
      'attendance', case when ae.id is null then null else jsonb_build_object(
        'scheduled_working_days', ae.scheduled_working_days, 'actual_days_worked', ae.actual_days_worked,
        'paid_leave_days', ae.paid_leave_days, 'unpaid_leave_days', ae.unpaid_leave_days,
        'other_payable_absence_days', ae.other_payable_absence_days) end,
      'approved_leave_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'leave_request_id', lr.id, 'pay_classification', lr.pay_classification, 'start_date', lr.start_date,
        'end_date', lr.end_date, 'leave_days', lr.leave_days) order by lr.start_date, lr.id)
        from public.leave_requests lr where lr.employee_id = e.id and lr.company_id = e.company_id
          and lr.branch_id = e.workplace_branch_id and lr.status = 'APPROVED'
          and lr.start_date <= p_period_end and lr.end_date >= p_period_start), '[]'::jsonb),
      'due_approved_deductions', coalesce((select jsonb_agg(jsonb_build_object(
        'deduction_id', d.id, 'installment_id', di.id, 'deduction_type', d.deduction_type,
        'scheduled_amount', di.scheduled_amount, 'due_period', di.due_period,
        'outstanding_balance', d.principal_amount - d.amount_deducted) order by di.due_period, d.id)
        from public.employee_deductions d join public.deduction_installments di on di.deduction_id = d.id and di.employee_id = d.employee_id
        where d.employee_id = e.id and d.status = 'ACTIVE' and di.due_period between p_period_start and p_period_end
          and di.scheduled_amount > 0), '[]'::jsonb),
      'approved_earnings', coalesce((select jsonb_agg(jsonb_build_object(
        'earning_input_id', pi.id, 'earning_type', pi.earning_type, 'amount', pi.amount,
        'taxable_for_paye', pi.taxable_for_paye, 'source_reference', pi.source_reference, 'description', pi.description, 'approved_by', pi.approved_by, 'approved_at', pi.approved_at, 'created_at', pi.created_at)
        order by pi.earning_type, pi.created_at, pi.id)
        from public.payroll_earning_inputs pi where pi.employee_id=e.id and pi.company_id=e.company_id
          and pi.period_start=p_period_start and pi.period_end=p_period_end and pi.status='APPROVED'), '[]'::jsonb),
      'input_warnings', to_jsonb(array_remove(array[
        case when comp.id is null then 'MISSING_EFFECTIVE_COMPENSATION' end,
        case when (select count(*) from public.employee_compensation ecx where ecx.employee_id=e.id
          and ecx.company_id=e.company_id and ecx.workplace_branch_id=e.workplace_branch_id
          and ecx.effective_from<=p_period_start and (ecx.effective_to is null or ecx.effective_to>=p_period_end)) <> 1
          then 'COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD' end,
        case when exists(select 1 from public.payroll_earning_inputs pending where pending.employee_id=e.id
          and pending.company_id=e.company_id and pending.period_start=p_period_start and pending.period_end=p_period_end
          and pending.status='SUBMITTED') then 'EARNING_INPUTS_AWAITING_APPROVAL' end,
        case when exists(select 1 from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
          and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED'
          and lr.start_date<=p_period_end and lr.end_date>=p_period_start
          and (lr.start_date<p_period_start or lr.end_date>p_period_end))
          then 'CROSS_PERIOD_LEAVE_REQUIRES_REVIEW' end,
        case when ae.id is not null and (
          coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
            and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='PAID'
            and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0) <> ae.paid_leave_days
          or coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
            and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='UNPAID'
            and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0) <> ae.unpaid_leave_days)
          then 'APPROVED_LEAVE_NOT_RECONCILED_WITH_ATTENDANCE' end,
        case when exists(select 1 from public.leave_requests la join public.leave_requests lb
          on lb.employee_id=la.employee_id and lb.id>la.id and lb.status='APPROVED'
          and daterange(lb.start_date,lb.end_date,'[]') && daterange(la.start_date,la.end_date,'[]')
          where la.employee_id=e.id and la.status='APPROVED' and la.start_date<=p_period_end and la.end_date>=p_period_start)
          then 'OVERLAPPING_APPROVED_LEAVE' end,
        case when ae.id is null then 'MISSING_APPROVED_ATTENDANCE_ENTRY' end,
        case when comp.salary_frequency is distinct from 'MONTHLY' then 'NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE' end
      ], null))
    ) order by e.employee_number), '[]'::jsonb)
  ) into v_result
  from public.employees e
  left join lateral (select ec.* from public.employee_compensation ec
    where ec.employee_id = e.id and ec.company_id = e.company_id and ec.workplace_branch_id = e.workplace_branch_id
      and ec.effective_from <= p_period_end and (ec.effective_to is null or ec.effective_to >= p_period_start)
    order by ec.effective_from desc, ec.created_at desc limit 1) comp on true
  left join public.attendance_entries ae on ae.attendance_period_id = v_attendance.id and ae.employee_id = e.id
  where e.portfolio_id = v_portfolio_id and e.company_id = p_company_id and e.workplace_branch_id = p_branch_id
    and e.approval_status = 'APPROVED' and e.employment_status = 'ACTIVE'
    and e.contract_start_date <= p_period_end and (e.contract_end_date is null or e.contract_end_date >= p_period_start);
  return v_result;
end;
$$;

revoke all on function public.payroll_preview_inputs(uuid,uuid,date,date) from public,anon;
grant execute on function public.payroll_preview_inputs(uuid,uuid,date,date) to authenticated;

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
      'compensation_effective_from', v_employee->>'compensation_effective_from',
      'allowance_tax_treatment', v_employee->'allowance_tax_treatment',
      'attendance_input', v_employee->'attendance',
      'approved_leave_requests', coalesce(v_employee->'approved_leave_requests','[]'::jsonb),
      'approved_earning_items', coalesce(v_employee->'approved_earnings','[]'::jsonb),
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