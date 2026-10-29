-- Store auditable overtime evidence and calculate statutory premiums on the server.
-- 176 hours is an explicit five-day schedule option shown by ZamCalc; 208 and
-- 240 are the Employment Code Act s.75(4) divisors for ordinary and watch staff.
alter table public.payroll_earning_inputs
  add column overtime_hours numeric(8,2),
  add column overtime_day_type text,
  add column overtime_work_date date,
  add column overtime_week_start date,
  add column overtime_weekly_hours numeric(8,2),
  add column overtime_hourly_divisor integer,
  add column overtime_hourly_rate numeric(14,4),
  add column overtime_multiplier numeric(4,2),
  add column overtime_watchperson boolean,
  add constraint payroll_earning_overtime_metadata_check check (
    (earning_type = 'OVERTIME' and overtime_hours is not null and overtime_hours > 0
      and overtime_day_type is not null and overtime_day_type in ('ORDINARY','REST_DAY','PUBLIC_HOLIDAY')
      and overtime_work_date is not null and overtime_week_start is not null
      and overtime_weekly_hours is not null and overtime_hourly_divisor is not null and overtime_hourly_divisor in (176,208,240)
      and overtime_hourly_rate is not null and overtime_hourly_rate >= 0
      and overtime_multiplier is not null and overtime_multiplier in (1.50,2.00) and overtime_watchperson is not null)
    or
    (earning_type <> 'OVERTIME' and overtime_hours is null and overtime_day_type is null and overtime_work_date is null
      and overtime_week_start is null and overtime_weekly_hours is null and overtime_hourly_divisor is null
      and overtime_hourly_rate is null and overtime_multiplier is null and overtime_watchperson is null)
  );
create index payroll_overtime_week_idx on public.payroll_earning_inputs
  (employee_id,overtime_week_start,earning_type,status) where earning_type='OVERTIME';
create unique index payroll_overtime_daily_unique_idx on public.payroll_earning_inputs
  (employee_id,overtime_work_date,overtime_day_type) where earning_type='OVERTIME' and status in ('SUBMITTED','APPROVED');
alter table public.employee_compensation
  add column overtime_monthly_hours_divisor integer not null default 208
  check (overtime_monthly_hours_divisor in (176,208,240));

create or replace function public.payroll_earning_input_create(
  p_company_id uuid,p_branch_id uuid,p_employee_id uuid,p_period_start date,p_period_end date,
  p_earning_type text,p_amount numeric,p_taxable_for_paye boolean,p_source_reference text,p_description text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_portfolio uuid; v_existing uuid;
begin
  select portfolio_id into v_portfolio from public.branches where company_id=p_company_id and id=p_branch_id;
  if auth.uid() is null or not found or not app_private.has_permission('payroll.prepare',v_portfolio,p_company_id,p_branch_id)
    or p_employee_id is null or p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or p_earning_type is null or p_earning_type not in ('BONUS','COMMISSION','OTHER_EARNING')
    or p_amount is null or p_amount<=0 or p_taxable_for_paye is null
    or nullif(btrim(p_source_reference),'') is null or nullif(btrim(p_description),'') is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key))<12 or length(p_idempotency_key)>120 then
    raise exception using errcode='22023',message='Valid non-overtime earning details and scoped access are required.';
  end if;
  if not exists(select 1 from public.employees e where e.id=p_employee_id and e.portfolio_id=v_portfolio
    and e.company_id=p_company_id and e.workplace_branch_id=p_branch_id and e.approval_status='APPROVED' and e.employment_status='ACTIVE') then
    raise exception using errcode='42501',message='Earning employee is not active and authorized in this branch.';
  end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=p_company_id and r.branch_id=p_branch_id and p.period_start=p_period_start and p.period_end=p_period_end
      and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION')) then
    raise exception using errcode='55000',message='Payroll inputs are locked after calculation or submission.';
  end if;
  select id into v_existing from public.payroll_earning_inputs where created_by=auth.uid() and idempotency_key=btrim(p_idempotency_key);
  if found then return v_existing; end if;
  insert into public.payroll_earning_inputs(portfolio_id,company_id,branch_id,employee_id,period_start,period_end,
    earning_type,amount,taxable_for_paye,source_reference,description,created_by,idempotency_key)
  values(v_portfolio,p_company_id,p_branch_id,p_employee_id,p_period_start,p_period_end,p_earning_type,round(p_amount,2),
    p_taxable_for_paye,btrim(p_source_reference),btrim(p_description),auth.uid(),btrim(p_idempotency_key)) returning id into v_existing;
  insert into public.payroll_earning_input_history(portfolio_id,company_id,branch_id,earning_input_id,actor_id,action)
  values(v_portfolio,p_company_id,p_branch_id,v_existing,auth.uid(),'SUBMITTED');
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_portfolio,p_company_id,p_branch_id,auth.uid(),'PAYROLL_EARNING_SUBMITTED','payroll',v_existing::text,
    jsonb_build_object('employee_id',p_employee_id,'type',p_earning_type,'amount',round(p_amount,2),'period_start',p_period_start,'period_end',p_period_end));
  return v_existing;
