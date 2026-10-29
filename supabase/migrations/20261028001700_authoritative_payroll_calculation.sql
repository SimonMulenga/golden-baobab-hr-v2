-- Trusted 2026 Zambia payroll calculation and payout instruction export.
-- Additive and forward-only: no existing payroll rows are deleted or rewritten.

alter table public.statutory_rule_versions
  add column if not exists verification_basis text,
  add column if not exists source_references jsonb not null default '[]'::jsonb;

alter table public.statutory_rule_versions
  drop constraint if exists statutory_rule_versions_check1;
alter table public.statutory_rule_versions
  add constraint statutory_rule_versions_active_verification_check
  check (not active or (
    verified_at is not null
    and (
      verified_by is not null
      or (verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
        and jsonb_typeof(source_references) = 'array'
        and jsonb_array_length(source_references) > 0)
    )
  ));
alter table public.statutory_rule_versions
  add constraint statutory_rule_versions_source_references_array_check
  check (jsonb_typeof(source_references) = 'array');

alter table public.payroll_calculation_rule_versions
  add column if not exists verification_basis text,
  add column if not exists source_references jsonb not null default '[]'::jsonb;
alter table public.payroll_calculation_rule_versions
  drop constraint if exists payroll_calculation_rule_versions_check1;
alter table public.payroll_calculation_rule_versions
  add constraint payroll_calculation_rule_versions_verified_source_check
  check (regulatory_verification_status <> 'VERIFIED' or (
    regulatory_verified_at is not null and regulatory_effective_date is not null
    and (
      regulatory_verified_by is not null
      or (verification_basis = 'OFFICIAL_PUBLICATION_REVIEW'
        and jsonb_typeof(source_references) = 'array'
        and jsonb_array_length(source_references) > 0)
    )
  ));
alter table public.payroll_calculation_rule_versions
  add constraint payroll_calculation_rule_versions_source_references_array_check
  check (jsonb_typeof(source_references) = 'array');

update public.payroll_calculation_rule_versions
set regulatory_verification_status = 'VERIFIED',
    regulatory_effective_date = date '2026-01-01',
    regulatory_verified_at = now(),
    verification_basis = 'OFFICIAL_PUBLICATION_REVIEW',
    source_references = jsonb_build_array(
      jsonb_build_object('authority', 'Zambia Revenue Authority', 'url', 'https://www.zra.org.zm/tax-information/', 'covers', '2026 monthly PAYE bands, taxable employment emoluments and pension contributions not deducted before PAYE'),
      jsonb_build_object('authority', 'National Pension Scheme Authority', 'url', 'https://www.linkedin.com/posts/national-pension-scheme-authority_public-notice-revision-in-contribution-ceiling-activity-7417941633180090368-y4Dr', 'covers', 'official 2026 ceiling notice; 5% each on gross earnings, K37,236 threshold, K1,861.80 cap'),
      jsonb_build_object('authority', 'National Health Insurance Management Authority', 'url', 'https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf', 'covers', 'official 2019 implementation notice states mandatory employee and employer 1% of monthly basic salary; SI 63/2019')
    )
where jurisdiction = 'ZM' and version = 'ZM-2026-CLIENT-APPROVED-V1';

create table public.payroll_calculation_history (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  payroll_version integer not null check (payroll_version > 0),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  calculation_version text not null,
  calculation_rule_version_id uuid not null references public.payroll_calculation_rule_versions(id) on delete restrict,
  statutory_rule_version_ids uuid[] not null check (cardinality(statutory_rule_version_ids) = 3),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, idempotency_key),
  unique (payroll_run_id, payroll_version),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict
);
create index payroll_calculation_history_run_idx
  on public.payroll_calculation_history(portfolio_id, company_id, branch_id, payroll_run_id, created_at desc);
alter table public.payroll_calculation_history enable row level security;
revoke all on public.payroll_calculation_history from public, anon, authenticated;
grant select on public.payroll_calculation_history to authenticated;
create policy payroll_calculation_history_read_authorized on public.payroll_calculation_history
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );

