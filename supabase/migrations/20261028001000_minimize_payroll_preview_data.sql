-- Secure read-only bridge from approved HR records into payroll preparation.
-- No payroll calculation or finalization is performed by this preview RPC.

create or replace function public.payroll_preview_inputs(
  p_company_id uuid,
  p_branch_id uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_portfolio_id uuid;
  v_attendance public.attendance_periods%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception using errcode = '22023', message = 'A valid payroll period is required.';
  end if;

  select b.portfolio_id into v_portfolio_id
  from public.branches b
  where b.company_id = p_company_id and b.id = p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare', v_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Payroll inputs are not authorized for this branch.';
  end if;

  select ap.* into v_attendance
  from public.attendance_periods ap
  where ap.portfolio_id = v_portfolio_id and ap.company_id = p_company_id and ap.branch_id = p_branch_id
    and ap.period_start = p_period_start and ap.period_end = p_period_end;
  if not found or v_attendance.status <> 'APPROVED' then
    raise exception using errcode = '22023', message = 'An approved attendance period matching the payroll dates is required.';
  end if;

  select jsonb_build_object(
    'portfolio_id', v_portfolio_id,
    'company_id', p_company_id,
    'branch_id', p_branch_id,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'attendance_period_id', v_attendance.id,
    'attendance_approved_at', v_attendance.reviewed_at,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'employee_id', e.id,
      'employee_number', e.employee_number,
      'employee_name', concat_ws(' ', e.first_name, nullif(e.middle_name, ''), e.last_name),
      'contract_type', e.contract_type,
      'employment_type', e.employment_type,
      'salary_frequency', comp.salary_frequency,
      'compensation_effective_from', comp.effective_from,
      'basic_pay', comp.basic_pay,
      'housing_allowance', comp.housing_allowance,
      'meal_allowance', comp.meal_allowance,
      'transport_allowance', comp.transport_allowance,
      'other_allowances', comp.other_allowances,
      'overtime_eligible', comp.overtime_eligible,
      'allowance_tax_treatment', comp.allowance_tax_treatment,
      'attendance', case when ae.id is null then null else jsonb_build_object(
        'scheduled_working_days', ae.scheduled_working_days,
        'actual_days_worked', ae.actual_days_worked,
        'paid_leave_days', ae.paid_leave_days,
        'unpaid_leave_days', ae.unpaid_leave_days,
        'other_payable_absence_days', ae.other_payable_absence_days
      ) end,
      'approved_leave_requests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'leave_request_id', lr.id,
          'pay_classification', lr.pay_classification,
          'start_date', lr.start_date,
          'end_date', lr.end_date,
          'leave_days', lr.leave_days
        ) order by lr.start_date, lr.id)
        from public.leave_requests lr
        where lr.employee_id = e.id and lr.company_id = e.company_id and lr.branch_id = e.workplace_branch_id
          and lr.status = 'APPROVED' and lr.start_date <= p_period_end and lr.end_date >= p_period_start
      ), '[]'::jsonb),
      'due_approved_deductions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'deduction_id', d.id,
          'installment_id', di.id,
          'deduction_type', d.deduction_type,
          'scheduled_amount', di.scheduled_amount,
          'due_period', di.due_period,
          'outstanding_balance', d.principal_amount - d.amount_deducted
        ) order by di.due_period, d.id)
        from public.employee_deductions d
        join public.deduction_installments di on di.deduction_id = d.id and di.employee_id = d.employee_id
        where d.employee_id = e.id and d.status = 'ACTIVE'
          and di.due_period between p_period_start and p_period_end
          and di.scheduled_amount > 0
      ), '[]'::jsonb),
      'input_warnings', to_jsonb(array_remove(array[
        case when comp.id is null then 'MISSING_EFFECTIVE_COMPENSATION' end,
        case when ae.id is null then 'MISSING_APPROVED_ATTENDANCE_ENTRY' end,
        case when comp.salary_frequency is distinct from 'MONTHLY' then 'NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE' end
      ], null))
    ) order by e.employee_number), '[]'::jsonb)
  ) into v_result
  from public.employees e
  left join lateral (
    select ec.* from public.employee_compensation ec
    where ec.employee_id = e.id and ec.company_id = e.company_id and ec.workplace_branch_id = e.workplace_branch_id
      and ec.effective_from <= p_period_end and (ec.effective_to is null or ec.effective_to >= p_period_start)
    order by ec.effective_from desc, ec.created_at desc limit 1
  ) comp on true
  left join public.attendance_entries ae on ae.attendance_period_id = v_attendance.id and ae.employee_id = e.id
  where e.portfolio_id = v_portfolio_id and e.company_id = p_company_id and e.workplace_branch_id = p_branch_id
    and e.approval_status = 'APPROVED'
    and e.contract_start_date <= p_period_end
    and (e.contract_end_date is null or e.contract_end_date >= p_period_start);

  return v_result;
end;
$$;

revoke all on function public.payroll_preview_inputs(uuid, uuid, date, date) from public, anon;
grant execute on function public.payroll_preview_inputs(uuid, uuid, date, date) to authenticated;

comment on function public.payroll_preview_inputs(uuid, uuid, date, date) is
  'Permission-checked, read-only payroll input snapshot. Uses approved attendance and approved leave evidence; attendance leave-day totals remain the single payroll adjustment source to prevent double deduction. Does not calculate or persist payroll.';