end $$;

create or replace function public.payroll_overtime_input_create(
  p_company_id uuid,p_branch_id uuid,p_employee_id uuid,p_period_start date,p_period_end date,
  p_work_date date,p_week_start date,p_hours numeric,p_day_type text,p_weekly_hours numeric,
  p_outside_normal_work_week boolean,
  p_source_reference text,p_description text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare
  v_portfolio uuid; v_employee public.employees%rowtype; v_comp public.employee_compensation%rowtype;
  v_existing uuid; v_threshold numeric; v_multiplier numeric; v_hourly numeric; v_amount numeric;
  v_recorded numeric; v_weekly numeric; v_divisor integer; v_prior_divisor integer; v_watchperson boolean;
begin
  select portfolio_id into v_portfolio from public.branches where company_id=p_company_id and id=p_branch_id;
  if auth.uid() is null or not found or not app_private.has_permission('payroll.prepare',v_portfolio,p_company_id,p_branch_id)
    or p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or p_work_date is null or p_work_date not between p_period_start and p_period_end
    or p_week_start is null or p_work_date not between p_week_start and p_week_start+6
    or p_hours is null or p_hours<=0 or p_hours>168
    or p_day_type is null or p_day_type not in ('ORDINARY','REST_DAY','PUBLIC_HOLIDAY')
    or p_weekly_hours is null or p_weekly_hours<0 or p_weekly_hours>168
    or p_weekly_hours<p_hours
    or (p_day_type in ('REST_DAY','PUBLIC_HOLIDAY') and p_outside_normal_work_week is distinct from true)
    or (p_day_type='ORDINARY' and p_outside_normal_work_week is distinct from false)
    or nullif(btrim(p_source_reference),'') is null or nullif(btrim(p_description),'') is null
    or p_idempotency_key is null or length(btrim(p_idempotency_key))<12 or length(p_idempotency_key)>120 then
    raise exception using errcode='22023',message='Valid overtime hours, dates, schedule and scoped access are required.';
  end if;
  select * into v_employee from public.employees e where e.id=p_employee_id and e.portfolio_id=v_portfolio
    and e.company_id=p_company_id and e.workplace_branch_id=p_branch_id
    and e.approval_status='APPROVED' and e.employment_status='ACTIVE' for share;
  if not found then raise exception using errcode='42501',message='Overtime employee is not active and authorized in this branch.'; end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=p_company_id and r.branch_id=p_branch_id and p.period_start=p_period_start and p.period_end=p_period_end
      and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION')) then
    raise exception using errcode='55000',message='Payroll inputs are locked after calculation or submission.';
  end if;
  select id into v_existing from public.payroll_earning_inputs where created_by=auth.uid() and idempotency_key=btrim(p_idempotency_key);
  if found then return v_existing; end if;

  perform pg_advisory_xact_lock(hashtext(p_employee_id::text),hashtext(p_week_start::text));
  select * into v_comp from public.employee_compensation ec where ec.employee_id=p_employee_id
    and ec.company_id=p_company_id and ec.workplace_branch_id=p_branch_id
    and ec.effective_from<=p_work_date and (ec.effective_to is null or ec.effective_to>=p_work_date)
    order by ec.effective_from desc limit 1 for share;
  if not found or not v_comp.overtime_eligible or v_comp.salary_frequency<>'MONTHLY' or v_comp.basic_pay<=0 then
    raise exception using errcode='22023',message='Monthly basic pay and explicit overtime eligibility are required.';
  end if;
  v_divisor:=v_comp.overtime_monthly_hours_divisor;
  v_watchperson:=v_divisor=240;

  if p_day_type='ORDINARY' then
    v_threshold:=case when v_watchperson then 60 else 48 end;
    if p_weekly_hours<=v_threshold then raise exception using errcode='22023',message='Ordinary overtime only applies to hours above the weekly threshold.'; end if;
    select coalesce(sum(overtime_hours) filter(where overtime_day_type='ORDINARY'),0),
      coalesce(max(overtime_weekly_hours),p_weekly_hours),coalesce(max(overtime_hourly_divisor),v_divisor)
      into v_recorded,v_weekly,v_prior_divisor from public.payroll_earning_inputs
      where employee_id=p_employee_id and overtime_week_start=p_week_start and earning_type='OVERTIME'
        and status in ('SUBMITTED','APPROVED');
    if v_weekly<>p_weekly_hours or v_prior_divisor<>v_divisor or v_recorded+p_hours>p_weekly_hours-v_threshold then
      raise exception using errcode='22023',message='Ordinary overtime hours exceed or conflict with the weekly approved hours record.';
    end if;
  end if;

  v_multiplier:=case when p_day_type='ORDINARY' then 1.50 else 2.00 end;
  v_hourly:=v_comp.basic_pay/v_divisor;
  -- Keep precision through multiplication; round the final payable amount to cents.
  v_amount:=round(v_comp.basic_pay*p_hours*v_multiplier/v_divisor,2);
  if v_amount<=0 then raise exception using errcode='22023',message='Calculated overtime amount must be positive.'; end if;

  insert into public.payroll_earning_inputs(portfolio_id,company_id,branch_id,employee_id,period_start,period_end,
    earning_type,amount,taxable_for_paye,source_reference,description,created_by,idempotency_key,
    overtime_hours,overtime_day_type,overtime_work_date,overtime_week_start,overtime_weekly_hours,
    overtime_hourly_divisor,overtime_hourly_rate,overtime_multiplier,overtime_watchperson)
  values(v_portfolio,p_company_id,p_branch_id,p_employee_id,p_period_start,p_period_end,'OVERTIME',v_amount,true,
    btrim(p_source_reference),btrim(p_description),auth.uid(),btrim(p_idempotency_key),p_hours,p_day_type,p_work_date,p_week_start,
    p_weekly_hours,v_divisor,v_hourly,v_multiplier,v_watchperson) returning id into v_existing;
  insert into public.payroll_earning_input_history(portfolio_id,company_id,branch_id,earning_input_id,actor_id,action,reason)
  values(v_portfolio,p_company_id,p_branch_id,v_existing,auth.uid(),'SUBMITTED',
    jsonb_build_object('work_date',p_work_date,'week_start',p_week_start,'hours',p_hours,'weekly_hours',p_weekly_hours,
      'day_type',p_day_type,'hourly_divisor',v_divisor,'hourly_rate',v_hourly,'multiplier',v_multiplier)::text);
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_portfolio,p_company_id,p_branch_id,auth.uid(),'PAYROLL_OVERTIME_SUBMITTED','payroll',v_existing::text,
    jsonb_build_object('employee_id',p_employee_id,'work_date',p_work_date,'week_start',p_week_start,'hours',p_hours,
      'weekly_hours',p_weekly_hours,'day_type',p_day_type,'hourly_divisor',v_divisor,
      'basic_pay',v_comp.basic_pay,'hourly_rate',v_hourly,'multiplier',v_multiplier,'amount',v_amount));
  return v_existing;