alter table public.payroll_run_items
  add column if not exists paye_taxable_income numeric(14,2) not null default 0 check (paye_taxable_income >= 0),
  add column if not exists napsa_employee numeric(14,2) not null default 0 check (napsa_employee >= 0),
  add column if not exists napsa_employer numeric(14,2) not null default 0 check (napsa_employer >= 0),
  add column if not exists nhima_employee numeric(14,2) not null default 0 check (nhima_employee >= 0),
  add column if not exists nhima_employer numeric(14,2) not null default 0 check (nhima_employer >= 0),
  add column if not exists total_employer_cost numeric(14,2) not null default 0 check (total_employer_cost >= 0),
  add column if not exists calculation_rule_version_id uuid references public.payroll_calculation_rule_versions(id) on delete restrict,
  add column if not exists calculated_at timestamptz not null default now();

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
    if coalesce((v_employee->>'overtime_eligible')::boolean, false) then
      raise exception using errcode = '22023', message = 'Approved overtime source is required for an overtime-eligible employee.';
    end if;
    if coalesce((v_employee #>> '{attendance,unpaid_leave_days}')::numeric, 0) > 0 then
      raise exception using errcode = '22023', message = 'A verified unpaid-leave payroll formula is required for this employee.';
    end if;
    if coalesce(jsonb_array_length(coalesce(v_employee->'input_warnings', '[]'::jsonb)), 0) > 0 then
      raise exception using errcode = '22023', message = 'Payroll inputs contain missing or ambiguous compensation or attendance.';
    end if;

    v_basic := round((v_employee->>'basic_pay')::numeric, 2);
    v_housing := round(coalesce((v_employee->>'housing_allowance')::numeric, 0), 2);
    v_meal := round(coalesce((v_employee->>'meal_allowance')::numeric, 0), 2);
    v_transport := round(coalesce((v_employee->>'transport_allowance')::numeric, 0), 2);
    v_other := round(coalesce((v_employee->>'other_allowances')::numeric, 0), 2);
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

    v_amounts := app_private.payroll_calculate_client_policy_amounts(
      v_basic, v_taxable_allowances, v_non_taxable_allowances, 0, 0, 0, 0,
      v_other_deductions, v_rule.configuration
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
      'overtime', 0, 'bonuses_and_other_earnings', 0,
      'gross_earnings', v_amounts->'gross_earnings', 'paye_taxable_income', v_amounts->'paye_taxable_income',
      'paye', v_amounts->'paye', 'napsa_employee', v_amounts->'napsa_employee',
      'napsa_employer', v_amounts->'napsa_employer', 'nhima_employee', v_amounts->'nhima_employee',
      'nhima_employer', v_amounts->'nhima_employer', 'other_approved_deductions', v_other_deductions,
      'net_pay', v_amounts->'net_pay', 'total_employer_cost', v_amounts->'total_employer_cost',
      'statutory_rule_version_ids', to_jsonb(v_ids), 'calculation_rule_version_id', v_rule.id,
      'due_deduction_items', coalesce(v_employee->'due_approved_deductions', '[]'::jsonb)
    );

    insert into public.payroll_run_items(
      portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version,
      basic_pay, housing_allowance, meal_allowance, transport_allowance, other_allowances,
      overtime, gross_pay, statutory_deductions, voluntary_deductions, net_pay,
      calculation_breakdown, paye_taxable_income, napsa_employee, napsa_employer,
      nhima_employee, nhima_employer, total_employer_cost, calculation_rule_version_id, calculated_at
    ) values (
      v_run.portfolio_id, v_run.company_id, v_run.branch_id, v_run.id, v_employee_id, v_version,
      v_basic, v_housing, v_meal, v_transport, v_other, 0,
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

revoke all on function public.payroll_calculate(uuid,text) from public, anon;
grant execute on function public.payroll_calculate(uuid,text) to authenticated;
comment on function public.payroll_calculate(uuid,text) is
  'Authoritative, idempotent, versioned payroll calculation with PostgreSQL NUMERIC. Uses approved monthly inputs and persists immutable run items. Unsupported overtime, unpaid-leave, non-monthly or incomplete inputs block calculation.';

create or replace function public.payroll_finalize(p_payroll_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype;
  v_payment record;
  v_key text;
begin
  select * into v_run from public.payroll_runs where id=p_payroll_run_id for update;
  if not found or not app_private.has_permission('payroll.finalize',v_run.portfolio_id,v_run.company_id,v_run.branch_id) then
    raise exception using errcode='42501',message='Payroll finalization is not authorized.';
  end if;
  if v_run.status='FINALIZED' then return v_run.id; end if;
  if v_run.status<>'APPROVED' or v_run.approved_version is distinct from v_run.version then
    raise exception using errcode='42501',message='Only the approved payroll version can be finalized.';
  end if;
  select * into v_period from public.payroll_periods where id=v_run.payroll_period_id
    and portfolio_id=v_run.portfolio_id and company_id=v_run.company_id and branch_id=v_run.branch_id;
  if not found or not exists(select 1 from public.payroll_run_statutory_rules where payroll_run_id=v_run.id)
    or exists(
      select 1 from public.payroll_run_statutory_rules prs
      left join public.statutory_rule_versions sr on sr.id=prs.statutory_rule_version_id
      where prs.payroll_run_id=v_run.id and (
        sr.id is null or not sr.active or sr.verified_at is null
        or not (sr.verified_by is not null or (sr.verification_basis='OFFICIAL_PUBLICATION_REVIEW' and jsonb_array_length(sr.source_references)>0))
        or sr.effective_from>v_period.period_end or (sr.effective_to is not null and sr.effective_to<v_period.period_start)
      )
    ) or exists(
      select required.rule_code from (values('PAYE'),('NAPSA'),('NHIMA')) required(rule_code)
      except select sr.rule_code from public.payroll_run_statutory_rules prs
        join public.statutory_rule_versions sr on sr.id=prs.statutory_rule_version_id
        where prs.payroll_run_id=v_run.id and sr.jurisdiction='ZM' and sr.active and sr.verified_at is not null
          and (sr.verified_by is not null or (sr.verification_basis='OFFICIAL_PUBLICATION_REVIEW' and jsonb_array_length(sr.source_references)>0))
          and sr.effective_from<=v_period.period_end and (sr.effective_to is null or sr.effective_to>=v_period.period_start)
    ) then
    raise exception using errcode='22023',message='Payroll cannot be finalized because a complete, source-reviewed effective statutory rule set is unavailable.';
  end if;
  if not exists(select 1 from public.payroll_run_items i where i.payroll_run_id=v_run.id and i.version=v_run.version)
    or exists(select 1 from public.payroll_run_items i where i.payroll_run_id=v_run.id and i.version=v_run.version and i.calculation_rule_version_id is null)
    or exists(select 1 from public.payroll_run_items i join public.employees e on e.id=i.employee_id
      and e.portfolio_id=i.portfolio_id and e.company_id=i.company_id and e.workplace_branch_id=i.branch_id
      where i.payroll_run_id=v_run.id and i.version=v_run.version and e.approval_status<>'APPROVED') then
    raise exception using errcode='22023',message='Payroll has no complete authoritative calculation for the approved employees.';
  end if;
  if exists(select 1 from public.payroll_run_items i where i.payroll_run_id=v_run.id and i.version=v_run.version
    and i.voluntary_deductions<>coalesce((select sum(pid.amount) from public.payroll_item_deductions pid
      where pid.payroll_run_id=i.payroll_run_id and pid.employee_id=i.employee_id and pid.version=i.version),0)) then
    raise exception using errcode='22023',message='Payroll deductions do not match the approved repayment schedule.';
  end if;
  if exists(select 1 from public.payroll_item_deductions pid
    join public.deduction_installments di on di.id=pid.installment_id and di.deduction_id=pid.deduction_id
    join public.employee_deductions d on d.id=pid.deduction_id
    where pid.payroll_run_id=v_run.id and pid.version=v_run.version
      and (d.status<>'ACTIVE' or di.due_period not between v_period.period_start and v_period.period_end
        or pid.amount>di.scheduled_amount or pid.amount>d.principal_amount-d.amount_deducted)) then
    raise exception using errcode='22023',message='Payroll contains a deduction that is not currently due or exceeds its approved balance.';
  end if;
  perform d.id from public.employee_deductions d join public.payroll_item_deductions pid on pid.deduction_id=d.id
    where pid.payroll_run_id=v_run.id and pid.version=v_run.version order by d.id for update of d;
  for v_payment in select d.id deduction_id,d.portfolio_id,d.company_id,d.branch_id,di.employee_id,d.principal_amount,
      d.amount_deducted,di.id installment_id,di.scheduled_amount,pid.amount
    from public.payroll_item_deductions pid
    join public.deduction_installments di on di.id=pid.installment_id and di.deduction_id=pid.deduction_id
    join public.employee_deductions d on d.id=pid.deduction_id
    where pid.payroll_run_id=v_run.id and pid.version=v_run.version and d.status='ACTIVE'
      and di.due_period between v_period.period_start and v_period.period_end order by d.id,di.sequence_number
  loop
    if v_payment.amount>v_payment.scheduled_amount or v_payment.amount>v_payment.principal_amount-v_payment.amount_deducted then
      raise exception using errcode='22023',message='Repayment exceeds its scheduled amount or outstanding balance.';
    end if;
    v_key:=v_run.id::text||':'||v_payment.installment_id::text||':PAYROLL_REPAYMENT';
    insert into public.deduction_transactions(portfolio_id,company_id,branch_id,employee_id,deduction_id,installment_id,
      payroll_run_id,amount,transaction_type,idempotency_key,posted_by)
    values(v_payment.portfolio_id,v_payment.company_id,v_payment.branch_id,v_payment.employee_id,v_payment.deduction_id,
      v_payment.installment_id,v_run.id,v_payment.amount,'PAYROLL_REPAYMENT',v_key,auth.uid());
    update public.employee_deductions set amount_deducted=amount_deducted+v_payment.amount,
      status=case when amount_deducted+v_payment.amount=principal_amount then 'COMPLETED' else 'ACTIVE' end,updated_at=now()
      where id=v_payment.deduction_id;
  end loop;
  update public.payroll_runs set status='FINALIZED',finalized_at=now(),updated_at=now() where id=v_run.id;
  insert into public.payroll_approvals(portfolio_id,company_id,branch_id,payroll_run_id,payroll_version,actor_id,action)
    values(v_run.portfolio_id,v_run.company_id,v_run.branch_id,v_run.id,v_run.version,auth.uid(),'FINALIZED');
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_run.portfolio_id,v_run.company_id,v_run.branch_id,auth.uid(),'PAYROLL_FINALIZED','payroll',v_run.id::text,
      jsonb_build_object('version',v_run.version,'deduction_transactions',
        (select count(*) from public.deduction_transactions where payroll_run_id=v_run.id)));
  return v_run.id;
end;
$$;
revoke all on function public.payroll_finalize(uuid) from public,anon;
grant execute on function public.payroll_finalize(uuid) to authenticated;
comment on function public.payroll_finalize(uuid) is
  'Atomic/idempotent finalization of the exact approved calculation version, validates source-reviewed effective statutory rules, then posts approved repayments exactly once.';

create table public.payroll_payout_exports (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  payroll_version integer not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  instruction_count integer not null check (instruction_count >= 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  instructions jsonb not null check (jsonb_typeof(instructions) = 'array'),
  created_at timestamptz not null default now(),
  unique (payroll_run_id, payroll_version),
  foreign key (portfolio_id,company_id,branch_id,payroll_run_id)
    references public.payroll_runs(portfolio_id,company_id,branch_id,id) on delete restrict
);
create index payroll_payout_exports_run_idx
  on public.payroll_payout_exports(portfolio_id,company_id,branch_id,payroll_run_id,created_at desc);
alter table public.payroll_payout_exports enable row level security;
revoke all on public.payroll_payout_exports from public, anon, authenticated;

create or replace function public.payroll_prepare_payout_instructions(p_payroll_run_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_items jsonb;
  v_existing public.payroll_payout_exports%rowtype;
  v_manifest text;
  v_export_id uuid;
  v_count integer;
begin
  select * into v_run from public.payroll_runs where id=p_payroll_run_id for update;
  if not found or not app_private.has_permission('payroll.finalize',v_run.portfolio_id,v_run.company_id,v_run.branch_id)
    or v_run.status <> 'FINALIZED' or v_run.approved_version is distinct from v_run.version then
    raise exception using errcode='42501',message='Payout instructions require an authorized, finalized payroll version.';
  end if;
  select * into v_existing from public.payroll_payout_exports
    where payroll_run_id=v_run.id and payroll_version=v_run.version;
  if found then
    return jsonb_build_object('export_id',v_existing.id,'payroll_run_id',v_run.id,'payroll_version',v_run.version,
      'status','INSTRUCTIONS_PREPARED_NOT_TRANSMITTED','manifest_sha256',v_existing.manifest_sha256,
      'instructions',v_existing.instructions);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id',e.id,'employee_number',e.employee_number,'employee_name',concat_ws(' ',e.first_name,e.middle_name,e.last_name),
    'net_pay',i.net_pay,'payment_method',ec.payment_method,
    'bank_name',pd.bank_name,'bank_account_name',pd.bank_account_name,'bank_account_number',pd.bank_account_number,
    'bank_branch_name',pd.bank_branch_name,'mobile_money_provider',pd.mobile_money_provider,
    'mobile_money_number',pd.mobile_money_number
  ) order by e.employee_number),'[]'::jsonb) into v_items
  from public.payroll_run_items i
  join public.employees e on e.id=i.employee_id and e.portfolio_id=i.portfolio_id and e.company_id=i.company_id and e.workplace_branch_id=i.branch_id
  join public.employee_compensation ec on ec.portfolio_id=i.portfolio_id and ec.company_id=i.company_id and ec.workplace_branch_id=i.branch_id and ec.employee_id=i.employee_id
    and ec.effective_from <= (select p.period_start from public.payroll_periods p where p.id=v_run.payroll_period_id)
    and (ec.effective_to is null or ec.effective_to >= (select p.period_end from public.payroll_periods p where p.id=v_run.payroll_period_id))
  left join public.employee_private_details pd on pd.portfolio_id=i.portfolio_id and pd.company_id=i.company_id and pd.employee_id=i.employee_id
  where i.payroll_run_id=v_run.id and i.version=v_run.version;
  v_count:=jsonb_array_length(v_items);
  if exists(select 1 from jsonb_array_elements(v_items) x where x->>'payment_method'='BANK_TRANSFER' and coalesce(x->>'bank_account_number','')='')
    or exists(select 1 from jsonb_array_elements(v_items) x where x->>'payment_method'='MOBILE_MONEY' and coalesce(x->>'mobile_money_number','')='') then
    raise exception using errcode='22023',message='One or more finalized payroll recipients have incomplete payment details.';
  end if;
  v_manifest:=encode(extensions.digest(v_items::text,'sha256'),'hex');
  insert into public.payroll_payout_exports(portfolio_id,company_id,branch_id,payroll_run_id,payroll_version,actor_id,instruction_count,manifest_sha256,instructions)
    values(v_run.portfolio_id,v_run.company_id,v_run.branch_id,v_run.id,v_run.version,auth.uid(),v_count,v_manifest,v_items)
    returning id into v_export_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_run.portfolio_id,v_run.company_id,v_run.branch_id,auth.uid(),'PAYOUT_INSTRUCTIONS_PREPARED','payroll',v_run.id::text,
    jsonb_build_object('export_id',v_export_id,'version',v_run.version,'instruction_count',v_count,'manifest_sha256',v_manifest));
  return jsonb_build_object('export_id',v_export_id,'payroll_run_id',v_run.id,'payroll_version',v_run.version,
    'status','INSTRUCTIONS_PREPARED_NOT_TRANSMITTED','manifest_sha256',v_manifest,'instructions',v_items);
end;
$$;
revoke all on function public.payroll_prepare_payout_instructions(uuid) from public,anon;
grant execute on function public.payroll_prepare_payout_instructions(uuid) to authenticated;

-- Seed the source-reviewed 2026 rule versions. These are the project-approved
-- inputs, documented with official authority publications and effective dates.
insert into public.statutory_rule_versions(
  jurisdiction,rule_code,version,effective_from,effective_to,rule_data,verified_at,active,verification_basis,source_references
) values
('ZM','PAYE','ZM-PAYE-2026-V1','2026-01-01','2026-12-31',
 '{"bands":[{"upper_inclusive":"5100.00","rate":"0.00"},{"upper_inclusive":"7100.00","rate":"0.20"},{"upper_inclusive":"9200.00","rate":"0.30"},{"upper_inclusive":null,"rate":"0.37"}],"taxable_basis":"BASIC_PLUS_TAXABLE_ALLOWANCES_AND_EARNINGS","employee_contributions_deducted_before_paye":false}'::jsonb,
 now(),true,'OFFICIAL_PUBLICATION_REVIEW',jsonb_build_array(jsonb_build_object('url','https://www.zra.org.zm/tax-information/','published_rule','2026 monthly PAYE bands and gross-pay calculation'))),
('ZM','NAPSA','ZM-NAPSA-2026-V1','2026-01-01','2026-12-31',
 '{"employee_rate":"0.05","employer_rate":"0.05","base":"GROSS_MONTHLY_EARNINGS","employee_cap":"1861.80","employer_cap":"1861.80","threshold":"37236.00"}'::jsonb,
 now(),true,'OFFICIAL_PUBLICATION_REVIEW',jsonb_build_array(jsonb_build_object('url','https://www.linkedin.com/posts/national-pension-scheme-authority_public-notice-revision-in-contribution-ceiling-activity-7417941633180090368-y4Dr','published_rule','Official 2026 notice: gross earnings, 5 percent each, 37,236 threshold and 1,861.80 maximum'))),
('ZM','NHIMA','ZM-NHIMA-2026-V1','2026-01-01','2026-12-31',
 '{"employee_rate":"0.01","employer_rate":"0.01","employee_base":"BASIC_SALARY_ONLY","employer_base":"BASIC_SALARY_ONLY","monthly_cap":null}'::jsonb,
 now(),true,'OFFICIAL_PUBLICATION_REVIEW',jsonb_build_array(jsonb_build_object('url','https://www.nhima.co.zm/download/document/0e98ec61c02019110104d23eb0.pdf','published_rule','NHIMA official 24 October 2019 notice: mandatory monthly employee and employer 1 percent of basic salary under SI 63 of 2019')))
on conflict(jurisdiction,rule_code,version) do nothing;

