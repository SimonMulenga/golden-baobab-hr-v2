-- HR may complete effective-dated compensation setup while a payroll remains a
-- draft or has been returned for correction. Calculated/submitted runs lock it.
-- This forward correction preserves the function bodies and constraints from 024.
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
      and p.period_end>=p_effective_from and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION','CANCELED','REVERSED')) then
    raise exception using errcode='55000',message='The overtime schedule cannot change after payroll calculation or submission.';
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
      and p.period_end>=p_effective_from and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION','CANCELED','REVERSED')) then
    raise exception using errcode='55000',message='The unpaid-leave rule cannot change after payroll calculation or submission.';
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

comment on function public.employee_compensation_set_overtime_divisor(uuid,date,integer) is 'Effective-dated, audited overtime schedule configuration; editable in draft/returned payroll only and locked after calculation/submission.';