end $$;

create or replace function public.employee_compensation_set_overtime_divisor(
  p_employee_id uuid,p_effective_from date,p_divisor integer
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_employee public.employees%rowtype; v_comp public.employee_compensation%rowtype; v_new_id uuid;
begin
  if auth.uid() is null or p_divisor is null or p_divisor not in (176,208,240) or p_effective_from is null
    or extract(day from p_effective_from)<>1 then
    raise exception using errcode='22023',message='Choose an allowed overtime schedule divisor and a first-of-month effective date.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or not app_private.has_permission('compensation.edit',v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id) then
    raise exception using errcode='42501',message='Compensation schedule administration is not authorized.';
  end if;
  select * into v_comp from public.employee_compensation ec where ec.employee_id=v_employee.id
    and ec.company_id=v_employee.company_id and ec.workplace_branch_id=v_employee.workplace_branch_id
    and ec.effective_from<=p_effective_from and (ec.effective_to is null or ec.effective_to>=p_effective_from)
    order by ec.effective_from desc limit 1 for update;
  if not found then raise exception using errcode='22023',message='No effective compensation record exists for the requested date.'; end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=v_employee.company_id and r.branch_id=v_employee.workplace_branch_id
      and p.period_end>=p_effective_from and r.status not in ('CANCELED','REVERSED')) then
    raise exception using errcode='55000',message='The overtime schedule cannot change after a payroll run exists for the effective date.';
  end if;
  if p_effective_from=v_comp.effective_from then
    update public.employee_compensation set overtime_monthly_hours_divisor=p_divisor where id=v_comp.id returning id into v_new_id;
  else
    update public.employee_compensation set effective_to=p_effective_from-1 where id=v_comp.id;
    insert into public.employee_compensation(portfolio_id,company_id,workplace_branch_id,employee_id,effective_from,effective_to,
      salary_frequency,basic_pay,housing_allowance,meal_allowance,transport_allowance,other_allowances,overtime_eligible,
      allowance_tax_treatment,payment_method,created_by,unpaid_leave_deduction_method,overtime_monthly_hours_divisor)
    values(v_comp.portfolio_id,v_comp.company_id,v_comp.workplace_branch_id,v_comp.employee_id,p_effective_from,v_comp.effective_to,
      v_comp.salary_frequency,v_comp.basic_pay,v_comp.housing_allowance,v_comp.meal_allowance,v_comp.transport_allowance,
      v_comp.other_allowances,v_comp.overtime_eligible,v_comp.allowance_tax_treatment,v_comp.payment_method,auth.uid(),
      v_comp.unpaid_leave_deduction_method,p_divisor) returning id into v_new_id;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),
    'OVERTIME_SCHEDULE_DIVISOR_CHANGED','compensation',v_employee.id::text,
    jsonb_build_object('effective_from',p_effective_from,'divisor',p_divisor,'previous_divisor',v_comp.overtime_monthly_hours_divisor));
  return v_new_id;
