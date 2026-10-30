-- Approved branch schedules are the sole source of scheduled-day proration.
-- A monthly attendance total alone cannot identify working dates around a hire
-- date, compensation change, branch schedule, or public holiday.

create table public.branch_work_calendars (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  period_start date not null,
  period_end date not null,
  scheduled_work_dates date[] not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED')),
  reason text not null,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict,
  check (period_start = date_trunc('month', period_start)::date
    and period_end = (period_start + interval '1 month - 1 day')::date),
  check (cardinality(scheduled_work_dates) between 1 and 31),
  check ((status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (status <> 'PENDING' and reviewed_by is not null and reviewed_at is not null))
);
create unique index branch_work_calendars_one_pending
  on public.branch_work_calendars(portfolio_id, company_id, branch_id, period_start) where status = 'PENDING';
create unique index branch_work_calendars_one_approved
  on public.branch_work_calendars(portfolio_id, company_id, branch_id, period_start) where status = 'APPROVED';
create index branch_work_calendars_scope_idx
  on public.branch_work_calendars(portfolio_id, company_id, branch_id, period_start desc);
alter table public.branch_work_calendars enable row level security;
revoke all on public.branch_work_calendars from public, anon, authenticated;
grant select on public.branch_work_calendars to authenticated;
create policy branch_work_calendars_read_assigned on public.branch_work_calendars
  for select to authenticated using (
    app_private.has_permission('branch.view', portfolio_id, company_id, branch_id)
  );

create or replace function public.branch_work_calendar_capabilities(p_company_id uuid, p_branch_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_portfolio_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('can_manage', false); end if;
  select b.portfolio_id into v_portfolio_id from public.branches b
    where b.company_id = p_company_id and b.id = p_branch_id;
  if not found then return jsonb_build_object('can_manage', false); end if;
  return jsonb_build_object('can_manage', app_private.has_permission('branch.edit', v_portfolio_id, p_company_id, p_branch_id));
end;
$$;

create or replace function public.branch_work_calendar_request(
  p_company_id uuid, p_branch_id uuid, p_period_start date, p_period_end date,
  p_scheduled_work_dates date[], p_reason text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_portfolio_id uuid; v_id uuid; v_dates date[];
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null
    or p_period_start <> date_trunc('month', p_period_start)::date
    or p_period_end <> (p_period_start + interval '1 month - 1 day')::date
    or p_scheduled_work_dates is null or cardinality(p_scheduled_work_dates) not between 1 and 31
    or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'A complete calendar month, scheduled dates, and reason are required.';
  end if;
  select b.portfolio_id into v_portfolio_id from public.branches b
    where b.company_id = p_company_id and b.id = p_branch_id;
  if not found or not app_private.has_permission('branch.edit', v_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Work calendar management is not authorized for this branch.';
  end if;
  select array_agg(d order by d) into v_dates from (select distinct unnest(p_scheduled_work_dates) d) dates;
  if cardinality(v_dates) <> cardinality(p_scheduled_work_dates)
     or exists (select 1 from unnest(p_scheduled_work_dates) d where d is null)
     or exists (select 1 from unnest(v_dates) d where d < p_period_start or d > p_period_end) then
    raise exception using errcode = '22023', message = 'Scheduled dates must be unique dates inside the selected month.';
  end if;
  insert into public.branch_work_calendars(
    portfolio_id, company_id, branch_id, period_start, period_end, scheduled_work_dates, reason, requested_by
  ) values (
    v_portfolio_id, p_company_id, p_branch_id, p_period_start, p_period_end, v_dates, btrim(p_reason), auth.uid()
  ) returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_portfolio_id, p_company_id, p_branch_id, auth.uid(), 'WORK_CALENDAR_SUBMITTED', 'payroll', v_id::text,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'scheduled_days', cardinality(v_dates)));
  return v_id;
end;
$$;

create or replace function public.branch_work_calendar_review(p_calendar_id uuid, p_decision text, p_reason text default null)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.branch_work_calendars%rowtype;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('APPROVE', 'RETURN')
     or (p_decision = 'RETURN' and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid calendar decision and return reason are required.';
  end if;
  select * into v from public.branch_work_calendars where id = p_calendar_id for update;
  if not found or v.status <> 'PENDING' or v.requested_by = auth.uid()
     or not app_private.has_permission('branch.edit', v.portfolio_id, v.company_id, v.branch_id)
     or not app_private.has_permission('branch.view', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode = '42501', message = 'Independent work calendar review is not authorized.';
  end if;
  if p_decision = 'APPROVE' then
    if exists (select 1 from public.payroll_runs r join public.payroll_periods p on p.id = r.payroll_period_id
      where r.portfolio_id = v.portfolio_id and r.company_id = v.company_id and r.branch_id = v.branch_id
        and p.period_start = v.period_start and p.period_end = v.period_end
        and r.status not in ('CANCELED', 'REVERSED')) then
      raise exception using errcode = '55000', message = 'The work calendar cannot change after a payroll run exists for this month.';
    end if;
    update public.branch_work_calendars set status = 'SUPERSEDED', reviewed_by = auth.uid(), reviewed_at = now(),
      review_reason = 'Replaced by an approved calendar version.'
      where portfolio_id = v.portfolio_id and company_id = v.company_id and branch_id = v.branch_id
        and period_start = v.period_start and status = 'APPROVED';
    update public.branch_work_calendars set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = null
      where id = v.id;
  else
    update public.branch_work_calendars set status = 'RETURNED', reviewed_by = auth.uid(), reviewed_at = now(),
      review_reason = btrim(p_reason) where id = v.id;
  end if;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v.portfolio_id, v.company_id, v.branch_id, auth.uid(), 'WORK_CALENDAR_' || p_decision, 'payroll', v.id::text,
    jsonb_build_object('period_start', v.period_start, 'scheduled_days', cardinality(v.scheduled_work_dates), 'reason', nullif(btrim(p_reason), '')));
  return v.id;
end;
$$;

revoke all on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text) from public, anon;
revoke all on function public.branch_work_calendar_review(uuid, text, text) from public, anon;
revoke all on function public.branch_work_calendar_capabilities(uuid, uuid) from public, anon;
grant execute on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text) to authenticated;
grant execute on function public.branch_work_calendar_review(uuid, text, text) to authenticated;
grant execute on function public.branch_work_calendar_capabilities(uuid, uuid) to authenticated;

create or replace function app_private.payroll_employee_proration(
  p_employee_id uuid, p_period_start date, p_period_end date, p_scheduled_dates date[]
)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_employee public.employees%rowtype;
  v_total_days integer := cardinality(p_scheduled_dates);
  v_eligible date[];
  v_eligible_days integer;
  v_gap_days integer;
  v_overlap_days integer;
  v_segment_count integer;
  v_segments jsonb;
  v_basic numeric(14,2);
  v_allowances jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_key text;
  v_missing_rule boolean;
  v_value numeric(14,2);
  v_needs_proration boolean;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if not found then return jsonb_build_object('warnings', jsonb_build_array('EMPLOYEE_NOT_FOUND')); end if;
  select coalesce(array_agg(d order by d), '{}'::date[]) into v_eligible
    from unnest(p_scheduled_dates) d
    where d between greatest(p_period_start, v_employee.contract_start_date)
      and least(p_period_end, coalesce(v_employee.contract_end_date, p_period_end));
  v_eligible_days := cardinality(v_eligible);
  if v_total_days <= 0 or v_eligible_days <= 0 then
    return jsonb_build_object('eligible_scheduled_days', v_eligible_days, 'warnings', jsonb_build_array('NO_ELIGIBLE_SCHEDULED_WORK_DAYS'));
  end if;
  select count(*) filter (where c.matches = 0), count(*) filter (where c.matches > 1)
    into v_gap_days, v_overlap_days
    from unnest(v_eligible) d
    cross join lateral (select count(*)::integer matches from public.employee_compensation ec
      where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
        and ec.workplace_branch_id = v_employee.workplace_branch_id
        and ec.effective_from <= d and (ec.effective_to is null or ec.effective_to >= d)) c;
  if v_gap_days > 0 then v_warnings := v_warnings || jsonb_build_array('COMPENSATION_GAP_FOR_SCHEDULED_DAYS'); end if;
  if v_overlap_days > 0 then v_warnings := v_warnings || jsonb_build_array('OVERLAPPING_COMPENSATION_FOR_SCHEDULED_DAYS'); end if;
  select count(*)::integer,
    round(sum(ec.basic_pay * covered.days / v_total_days)::numeric, 2),
    jsonb_agg(jsonb_build_object('effective_from', ec.effective_from, 'effective_to', ec.effective_to,
      'monthly_basic_pay', ec.basic_pay, 'eligible_scheduled_days', covered.days,
      'prorated_basic_pay', round(ec.basic_pay * covered.days / v_total_days, 2)) order by ec.effective_from)
    into v_segment_count, v_basic, v_segments
    from public.employee_compensation ec
    cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
      and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0;
  v_needs_proration := v_eligible_days < v_total_days or coalesce(v_segment_count, 0) > 1;
  foreach v_key in array array['housing_allowance', 'meal_allowance', 'transport_allowance', 'other_allowances'] loop
    select exists (
      select 1 from public.employee_compensation ec
      cross join lateral (select count(*)::integer days from unnest(v_eligible) d
        where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
      where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
        and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0
        and case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end > 0
        and (ec.allowance_proration_rules ->> v_key) is distinct from 'SCHEDULED_DAYS'
    ) into v_missing_rule;
    if v_needs_proration and v_missing_rule then
      v_warnings := v_warnings || jsonb_build_array('ALLOWANCE_PRORATION_RULE_REQUIRED');
      continue;
    end if;
    if v_needs_proration then
      select round(coalesce(sum((case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end) * covered.days / v_total_days), 0), 2)
        into v_value from public.employee_compensation ec
        cross join lateral (select count(*)::integer days from unnest(v_eligible) d
          where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
        where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
          and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0;
    else
      select case v_key when 'housing_allowance' then ec.housing_allowance when 'meal_allowance' then ec.meal_allowance
          when 'transport_allowance' then ec.transport_allowance else ec.other_allowances end
        into v_value from public.employee_compensation ec
        where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
          and ec.workplace_branch_id = v_employee.workplace_branch_id and ec.effective_from <= p_period_start
          and (ec.effective_to is null or ec.effective_to >= p_period_end) limit 1;
    end if;
    v_allowances := v_allowances || jsonb_build_object(v_key, coalesce(v_value, 0));
  end loop;
  if v_segment_count > 1 and exists (
    select 1 from public.employee_compensation ec
    cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
      and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0
    group by ec.allowance_tax_treatment having count(distinct ec.allowance_tax_treatment) > 1
  ) then v_warnings := v_warnings || jsonb_build_array('ALLOWANCE_TAX_TREATMENT_CHANGED_DURING_PERIOD'); end if;
  if v_segment_count > 1 and exists (
    select 1 from public.employee_compensation ec
    cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
      and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0
    group by ec.unpaid_leave_deduction_method having count(distinct ec.unpaid_leave_deduction_method) > 1
  ) then v_warnings := v_warnings || jsonb_build_array('UNPAID_LEAVE_RULE_CHANGED_DURING_PERIOD'); end if;
  if exists (
    select 1 from public.employee_compensation ec
    cross join lateral (select count(*)::integer days from unnest(v_eligible) d
      where d >= ec.effective_from and (ec.effective_to is null or d <= ec.effective_to)) covered
    where ec.employee_id = v_employee.id and ec.company_id = v_employee.company_id
      and ec.workplace_branch_id = v_employee.workplace_branch_id and covered.days > 0
      and ec.salary_frequency <> 'MONTHLY'
  ) then v_warnings := v_warnings || jsonb_build_array('NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE'); end if;
  return jsonb_build_object('eligible_scheduled_days', v_eligible_days, 'total_scheduled_days', v_total_days,
    'basic_pay', coalesce(v_basic, 0), 'allowances', v_allowances, 'segments', coalesce(v_segments, '[]'::jsonb),
    'rounding', 'PostgreSQL NUMERIC round to 2 decimal places (half away from zero)', 'warnings', v_warnings,
    'valid_compensation', v_gap_days = 0 and v_overlap_days = 0);
end;
$$;
revoke all on function app_private.payroll_employee_proration(uuid, date, date, date[]) from public, anon, authenticated;

alter function public.payroll_preview_inputs(uuid, uuid, date, date) rename to payroll_preview_inputs_legacy;
revoke all on function public.payroll_preview_inputs_legacy(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.payroll_preview_inputs(p_company_id uuid, p_branch_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_result jsonb;
  v_calendar public.branch_work_calendars%rowtype;
  v_item jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_proration jsonb;
  v_warnings jsonb;
  v_schedule_days numeric;
  v_calendar_found boolean := false;
begin
  v_result := public.payroll_preview_inputs_legacy(p_company_id, p_branch_id, p_period_start, p_period_end);
  select * into v_calendar from public.branch_work_calendars c
    where c.company_id = p_company_id and c.branch_id = p_branch_id and c.period_start = p_period_start
      and c.period_end = p_period_end and c.status = 'APPROVED';
  v_calendar_found := found;
  for v_item in select value from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb)) loop
    v_warnings := coalesce(v_item -> 'input_warnings', '[]'::jsonb);
    if not v_calendar_found then
      v_warnings := v_warnings || jsonb_build_array('MISSING_APPROVED_BRANCH_WORK_CALENDAR');
      v_updated := v_updated || jsonb_build_array(jsonb_set(v_item, '{input_warnings}', v_warnings));
      continue;
    end if;
    v_proration := app_private.payroll_employee_proration((v_item ->> 'employee_id')::uuid,
      p_period_start, p_period_end, v_calendar.scheduled_work_dates);
    select (v_item #>> '{attendance,scheduled_working_days}')::numeric into v_schedule_days;
    if v_schedule_days is distinct from (v_proration ->> 'eligible_scheduled_days')::numeric then
      v_proration := jsonb_set(v_proration, '{warnings}', (v_proration -> 'warnings') || jsonb_build_array('ATTENDANCE_SCHEDULE_MISMATCH'));
    end if;
    if coalesce((v_proration ->> 'valid_compensation')::boolean, false) then
      select coalesce(jsonb_agg(value), '[]'::jsonb) into v_warnings
        from jsonb_array_elements_text(v_warnings) w(value)
        where value not in ('MISSING_EFFECTIVE_COMPENSATION', 'COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD');
      v_item := jsonb_set(v_item, '{basic_pay}', to_jsonb((v_proration ->> 'basic_pay')::numeric));
      v_item := jsonb_set(v_item, '{housing_allowance}', coalesce(v_proration #> '{allowances,housing_allowance}', '0'::jsonb));
      v_item := jsonb_set(v_item, '{meal_allowance}', coalesce(v_proration #> '{allowances,meal_allowance}', '0'::jsonb));
      v_item := jsonb_set(v_item, '{transport_allowance}', coalesce(v_proration #> '{allowances,transport_allowance}', '0'::jsonb));
      v_item := jsonb_set(v_item, '{other_allowances}', coalesce(v_proration #> '{allowances,other_allowances}', '0'::jsonb));
    end if;
    v_warnings := coalesce(v_warnings, '[]'::jsonb) || coalesce(v_proration -> 'warnings', '[]'::jsonb);
    v_item := jsonb_set(v_item, '{input_warnings}', v_warnings);
    v_item := jsonb_set(v_item, '{basic_salary_proration}', v_proration);
    v_updated := v_updated || jsonb_build_array(v_item);
  end loop;
  return jsonb_set(v_result, '{items}', v_updated);
end;
$$;

revoke all on function public.payroll_preview_inputs(uuid, uuid, date, date) from public, anon;
grant execute on function public.payroll_preview_inputs(uuid, uuid, date, date) to authenticated;
grant execute on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text) to authenticated;
grant execute on function public.branch_work_calendar_review(uuid, text, text) to authenticated;

comment on table public.branch_work_calendars is 'Approved, branch-specific scheduled dates used as the denominator and hire-date eligibility source for monthly payroll proration.';
comment on function public.payroll_preview_inputs(uuid, uuid, date, date) is 'Requires approved attendance and branch calendar; prorates monthly basic pay across eligible scheduled work dates and blocks missing/overlapping compensation or unresolved allowance rules.';


-- Persist the exact calendar/compensation proration inputs in each immutable payroll line snapshot.
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
      'basic_salary_proration', v_employee->'basic_salary_proration',
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
    'period_end',v_period.period_end,'calculation_version','POSTGRES_NUMERIC_ZM_2026_V2_SCHEDULED_DAY_PRORATION',
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
    'POSTGRES_NUMERIC_ZM_2026_V2_SCHEDULED_DAY_PRORATION',v_rule.id,v_ids,v_snapshot
  );
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values (v_run.portfolio_id,v_run.company_id,v_run.branch_id,auth.uid(),'PAYROLL_CALCULATED','payroll',v_run.id::text,
    jsonb_build_object('version',v_version,'employees',jsonb_array_length(v_lines),'rules',to_jsonb(v_ids),'idempotency_key',btrim(p_idempotency_key)));
  return v_snapshot;
end;
$$;

revoke all on function public.payroll_calculate(uuid, text) from public, anon;
grant execute on function public.payroll_calculate(uuid, text) to authenticated;
