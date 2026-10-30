-- Simplify monthly operations: attendance is an editable payroll input and
-- payroll itself is reviewed/approved; leave requests are recorded atomically
-- after policy and balance validation, without a separate approval queue.

create or replace function public.attendance_review_period(
  p_period_id uuid, p_decision text, p_reason text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype;
begin
  if p_decision is distinct from 'RETURN' or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023', message='Only a return for correction with a reason is supported.';
  end if;
  select * into v from public.attendance_periods where id=p_period_id for update;
  if not found or auth.uid() is null or v.status<>'SUBMITTED'
    or coalesce(v.submitted_by,v.created_by)=auth.uid()
    or not app_private.has_permission('attendance.manage',v.portfolio_id,v.company_id,v.branch_id) then
    raise exception using errcode='42501', message='Attendance return is not authorized for this period.';
  end if;
  update public.attendance_periods
    set status='RETURNED_FOR_CORRECTION', reviewed_by=auth.uid(), reviewed_at=now(), review_reason=btrim(p_reason)
    where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'ATTENDANCE_PERIOD_RETURNED','attendance',v.id::text,
      jsonb_build_object('reason',btrim(p_reason),'period_start',v.period_start));
  return v.id;
end $$;

-- New attendance periods stay DRAFT. payroll_create_draft already accepts DRAFT
-- and locks corrections once a payroll run exists. Remove the redundant submit
-- RPC from the client role; retain the audited return RPC only for legacy rows.
revoke all on function public.attendance_submit_period(uuid) from public, anon, authenticated;
revoke all on function public.attendance_review_period(uuid,text,text) from public, anon;
grant execute on function public.attendance_review_period(uuid,text,text) to authenticated;

create or replace function public.attendance_request_approved_correction(
  p_period_id uuid, p_reason text
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype;
begin
  if auth.uid() is null or nullif(btrim(p_reason), '') is null then
    raise exception using errcode='22023', message='A correction reason is required.';
  end if;
  select * into v from public.attendance_periods where id=p_period_id for update;
  if not found or v.status <> 'APPROVED'
    or not app_private.has_permission('attendance.manage', v.portfolio_id, v.company_id, v.branch_id) then
    raise exception using errcode='42501', message='Approved attendance correction is not authorized for this period.';
  end if;
  if exists (
    select 1 from public.payroll_periods pp
    join public.payroll_runs pr on pr.portfolio_id=pp.portfolio_id and pr.company_id=pp.company_id
      and pr.branch_id=pp.branch_id and pr.payroll_period_id=pp.id
    where pp.portfolio_id=v.portfolio_id and pp.company_id=v.company_id and pp.branch_id=v.branch_id
      and pp.period_start=v.period_start and pp.period_end=v.period_end
  ) then
    raise exception using errcode='55000', message='Attendance cannot be reopened because a payroll run already exists for this period.';
  end if;
  update public.attendance_periods
    set status='RETURNED_FOR_CORRECTION', reviewed_by=auth.uid(), reviewed_at=now(),
      review_reason=btrim(p_reason), correction_opened_by=auth.uid(), submitted_by=null
    where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'ATTENDANCE_APPROVED_CORRECTION_REQUESTED','attendance',v.id::text,
      jsonb_build_object('period_start',v.period_start,'period_end',v.period_end,'reason',btrim(p_reason)));
  return v.id;
end $$;