end $$;

-- Preserve the overtime divisor when HR versions another compensation rule.
create or replace function public.employee_compensation_set_unpaid_leave_method(
  p_employee_id uuid,p_effective_from date,p_method text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_employee public.employees%rowtype; v_comp public.employee_compensation%rowtype; v_new_id uuid;
begin
  if auth.uid() is null or p_method not in ('BLOCK','BASIC_PER_SCHEDULED_WORKDAY','GROSS_PER_SCHEDULED_WORKDAY')
    or p_effective_from is null or extract(day from p_effective_from)<>1 then
    raise exception using errcode='22023',message='Choose a supported unpaid-leave method and a first-of-month effective date.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if not found or not app_private.has_permission('compensation.edit',v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id) then
    raise exception using errcode='42501',message='Compensation rule administration is not authorized.';
  end if;
  select * into v_comp from public.employee_compensation ec where ec.employee_id=v_employee.id
    and ec.company_id=v_employee.company_id and ec.workplace_branch_id=v_employee.workplace_branch_id
    and ec.effective_from<=p_effective_from and (ec.effective_to is null or ec.effective_to>=p_effective_from)
    order by ec.effective_from desc limit 1 for update;
  if not found then raise exception using errcode='22023',message='No effective compensation record exists for the requested date.'; end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=v_employee.company_id and r.branch_id=v_employee.workplace_branch_id
      and p.period_end>=p_effective_from and r.status not in ('CANCELED','REVERSED')) then
    raise exception using errcode='55000',message='The unpaid-leave rule cannot change after a payroll run exists for the effective date.';
  end if;
  if p_effective_from=v_comp.effective_from then
    update public.employee_compensation set unpaid_leave_deduction_method=p_method where id=v_comp.id returning id into v_new_id;
  else
    update public.employee_compensation set effective_to=p_effective_from-1 where id=v_comp.id;
    insert into public.employee_compensation(portfolio_id,company_id,workplace_branch_id,employee_id,effective_from,effective_to,
      salary_frequency,basic_pay,housing_allowance,meal_allowance,transport_allowance,other_allowances,overtime_eligible,
      allowance_tax_treatment,payment_method,created_by,unpaid_leave_deduction_method,overtime_monthly_hours_divisor)
    values(v_comp.portfolio_id,v_comp.company_id,v_comp.workplace_branch_id,v_comp.employee_id,p_effective_from,v_comp.effective_to,
      v_comp.salary_frequency,v_comp.basic_pay,v_comp.housing_allowance,v_comp.meal_allowance,v_comp.transport_allowance,
      v_comp.other_allowances,v_comp.overtime_eligible,v_comp.allowance_tax_treatment,v_comp.payment_method,auth.uid(),p_method,
      v_comp.overtime_monthly_hours_divisor) returning id into v_new_id;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),
    'UNPAID_LEAVE_PAY_RULE_CHANGED','compensation',v_employee.id::text,
    jsonb_build_object('effective_from',p_effective_from,'method',p_method,'previous_method',v_comp.unpaid_leave_deduction_method));
  return v_new_id;
