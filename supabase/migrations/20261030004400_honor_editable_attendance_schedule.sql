-- Attendance is the approved monthly source for each employee's scheduled-day
-- total. The standard UI value is 22, but HR/BM may adjust it for a month.
-- Keep date-based employment/compensation proration while accepting that
-- explicit attendance schedule instead of treating it as a calendar error.
create or replace function public.payroll_preview_inputs(
  p_company_id uuid, p_branch_id uuid, p_period_start date, p_period_end date
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_result jsonb;
  v_item jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_proration jsonb;
  v_warnings jsonb;
  v_dates date[];
begin
  v_result := public.payroll_preview_inputs_legacy(p_company_id, p_branch_id, p_period_start, p_period_end);
  select coalesce(array_agg(scheduled_date::date order by scheduled_date), '{}'::date[]) into v_dates
    from generate_series(p_period_start::timestamp, p_period_end::timestamp, interval '1 day') as days(scheduled_date)
    where extract(isodow from scheduled_date) between 1 and 5;
  for v_item in select value from jsonb_array_elements(coalesce(v_result -> 'items', '[]'::jsonb)) loop
    v_warnings := coalesce(v_item -> 'input_warnings', '[]'::jsonb);
    v_proration := app_private.payroll_employee_proration((v_item ->> 'employee_id')::uuid,
      p_period_start, p_period_end, v_dates);
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

comment on function public.payroll_preview_inputs(uuid, uuid, date, date) is
  'Uses employee-entered monthly attendance totals (22 scheduled days by default) and date-based weekday proration; retains input, compensation, tenant, and approval checks.';
