-- Keep calculated payroll tied to the exact input set that was reviewed.
-- A DRAFT or RETURNED_FOR_CORRECTION run may still receive HR input changes;
-- calculated/submitted/approved/finalized runs lock those source inputs.

create or replace function public.payroll_earning_input_create(
  p_company_id uuid,p_branch_id uuid,p_employee_id uuid,p_period_start date,p_period_end date,
  p_earning_type text,p_amount numeric,p_taxable_for_paye boolean,p_source_reference text,p_description text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_portfolio uuid; v_existing uuid;
begin
  select portfolio_id into v_portfolio from public.branches where company_id=p_company_id and id=p_branch_id;
  if auth.uid() is null or not found or not app_private.has_permission('payroll.prepare',v_portfolio,p_company_id,p_branch_id)
    or p_employee_id is null or p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or p_earning_type not in ('OVERTIME','BONUS','COMMISSION','OTHER_EARNING')
    or p_amount is null or p_amount<=0 or p_taxable_for_paye is null
    or nullif(btrim(p_source_reference),'') is null or nullif(btrim(p_description),'') is null
    or length(btrim(p_idempotency_key))<12 or length(p_idempotency_key)>120 then
    raise exception using errcode='22023',message='Valid payroll earning details and scoped access are required.';
  end if;
  if not exists(select 1 from public.employees e where e.id=p_employee_id and e.portfolio_id=v_portfolio
    and e.company_id=p_company_id and e.workplace_branch_id=p_branch_id and e.approval_status='APPROVED' and e.employment_status='ACTIVE') then
    raise exception using errcode='42501',message='Earning employee is not active and authorized in this branch.';
  end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=p_company_id and r.branch_id=p_branch_id and p.period_start=p_period_start and p.period_end=p_period_end
      and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION')) then
    raise exception using errcode='55000',message='Payroll inputs are locked after submission.';
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

create or replace function public.payroll_earning_input_review(p_earning_input_id uuid,p_decision text,p_reason text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v public.payroll_earning_inputs%rowtype; v_status text;
begin
  if p_decision not in ('APPROVE','REJECT') or (p_decision='REJECT' and nullif(btrim(p_reason),'') is null) then
    raise exception using errcode='22023',message='A valid review decision and reason are required.';
  end if;
  select * into v from public.payroll_earning_inputs where id=p_earning_input_id for update;
  if not found or v.status<>'SUBMITTED' or v.created_by=auth.uid()
    or not app_private.has_permission('payroll.approve',v.portfolio_id,v.company_id,v.branch_id) then
    raise exception using errcode='42501',message='Payroll earning review is not authorized.';
  end if;
  if exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.payroll_period_id
    where r.company_id=v.company_id and r.branch_id=v.branch_id and p.period_start=v.period_start and p.period_end=v.period_end
      and r.status not in ('DRAFT','RETURNED_FOR_CORRECTION')) then
    raise exception using errcode='55000',message='Payroll inputs are locked after submission.';
  end if;
  v_status:=case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
  update public.payroll_earning_inputs set status=v_status,
    approved_by=case when v_status='APPROVED' then auth.uid() else null end,
    approved_at=case when v_status='APPROVED' then now() else null end where id=v.id;
  insert into public.payroll_earning_input_history(portfolio_id,company_id,branch_id,earning_input_id,actor_id,action,reason)
  values(v.portfolio_id,v.company_id,v.branch_id,v.id,auth.uid(),v_status,nullif(btrim(p_reason),''));
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'PAYROLL_EARNING_'||v_status,'payroll',v.id::text,
    jsonb_build_object('reason',nullif(btrim(p_reason),''),'amount',v.amount,'type',v.earning_type));
  return v.id;
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
    raise exception using errcode='55000',message='The unpaid-leave rule cannot change after a payroll run exists for the effective date.';
  end if;
  if p_effective_from=v_comp.effective_from then
    update public.employee_compensation set unpaid_leave_deduction_method=p_method where id=v_comp.id returning id into v_new_id;
  else
    update public.employee_compensation set effective_to=p_effective_from-1 where id=v_comp.id;
    insert into public.employee_compensation(portfolio_id,company_id,workplace_branch_id,employee_id,effective_from,effective_to,
      salary_frequency,basic_pay,housing_allowance,meal_allowance,transport_allowance,other_allowances,overtime_eligible,
      allowance_tax_treatment,payment_method,created_by,unpaid_leave_deduction_method)
    values(v_comp.portfolio_id,v_comp.company_id,v_comp.workplace_branch_id,v_comp.employee_id,p_effective_from,v_comp.effective_to,
      v_comp.salary_frequency,v_comp.basic_pay,v_comp.housing_allowance,v_comp.meal_allowance,v_comp.transport_allowance,
      v_comp.other_allowances,v_comp.overtime_eligible,v_comp.allowance_tax_treatment,v_comp.payment_method,auth.uid(),p_method)
    returning id into v_new_id;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_employee.portfolio_id,v_employee.company_id,v_employee.workplace_branch_id,auth.uid(),
    'UNPAID_LEAVE_PAY_RULE_CHANGED','compensation',v_employee.id::text,
    jsonb_build_object('effective_from',p_effective_from,'method',p_method,'previous_method',v_comp.unpaid_leave_deduction_method));
  return v_new_id;
end $$;

revoke all on function public.payroll_earning_input_create(uuid,uuid,uuid,date,date,text,numeric,boolean,text,text,text) from public,anon;
grant execute on function public.payroll_earning_input_create(uuid,uuid,uuid,date,date,text,numeric,boolean,text,text,text) to authenticated;
revoke all on function public.payroll_earning_input_review(uuid,text,text) from public,anon;
grant execute on function public.payroll_earning_input_review(uuid,text,text) to authenticated;
revoke all on function public.employee_compensation_set_unpaid_leave_method(uuid,date,text) from public,anon;
grant execute on function public.employee_compensation_set_unpaid_leave_method(uuid,date,text) to authenticated;