end $$;

create or replace function public.payroll_preview_inputs(
  p_company_id uuid,p_branch_id uuid,p_period_start date,p_period_end date
) returns jsonb language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_portfolio_id uuid; v_attendance public.attendance_periods%rowtype; v_result jsonb;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception using errcode='22023',message='A valid payroll period is required.';
  end if;
  select b.portfolio_id into v_portfolio_id from public.branches b where b.company_id=p_company_id and b.id=p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare',v_portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Payroll inputs are not authorized for this branch.';
  end if;
  select ap.* into v_attendance from public.attendance_periods ap where ap.portfolio_id=v_portfolio_id
    and ap.company_id=p_company_id and ap.branch_id=p_branch_id and ap.period_start=p_period_start and ap.period_end=p_period_end;
  if not found or v_attendance.status<>'APPROVED' then
    raise exception using errcode='22023',message='An approved attendance period matching the payroll dates is required.';
  end if;
  select jsonb_build_object(
    'portfolio_id',v_portfolio_id,'company_id',p_company_id,'branch_id',p_branch_id,'period_start',p_period_start,'period_end',p_period_end,
    'attendance_period_id',v_attendance.id,'attendance_approved_at',v_attendance.reviewed_at,
    'earning_inputs',coalesce((select jsonb_agg(jsonb_build_object('id',pi.id,'employee_id',pi.employee_id,
      'employee_number',e2.employee_number,'employee_name',concat_ws(' ',e2.first_name,nullif(e2.middle_name,''),e2.last_name),
      'earning_type',pi.earning_type,'amount',pi.amount,'taxable_for_paye',pi.taxable_for_paye,'source_reference',pi.source_reference,
      'description',pi.description,'status',pi.status,'created_by',pi.created_by,'approved_by',pi.approved_by,'created_at',pi.created_at,
      'overtime_hours',pi.overtime_hours,'overtime_day_type',pi.overtime_day_type,'overtime_work_date',pi.overtime_work_date,
      'overtime_week_start',pi.overtime_week_start,'overtime_weekly_hours',pi.overtime_weekly_hours,
      'overtime_hourly_divisor',pi.overtime_hourly_divisor,'overtime_hourly_rate',pi.overtime_hourly_rate,
      'overtime_multiplier',pi.overtime_multiplier,'overtime_watchperson',pi.overtime_watchperson)
      order by pi.created_at,pi.id) from public.payroll_earning_inputs pi join public.employees e2 on e2.id=pi.employee_id
      where pi.portfolio_id=v_portfolio_id and pi.company_id=p_company_id and pi.branch_id=p_branch_id
        and pi.period_start=p_period_start and pi.period_end=p_period_end),'[]'::jsonb),
    'items',coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'employee_number',e.employee_number,
      'employee_name',concat_ws(' ',e.first_name,nullif(e.middle_name,''),e.last_name),'contract_type',e.contract_type,
      'employment_type',e.employment_type,'salary_frequency',comp.salary_frequency,'compensation_effective_from',comp.effective_from,
      'basic_pay',comp.basic_pay,'housing_allowance',comp.housing_allowance,'meal_allowance',comp.meal_allowance,
      'transport_allowance',comp.transport_allowance,'other_allowances',comp.other_allowances,'overtime_eligible',comp.overtime_eligible,
      'unpaid_leave_deduction_method',comp.unpaid_leave_deduction_method,'allowance_tax_treatment',comp.allowance_tax_treatment,
      'overtime_monthly_hours_divisor',comp.overtime_monthly_hours_divisor,
      'attendance',case when ae.id is null then null else jsonb_build_object('scheduled_working_days',ae.scheduled_working_days,
        'actual_days_worked',ae.actual_days_worked,'paid_leave_days',ae.paid_leave_days,'unpaid_leave_days',ae.unpaid_leave_days,
        'other_payable_absence_days',ae.other_payable_absence_days) end,
      'approved_leave_requests',coalesce((select jsonb_agg(jsonb_build_object('leave_request_id',lr.id,'leave_type',lr.leave_type,
        'pay_classification',lr.pay_classification,'start_date',lr.start_date,'end_date',lr.end_date,'leave_days',lr.leave_days)
        order by lr.start_date,lr.id) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
        and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.start_date<=p_period_end and lr.end_date>=p_period_start),'[]'::jsonb),
      'due_approved_deductions',coalesce((select jsonb_agg(jsonb_build_object('deduction_id',d.id,'installment_id',di.id,
        'deduction_type',d.deduction_type,'scheduled_amount',di.scheduled_amount,'due_period',di.due_period,
        'outstanding_balance',d.principal_amount-d.amount_deducted) order by di.due_period,d.id)
        from public.employee_deductions d join public.deduction_installments di on di.deduction_id=d.id and di.employee_id=d.employee_id
        where d.employee_id=e.id and d.status='ACTIVE' and di.due_period between p_period_start and p_period_end and di.scheduled_amount>0),'[]'::jsonb),
      'approved_earnings',coalesce((select jsonb_agg(jsonb_build_object('earning_input_id',pi.id,'earning_type',pi.earning_type,
        'amount',pi.amount,'taxable_for_paye',pi.taxable_for_paye,'source_reference',pi.source_reference,'description',pi.description,
        'approved_by',pi.approved_by,'approved_at',pi.approved_at,'created_at',pi.created_at,
        'overtime_hours',pi.overtime_hours,'overtime_day_type',pi.overtime_day_type,'overtime_work_date',pi.overtime_work_date,
        'overtime_week_start',pi.overtime_week_start,'overtime_weekly_hours',pi.overtime_weekly_hours,
        'overtime_hourly_divisor',pi.overtime_hourly_divisor,'overtime_hourly_rate',pi.overtime_hourly_rate,
        'overtime_multiplier',pi.overtime_multiplier,'overtime_watchperson',pi.overtime_watchperson)
        order by pi.earning_type,pi.created_at,pi.id) from public.payroll_earning_inputs pi
        where pi.employee_id=e.id and pi.company_id=e.company_id and pi.period_start=p_period_start
          and pi.period_end=p_period_end and pi.status='APPROVED'),'[]'::jsonb),
      'input_warnings',to_jsonb(array_remove(array[
        case when comp.id is null then 'MISSING_EFFECTIVE_COMPENSATION' end,
        case when (select count(*) from public.employee_compensation ecx where ecx.employee_id=e.id and ecx.company_id=e.company_id
          and ecx.workplace_branch_id=e.workplace_branch_id and ecx.effective_from<=p_period_start
          and (ecx.effective_to is null or ecx.effective_to>=p_period_end))<>1 then 'COMPENSATION_NOT_UNAMBIGUOUS_FOR_FULL_PERIOD' end,
        case when exists(select 1 from public.payroll_earning_inputs pending where pending.employee_id=e.id and pending.company_id=e.company_id
          and pending.period_start=p_period_start and pending.period_end=p_period_end and pending.status='SUBMITTED') then 'EARNING_INPUTS_AWAITING_APPROVAL' end,
        case when exists(select 1 from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
          and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.start_date<=p_period_end and lr.end_date>=p_period_start
          and (lr.start_date<p_period_start or lr.end_date>p_period_end)) then 'CROSS_PERIOD_LEAVE_REQUIRES_REVIEW' end,
        case when ae.id is not null and (coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id
          and lr.company_id=e.company_id and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='PAID'
          and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0)<>ae.paid_leave_days or
          coalesce((select sum(lr.leave_days) from public.leave_requests lr where lr.employee_id=e.id and lr.company_id=e.company_id
          and lr.branch_id=e.workplace_branch_id and lr.status='APPROVED' and lr.pay_classification='UNPAID'
          and lr.start_date>=p_period_start and lr.end_date<=p_period_end),0)<>ae.unpaid_leave_days)
          then 'APPROVED_LEAVE_NOT_RECONCILED_WITH_ATTENDANCE' end,
        case when exists(select 1 from public.leave_requests la join public.leave_requests lb on lb.employee_id=la.employee_id
          and lb.id>la.id and lb.status='APPROVED' and daterange(lb.start_date,lb.end_date,'[]') && daterange(la.start_date,la.end_date,'[]')
          where la.employee_id=e.id and la.status='APPROVED' and la.start_date<=p_period_end and la.end_date>=p_period_start)
          then 'OVERLAPPING_APPROVED_LEAVE' end,
        case when ae.id is null then 'MISSING_APPROVED_ATTENDANCE_ENTRY' end,
        case when comp.salary_frequency is distinct from 'MONTHLY' then 'NON_MONTHLY_FREQUENCY_REQUIRES_CALCULATION_RULE' end
      ],null))) order by e.employee_number),'[]'::jsonb)
  ) into v_result from public.employees e
  left join lateral (select ec.* from public.employee_compensation ec where ec.employee_id=e.id and ec.company_id=e.company_id
    and ec.workplace_branch_id=e.workplace_branch_id and ec.effective_from<=p_period_end
    and (ec.effective_to is null or ec.effective_to>=p_period_start) order by ec.effective_from desc,ec.created_at desc limit 1) comp on true
  left join public.attendance_entries ae on ae.attendance_period_id=v_attendance.id and ae.employee_id=e.id
  where e.portfolio_id=v_portfolio_id and e.company_id=p_company_id and e.workplace_branch_id=p_branch_id
    and e.approval_status='APPROVED' and e.employment_status='ACTIVE' and e.contract_start_date<=p_period_end
    and (e.contract_end_date is null or e.contract_end_date>=p_period_start);
  return v_result;