create or replace function public.leave_create_request_calculated(
  p_portfolio_id uuid,p_company_id uuid,p_branch_id uuid,p_employee_id uuid,p_leave_policy_id uuid,
  p_start_date date,p_end_date date,p_reason text,p_idempotency_key text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare
  v_employee public.employees%rowtype; v_policy public.leave_policies%rowtype;
  v_existing public.leave_requests%rowtype; v_days numeric(6,2); v_id uuid; v_balance numeric(10,2);
begin
  if auth.uid() is null or p_start_date is null or p_end_date is null or p_end_date<p_start_date
    or p_end_date>p_start_date+interval '366 days' or nullif(btrim(p_idempotency_key),'') is null then
    raise exception using errcode='22023',message='Leave dates or idempotency key are invalid.';
  end if;
  if not app_private.has_permission('leave.request',p_portfolio_id,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Leave recording is not authorized for this branch.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id and portfolio_id=p_portfolio_id
    and company_id=p_company_id and workplace_branch_id=p_branch_id for update;
  if not found or v_employee.approval_status<>'APPROVED' then
    raise exception using errcode='42501',message='Leave requires an approved employee in the selected branch.';
  end if;
  select * into v_policy from public.leave_policies where id=p_leave_policy_id and portfolio_id=p_portfolio_id
    and company_id=p_company_id and enabled and effective_from<=p_start_date
    and (effective_to is null or p_end_date<=effective_to);
  if not found then raise exception using errcode='22023',message='No single enabled leave policy covers the complete date range.'; end if;
  if v_policy.day_count_method='CALENDAR_DAYS' then v_days:=(p_end_date-p_start_date)+1;
  else
    select count(*)::numeric(6,2) into v_days from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d(day_value)
      left join public.leave_calendar_exceptions x on x.portfolio_id=p_portfolio_id and x.company_id=p_company_id and x.calendar_date=d.day_value::date
      where coalesce(x.is_working_day,(extract(isodow from d.day_value) between 1 and 5));
  end if;
  if v_days<=0 then raise exception using errcode='22023',message='The selected dates contain no leave days under the company calendar.'; end if;
  select * into v_existing from public.leave_requests where requested_by=auth.uid() and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.portfolio_id<>p_portfolio_id or v_existing.company_id<>p_company_id or v_existing.branch_id<>p_branch_id
      or v_existing.employee_id<>p_employee_id or v_existing.leave_policy_id<>p_leave_policy_id
      or v_existing.start_date<>p_start_date or v_existing.end_date<>p_end_date or v_existing.leave_days<>v_days
      or v_existing.reason is distinct from nullif(btrim(p_reason),'') then
      raise exception using errcode='23505',message='This leave key was already used with different details.';
    end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.leave_requests l where l.employee_id=p_employee_id and l.status in ('PENDING','APPROVED')
    and daterange(l.start_date,l.end_date,'[]') && daterange(p_start_date,p_end_date,'[]')) then
    raise exception using errcode='23505',message='Leave dates overlap an existing pending or approved request.';
  end if;
  if v_policy.pay_classification='PAID' then
    select coalesce(sum(amount_delta),0) into v_balance from public.leave_balance_ledger
      where portfolio_id=p_portfolio_id and company_id=p_company_id and employee_id=p_employee_id and leave_policy_id=v_policy.id;
    if v_balance<v_days then raise exception using errcode='22023',message='The employee has insufficient accrued paid leave.'; end if;
  end if;
  insert into public.leave_requests(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,leave_type,
    pay_classification,start_date,end_date,leave_days,requested_by,reason,idempotency_key,status,reviewed_by,reviewed_at)
  values(p_portfolio_id,p_company_id,p_branch_id,p_employee_id,v_policy.id,v_policy.leave_type,v_policy.pay_classification,
    p_start_date,p_end_date,v_days,auth.uid(),nullif(btrim(p_reason),''),p_idempotency_key,'APPROVED',auth.uid(),now())
  returning id into v_id;
  if v_policy.pay_classification='PAID' then
    insert into public.leave_balance_ledger(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,event_type,
      amount_delta,reference_id,period_start,actor_id)
    values(p_portfolio_id,p_company_id,p_branch_id,p_employee_id,v_policy.id,'PAID_LEAVE',-v_days,v_id::text,
      date_trunc('month',p_start_date)::date,auth.uid());
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,p_company_id,p_branch_id,auth.uid(),'LEAVE_RECORDED','leave',v_id::text,
      jsonb_build_object('employee_id',p_employee_id,'policy_id',v_policy.id,'days',v_days,'classification',v_policy.pay_classification));
  return v_id;
end $$;

-- Leave creation now performs the validation/debit atomically; only cancellation
-- remains available on this legacy transition endpoint.
create or replace function public.leave_request_transition(p_leave_request_id uuid,p_decision text,p_reason text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.leave_requests%rowtype;
begin
  if auth.uid() is null or p_decision is distinct from 'CANCEL' or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='Only cancellation with a reason is supported.';
  end if;
  select * into v from public.leave_requests where id=p_leave_request_id for update;
  if not found then raise exception using errcode='42501',message='Leave record is unavailable.'; end if;
  if not ((v.requested_by=auth.uid() and v.start_date>current_date and v.status in ('PENDING','APPROVED','RETURNED_FOR_CORRECTION'))
      or (v.status='APPROVED' and app_private.has_permission('leave.review',v.portfolio_id,v.company_id,v.branch_id))) then
    raise exception using errcode='42501',message='Leave cancellation is not authorized or the leave has already started.';
  end if;
  if v.status='APPROVED' and v.pay_classification='PAID' and v.leave_policy_id is not null then
    insert into public.leave_balance_ledger(portfolio_id,company_id,branch_id,employee_id,leave_policy_id,event_type,
      amount_delta,reference_id,period_start,actor_id)
    values(v.portfolio_id,v.company_id,v.branch_id,v.employee_id,v.leave_policy_id,'REVERSAL',v.leave_days,
      'CANCEL:'||v.id::text,date_trunc('month',v.start_date)::date,auth.uid())
    on conflict(portfolio_id,company_id,employee_id,leave_policy_id,event_type,reference_id) do nothing;
  end if;
  update public.leave_requests set status='CANCELED',reviewed_by=auth.uid(),reviewed_at=null,review_reason=btrim(p_reason) where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'LEAVE_CANCELED','leave',v.id::text,
      jsonb_build_object('employee_id',v.employee_id,'reason',btrim(p_reason)));
  return v.id;
end $$;

revoke all on function public.attendance_request_approved_correction(uuid,text) from public,anon;
grant execute on function public.attendance_request_approved_correction(uuid,text) to authenticated;
revoke all on function public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text) from public,anon;
grant execute on function public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text) to authenticated;
revoke all on function public.leave_request_transition(uuid,text,text) from public,anon;
grant execute on function public.leave_request_transition(uuid,text,text) to authenticated;

comment on function public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text) is
  'Records leave immediately after tenant, policy, date overlap and paid balance checks; no separate leave approval is required.';
