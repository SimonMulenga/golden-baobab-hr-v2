-- Simplify branch payroll preparation without expanding the reviewer role.
-- Existing company/branch membership and RLS scope remain authoritative.

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
  -- Default schedule is Monday to Friday. Attendance retains the editable
  -- 22-day monthly starting value used for leave and worked-day entry.
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

create or replace function public.payroll_review_submission(
  p_payroll_run_id uuid, p_action text, p_expected_version integer, p_reason text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.payroll_runs%rowtype; v_status text; v_event text;
begin
  if auth.uid() is null or p_action is null or p_action not in ('START_REVIEW', 'APPROVE', 'RETURN', 'REJECT')
    or (p_action in ('RETURN', 'REJECT') and nullif(btrim(p_reason), '') is null) then
    raise exception using errcode = '22023', message = 'A valid payroll action and return or rejection reason are required.';
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
    if v.status not in ('SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW')
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
end;
$$;

revoke all on function public.payroll_review_submission(uuid, text, integer, text) from public, anon;
grant execute on function public.payroll_review_submission(uuid, text, integer, text) to authenticated;

-- Earnings are recorded as payroll inputs. The independent payroll approval
-- reviews them together with attendance, leave, deductions and statutory totals.
alter table public.payroll_earning_inputs alter column status set default 'RECORDED';
alter table public.payroll_earning_inputs drop constraint payroll_earning_inputs_status_check;
alter table public.payroll_earning_inputs add constraint payroll_earning_inputs_status_check
  check (status in ('RECORDED', 'SUBMITTED', 'APPROVED', 'REJECTED'));
alter table public.payroll_earning_input_history drop constraint payroll_earning_input_history_action_check;
alter table public.payroll_earning_input_history add constraint payroll_earning_input_history_action_check
  check (action in ('RECORDED', 'SUBMITTED', 'APPROVED', 'REJECTED'));

create or replace function app_private.normalize_new_earning_history()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if new.action = 'SUBMITTED' and exists (
    select 1 from public.payroll_earning_inputs i where i.id = new.earning_input_id and i.status = 'RECORDED'
  ) then
    new.action := 'RECORDED';
  end if;
  return new;
end;
$$;
create trigger payroll_earning_history_recorded_action
  before insert on public.payroll_earning_input_history
  for each row execute function app_private.normalize_new_earning_history();

drop index public.payroll_overtime_daily_unique_idx;
create unique index payroll_overtime_daily_unique_idx on public.payroll_earning_inputs
  (employee_id, overtime_work_date, overtime_day_type)
  where earning_type = 'OVERTIME' and status in ('RECORDED', 'SUBMITTED', 'APPROVED');


-- Branch managers gain payroll preparation only in explicitly assigned branch scope.
create or replace function app_private.has_permission(
  p_permission text,
  p_portfolio_id uuid,
  p_company_id uuid default null,
  p_branch_id uuid default null
)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  with role_permissions(role, permission) as (
    values
      ('PORTFOLIO_ADMIN', 'company.view'), ('PORTFOLIO_ADMIN', 'company.create'), ('PORTFOLIO_ADMIN', 'company.edit'),
      ('PORTFOLIO_ADMIN', 'branch.view'), ('PORTFOLIO_ADMIN', 'branch.create'), ('PORTFOLIO_ADMIN', 'branch.edit'), ('PORTFOLIO_ADMIN', 'branch.calendar.manage'),
      ('PORTFOLIO_ADMIN', 'employee.view'), ('PORTFOLIO_ADMIN', 'employee.create'), ('PORTFOLIO_ADMIN', 'employee.edit'), ('PORTFOLIO_ADMIN', 'employee.submit'), ('PORTFOLIO_ADMIN', 'employee.approve'), ('PORTFOLIO_ADMIN', 'employee.reject'), ('PORTFOLIO_ADMIN', 'employee.import'), ('PORTFOLIO_ADMIN', 'employee.status.manage'), ('PORTFOLIO_ADMIN', 'employee.private.view'), ('PORTFOLIO_ADMIN', 'compensation.view'), ('PORTFOLIO_ADMIN', 'compensation.edit'),
      ('PORTFOLIO_ADMIN', 'attendance.view'), ('PORTFOLIO_ADMIN', 'attendance.manage'), ('PORTFOLIO_ADMIN', 'leave.view'), ('PORTFOLIO_ADMIN', 'leave.request'), ('PORTFOLIO_ADMIN', 'leave.review'),
      ('PORTFOLIO_ADMIN', 'deduction.view'), ('PORTFOLIO_ADMIN', 'deduction.create'), ('PORTFOLIO_ADMIN', 'deduction.review'), ('PORTFOLIO_ADMIN', 'deduction.approve'),
      ('PORTFOLIO_ADMIN', 'payroll.view'), ('PORTFOLIO_ADMIN', 'payroll.prepare'), ('PORTFOLIO_ADMIN', 'payroll.edit'), ('PORTFOLIO_ADMIN', 'payroll.submit'), ('PORTFOLIO_ADMIN', 'payroll.review'), ('PORTFOLIO_ADMIN', 'payroll.approve'), ('PORTFOLIO_ADMIN', 'payroll.finalize'), ('PORTFOLIO_ADMIN', 'payslip.view'), ('PORTFOLIO_ADMIN', 'payslip.issue'), ('PORTFOLIO_ADMIN', 'reports.view'), ('PORTFOLIO_ADMIN', 'reports.export'), ('PORTFOLIO_ADMIN', 'users.view'), ('PORTFOLIO_ADMIN', 'users.manage'),
      ('OVERALL_HR_MANAGER', 'company.view'), ('OVERALL_HR_MANAGER', 'company.edit'), ('OVERALL_HR_MANAGER', 'branch.view'), ('OVERALL_HR_MANAGER', 'branch.create'), ('OVERALL_HR_MANAGER', 'branch.edit'), ('OVERALL_HR_MANAGER', 'branch.calendar.manage'),
      ('OVERALL_HR_MANAGER', 'employee.view'), ('OVERALL_HR_MANAGER', 'employee.create'), ('OVERALL_HR_MANAGER', 'employee.edit'), ('OVERALL_HR_MANAGER', 'employee.submit'), ('OVERALL_HR_MANAGER', 'employee.approve'), ('OVERALL_HR_MANAGER', 'employee.reject'), ('OVERALL_HR_MANAGER', 'employee.import'), ('OVERALL_HR_MANAGER', 'employee.status.manage'), ('OVERALL_HR_MANAGER', 'employee.private.view'), ('OVERALL_HR_MANAGER', 'compensation.view'), ('OVERALL_HR_MANAGER', 'compensation.edit'),
      ('OVERALL_HR_MANAGER', 'attendance.view'), ('OVERALL_HR_MANAGER', 'attendance.manage'), ('OVERALL_HR_MANAGER', 'leave.view'), ('OVERALL_HR_MANAGER', 'leave.request'), ('OVERALL_HR_MANAGER', 'leave.review'),
      ('OVERALL_HR_MANAGER', 'deduction.view'), ('OVERALL_HR_MANAGER', 'deduction.create'), ('OVERALL_HR_MANAGER', 'deduction.review'), ('OVERALL_HR_MANAGER', 'deduction.approve'),
      ('OVERALL_HR_MANAGER', 'payroll.view'), ('OVERALL_HR_MANAGER', 'payroll.prepare'), ('OVERALL_HR_MANAGER', 'payroll.edit'), ('OVERALL_HR_MANAGER', 'payroll.submit'), ('OVERALL_HR_MANAGER', 'payroll.review'), ('OVERALL_HR_MANAGER', 'payroll.approve'), ('OVERALL_HR_MANAGER', 'payroll.finalize'), ('OVERALL_HR_MANAGER', 'payslip.view'), ('OVERALL_HR_MANAGER', 'payslip.issue'), ('OVERALL_HR_MANAGER', 'reports.view'), ('OVERALL_HR_MANAGER', 'reports.export'), ('OVERALL_HR_MANAGER', 'users.view'), ('OVERALL_HR_MANAGER', 'users.manage'),
      ('BRANCH_MANAGER', 'company.view'), ('BRANCH_MANAGER', 'branch.view'), ('BRANCH_MANAGER', 'branch.calendar.manage'), ('BRANCH_MANAGER', 'employee.view'), ('BRANCH_MANAGER', 'employee.create'), ('BRANCH_MANAGER', 'employee.edit'), ('BRANCH_MANAGER', 'employee.submit'), ('BRANCH_MANAGER', 'employee.import'), ('BRANCH_MANAGER', 'compensation.view'), ('BRANCH_MANAGER', 'compensation.edit'),
      ('BRANCH_MANAGER', 'payroll.view'), ('BRANCH_MANAGER', 'payroll.prepare'), ('BRANCH_MANAGER', 'payroll.edit'), ('BRANCH_MANAGER', 'payroll.submit'), ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
      ('PAYROLL_PROCESSOR', 'company.view'), ('PAYROLL_PROCESSOR', 'branch.view'), ('PAYROLL_PROCESSOR', 'employee.view'), ('PAYROLL_PROCESSOR', 'attendance.view'), ('PAYROLL_PROCESSOR', 'leave.view'), ('PAYROLL_PROCESSOR', 'deduction.view'), ('PAYROLL_PROCESSOR', 'payroll.view'), ('PAYROLL_PROCESSOR', 'payroll.prepare'), ('PAYROLL_PROCESSOR', 'payroll.edit'), ('PAYROLL_PROCESSOR', 'payroll.submit'), ('PAYROLL_PROCESSOR', 'reports.view'),
      ('COMPANY_ADMIN', 'company.view'), ('COMPANY_ADMIN', 'company.edit'), ('COMPANY_ADMIN', 'branch.view'), ('COMPANY_ADMIN', 'branch.create'), ('COMPANY_ADMIN', 'branch.edit'),
      ('COMPANY_ADMIN', 'employee.view'), ('COMPANY_ADMIN', 'employee.create'), ('COMPANY_ADMIN', 'employee.submit'), ('COMPANY_ADMIN', 'employee.import'),
      ('COMPANY_ADMIN', 'attendance.view'), ('COMPANY_ADMIN', 'attendance.manage'), ('COMPANY_ADMIN', 'leave.view'), ('COMPANY_ADMIN', 'leave.request'), ('COMPANY_ADMIN', 'leave.review'),
      ('COMPANY_ADMIN', 'deduction.view'), ('COMPANY_ADMIN', 'deduction.create'), ('COMPANY_ADMIN', 'reports.view'), ('COMPANY_ADMIN', 'branch.calendar.manage'),
      ('COMPANY_PAYROLL_PREPARER', 'company.view'), ('COMPANY_PAYROLL_PREPARER', 'branch.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.view'), ('COMPANY_PAYROLL_PREPARER', 'employee.create'), ('COMPANY_PAYROLL_PREPARER', 'employee.edit'), ('COMPANY_PAYROLL_PREPARER', 'employee.submit'), ('COMPANY_PAYROLL_PREPARER', 'employee.import'), ('COMPANY_PAYROLL_PREPARER', 'employee.private.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.view'), ('COMPANY_PAYROLL_PREPARER', 'compensation.edit'), ('COMPANY_PAYROLL_PREPARER', 'attendance.view'), ('COMPANY_PAYROLL_PREPARER', 'leave.view'), ('COMPANY_PAYROLL_PREPARER', 'deduction.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.view'), ('COMPANY_PAYROLL_PREPARER', 'payroll.prepare'), ('COMPANY_PAYROLL_PREPARER', 'payroll.edit'), ('COMPANY_PAYROLL_PREPARER', 'payroll.submit'), ('COMPANY_PAYROLL_PREPARER', 'reports.view'),
      ('COMPANY_PAYROLL_APPROVER', 'company.view'), ('COMPANY_PAYROLL_APPROVER', 'branch.view'), ('COMPANY_PAYROLL_APPROVER', 'employee.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.view'), ('COMPANY_PAYROLL_APPROVER', 'payroll.review'), ('COMPANY_PAYROLL_APPROVER', 'payroll.approve'), ('COMPANY_PAYROLL_APPROVER', 'payroll.finalize'), ('COMPANY_PAYROLL_APPROVER', 'reports.view'), ('COMPANY_PAYROLL_REVIEWER', 'company.view'), ('COMPANY_PAYROLL_REVIEWER', 'branch.view'), ('COMPANY_PAYROLL_REVIEWER', 'employee.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.view'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.review'), ('COMPANY_PAYROLL_REVIEWER', 'payroll.approve'), ('COMPANY_ADMIN', 'reports.export'), ('COMPANY_ADMIN', 'users.view'), ('COMPANY_ADMIN', 'users.manage')
  ),
  company_exists as (
    select exists (select 1 from public.companies c where c.id = p_company_id and c.portfolio_id = p_portfolio_id) as ok
  ),
  branch_exists as (
    select exists (select 1 from public.branches b where b.id = p_branch_id and b.portfolio_id = p_portfolio_id
      and (p_company_id is null or b.company_id = p_company_id)) as ok
  )
  select (
    p_portfolio_id is not null
    and (p_company_id is null or (select ok from company_exists))
    and (p_branch_id is null or (select ok from branch_exists))
    and (
      exists (
        select 1 from public.portfolio_memberships pm
        join role_permissions rp on rp.role = pm.role and rp.permission = p_permission
        where pm.portfolio_id = p_portfolio_id and pm.user_id = auth.uid() and pm.revoked_at is null
          and (pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER') or (
            p_company_id is not null and exists (
              select 1 from public.branch_assignments ba where ba.portfolio_id = p_portfolio_id
                and ba.company_id = p_company_id and ba.user_id = auth.uid() and ba.role = pm.role
                and ba.revoked_at is null and (p_branch_id is null or ba.branch_id = p_branch_id)
            )
          ))
      )
      or (p_company_id is not null and exists (
        select 1 from public.company_memberships cm
        join role_permissions rp on rp.role = cm.role and rp.permission = p_permission
        where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
          and cm.user_id = auth.uid() and cm.revoked_at is null
      ))
    )
  );
$$;


-- Attendance entries are payroll inputs; the payroll approval is their review boundary.
create or replace function public.payroll_preview_inputs_legacy(
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
  if not found or v_attendance.status not in ('APPROVED', 'DRAFT') then
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
        'taxable_for_paye', pi.taxable_for_paye, 'source_reference', pi.source_reference)
        order by pi.earning_type, pi.created_at, pi.id)
        from public.payroll_earning_inputs pi where pi.employee_id=e.id and pi.company_id=e.company_id
          and pi.period_start=p_period_start and pi.period_end=p_period_end and pi.status in ('APPROVED','RECORDED')), '[]'::jsonb),
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
revoke all on function public.payroll_preview_inputs_legacy(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.payroll_preview_inputs_legacy(uuid, uuid, date, date) to authenticated;

create or replace function public.payroll_create_draft(
  p_company_id uuid, p_branch_id uuid, p_period_start date, p_period_end date,
  p_frequency text, p_idempotency_key text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_portfolio_id uuid; v_period_id uuid; v_run_id uuid; v_attendance public.attendance_periods%rowtype;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start
    or p_frequency is null or p_frequency not in ('MONTHLY','FORTNIGHTLY','WEEKLY')
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 12 or length(p_idempotency_key) > 120 then
    raise exception using errcode='22023', message='A valid payroll period, frequency, and idempotency key are required.';
  end if;
  select b.portfolio_id into v_portfolio_id from public.branches b
  where b.company_id=p_company_id and b.id=p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare',v_portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501', message='Payroll preparation is not authorized for this branch.';
  end if;
  select * into v_attendance from public.attendance_periods ap
  where ap.portfolio_id=v_portfolio_id and ap.company_id=p_company_id and ap.branch_id=p_branch_id
    and ap.period_start=p_period_start and ap.period_end=p_period_end
  for update;
  if not found or v_attendance.status not in ('APPROVED','DRAFT') then
    raise exception using errcode='22023', message='An approved attendance period matching the payroll dates is required.';
  end if;
  insert into public.payroll_periods(portfolio_id,company_id,branch_id,period_start,period_end,frequency)
  values(v_portfolio_id,p_company_id,p_branch_id,p_period_start,p_period_end,p_frequency)
  on conflict(portfolio_id,company_id,branch_id,period_start,period_end,frequency) do nothing;
  select pp.id into strict v_period_id from public.payroll_periods pp
  where pp.portfolio_id=v_portfolio_id and pp.company_id=p_company_id and pp.branch_id=p_branch_id
    and pp.period_start=p_period_start and pp.period_end=p_period_end and pp.frequency=p_frequency
  for update;
  select pr.id into v_run_id from public.payroll_runs pr
  where pr.portfolio_id=v_portfolio_id and pr.company_id=p_company_id and pr.branch_id=p_branch_id
    and pr.payroll_period_id=v_period_id
  for update;
  if found then return v_run_id; end if;
  insert into public.payroll_runs(portfolio_id,company_id,branch_id,payroll_period_id,created_by,idempotency_key)
  values(v_portfolio_id,p_company_id,p_branch_id,v_period_id,auth.uid(),btrim(p_idempotency_key))
  returning id into v_run_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_portfolio_id,p_company_id,p_branch_id,auth.uid(),'PAYROLL_DRAFT_CREATED','payroll',v_run_id::text,
    jsonb_build_object('period_start',p_period_start,'period_end',p_period_end));
  return v_run_id;
end $$;