end $$;

revoke all on function public.payroll_overtime_input_create(uuid,uuid,uuid,date,date,date,date,numeric,text,numeric,boolean,text,text,text) from public,anon;
grant execute on function public.payroll_overtime_input_create(uuid,uuid,uuid,date,date,date,date,numeric,text,numeric,boolean,text,text,text) to authenticated;
revoke all on function public.employee_compensation_set_overtime_divisor(uuid,date,integer) from public,anon;
grant execute on function public.employee_compensation_set_overtime_divisor(uuid,date,integer) to authenticated;
revoke all on function public.employee_compensation_set_unpaid_leave_method(uuid,date,text) from public,anon;
grant execute on function public.employee_compensation_set_unpaid_leave_method(uuid,date,text) to authenticated;
revoke all on function public.payroll_earning_input_create(uuid,uuid,uuid,date,date,text,numeric,boolean,text,text,text) from public,anon;
grant execute on function public.payroll_earning_input_create(uuid,uuid,uuid,date,date,text,numeric,boolean,text,text,text) to authenticated;
revoke all on function public.payroll_preview_inputs(uuid,uuid,date,date) from public,anon;
grant execute on function public.payroll_preview_inputs(uuid,uuid,date,date) to authenticated;

comment on column public.payroll_earning_inputs.overtime_hourly_divisor is 'Explicit schedule divisor: 208 ordinary full-time under Employment Code Act s.75(4), 240 watchperson/guard, or 176 five-day schedule as shown by ZamCalc. Never inferred.';
comment on function public.payroll_overtime_input_create(uuid,uuid,uuid,date,date,date,date,numeric,text,numeric,boolean,text,text,text) is 'Trusted overtime valuation from monthly basic wages and effective-dated compensation divisor. Ordinary threshold is 48 hours (60 for guards); rest/public holiday premium requires work outside normal week.';
