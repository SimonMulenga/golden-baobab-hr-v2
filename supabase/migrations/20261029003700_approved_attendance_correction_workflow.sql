-- Controlled correction path for approved attendance. This migration is
-- additive and is intentionally not applied by this change.

alter table public.attendance_periods
  add column submitted_by uuid references public.profiles(id) on delete restrict,
  add column correction_opened_by uuid references public.profiles(id) on delete restrict;

-- Existing submitted and approved periods used created_by as their submitter.
update public.attendance_periods
set submitted_by = created_by
where status in ('SUBMITTED', 'APPROVED') and submitted_by is null;

comment on column public.attendance_periods.submitted_by is
  'Authenticated user who submitted the latest attendance version for independent review.';
comment on column public.attendance_periods.correction_opened_by is
  'Attendance manager who opened an approved period for controlled correction and reapproval.';

create or replace function public.attendance_approved_correction_capability(
  p_company_id uuid, p_branch_id uuid
)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select auth.uid() is not null
    and app_private.has_permission('attendance.manage', (select c.portfolio_id from public.companies c where c.id=p_company_id), p_company_id, p_branch_id)
$$;

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
    select 1
    from public.payroll_periods pp
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

create or replace function public.attendance_submit_period(p_period_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype; v_count bigint;
begin
  select * into v from public.attendance_periods where id=p_period_id for update;
  if not found or auth.uid() is null or v.status not in ('DRAFT','RETURNED_FOR_CORRECTION')
    or (v.created_by <> auth.uid() and v.correction_opened_by is distinct from auth.uid())
    or not app_private.has_permission('attendance.manage',v.portfolio_id,v.company_id,v.branch_id) then
    raise exception using errcode='42501', message='Attendance submission is not authorized.';
  end if;
  select count(*) into v_count from public.attendance_entries where attendance_period_id=v.id;
  if v_count=0 then raise exception using errcode='22023', message='Add monthly attendance entries before submitting.'; end if;
  update public.attendance_periods
  set status='SUBMITTED', submitted_by=auth.uid(), correction_opened_by=null,
      reviewed_by=null, reviewed_at=null, review_reason=null
  where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'ATTENDANCE_PERIOD_SUBMITTED','attendance',v.id::text,
    jsonb_build_object('entry_count',v_count,'period_start',v.period_start));
  return v.id;
end $$;

-- Serialize draft creation with correction reopening by locking the same
-- approved attendance period before the payroll run is created.
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
  if not found or v_attendance.status<>'APPROVED' then
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

create or replace function public.attendance_review_period(
  p_period_id uuid, p_decision text, p_reason text default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v public.attendance_periods%rowtype;
begin
  if p_decision is null or p_decision not in ('APPROVE','RETURN') or (p_decision='RETURN' and nullif(btrim(p_reason),'') is null) then
    raise exception using errcode='22023', message='A valid attendance decision and reason are required.';
  end if;
  select * into v from public.attendance_periods where id=p_period_id for update;
  if not found or auth.uid() is null or v.status<>'SUBMITTED'
    or coalesce(v.submitted_by,v.created_by)=auth.uid()
    or not app_private.has_permission('attendance.manage',v.portfolio_id,v.company_id,v.branch_id) then
    raise exception using errcode='42501', message='Attendance review is not authorized.';
  end if;
  update public.attendance_periods
  set status=case when p_decision='APPROVE' then 'APPROVED' else 'RETURNED_FOR_CORRECTION' end,
      reviewed_by=auth.uid(),reviewed_at=now(),review_reason=nullif(btrim(p_reason),'')
  where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'ATTENDANCE_PERIOD_'||p_decision,'attendance',v.id::text,
    jsonb_build_object('reason',nullif(btrim(p_reason),''),'period_start',v.period_start));
  return v.id;
end $$;

revoke all on function public.attendance_approved_correction_capability(uuid,uuid) from public,anon;
revoke all on function public.attendance_request_approved_correction(uuid,text) from public,anon;
revoke all on function public.attendance_submit_period(uuid) from public,anon;
revoke all on function public.attendance_review_period(uuid,text,text) from public,anon;
revoke all on function public.payroll_create_draft(uuid,uuid,date,date,text,text) from public,anon;
grant execute on function public.attendance_approved_correction_capability(uuid,uuid) to authenticated;
grant execute on function public.attendance_request_approved_correction(uuid,text) to authenticated;
grant execute on function public.attendance_submit_period(uuid) to authenticated;
grant execute on function public.attendance_review_period(uuid,text,text) to authenticated;
grant execute on function public.payroll_create_draft(uuid,uuid,date,date,text,text) to authenticated;

comment on function public.attendance_request_approved_correction(uuid,text) is
  'Returns an approved attendance period for audited correction only when no payroll run exists; the changed period must be resubmitted and independently reviewed.';
