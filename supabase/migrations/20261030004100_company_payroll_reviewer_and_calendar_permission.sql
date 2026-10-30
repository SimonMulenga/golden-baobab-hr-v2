-- Add a company-scoped payroll reviewer without finalization rights and a narrow
-- branch-calendar capability. Existing roles and memberships remain intact.
alter table public.company_memberships drop constraint company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role in ('COMPANY_ADMIN', 'COMPANY_PAYROLL_PREPARER', 'COMPANY_PAYROLL_APPROVER', 'COMPANY_PAYROLL_REVIEWER'));

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
      ('BRANCH_MANAGER', 'attendance.view'), ('BRANCH_MANAGER', 'attendance.manage'), ('BRANCH_MANAGER', 'leave.view'), ('BRANCH_MANAGER', 'leave.request'), ('BRANCH_MANAGER', 'leave.review'), ('BRANCH_MANAGER', 'deduction.view'), ('BRANCH_MANAGER', 'deduction.create'),
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

create or replace function public.assign_company_payroll_reviewer(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() then
    raise exception using errcode = '42501', message = 'A different target account is required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The target account must be activated first.';
  end if;
  insert into public.company_memberships(portfolio_id, company_id, user_id, role, created_by, revoked_at)
  values (p_portfolio_id, p_company_id, p_user_id, 'COMPANY_PAYROLL_REVIEWER', auth.uid(), null)
  on conflict (portfolio_id, company_id, user_id, role)
  do update set created_by = auth.uid(), created_at = now(), revoked_at = null;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_PAYROLL_REVIEWER_ASSIGNED', 'users', p_user_id::text,
    jsonb_build_object('role', 'COMPANY_PAYROLL_REVIEWER'));
end;
$$;

create or replace function public.revoke_company_payroll_reviewer(p_portfolio_id uuid, p_company_id uuid, p_user_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_changed integer;
begin
  if auth.uid() is null or p_user_id is null or p_user_id = auth.uid() or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '42501', message = 'A different account and a revocation reason are required.';
  end if;
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user management is not authorized.';
  end if;
  update public.company_memberships set revoked_at = coalesce(revoked_at, now())
  where portfolio_id = p_portfolio_id and company_id = p_company_id and user_id = p_user_id
    and role = 'COMPANY_PAYROLL_REVIEWER' and revoked_at is null;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
    values (p_portfolio_id, p_company_id, auth.uid(), 'COMPANY_PAYROLL_REVIEWER_REVOKED', 'users', p_user_id::text,
      jsonb_build_object('role', 'COMPANY_PAYROLL_REVIEWER', 'reason', btrim(p_reason)));
  end if;
end;
$$;

create or replace function public.company_payroll_reviewer_members(p_portfolio_id uuid, p_company_id uuid)
returns table(user_id uuid, email text, display_name text, role text, created_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if not app_private.has_permission('users.manage', p_portfolio_id, p_company_id, null) then
    raise exception using errcode = '42501', message = 'Company user directory is not authorized.';
  end if;
  return query
  select cm.user_id, u.email::text, p.display_name, cm.role, cm.created_at, cm.revoked_at
  from public.company_memberships cm
  join auth.users u on u.id = cm.user_id
  join public.profiles p on p.id = cm.user_id
  where cm.portfolio_id = p_portfolio_id and cm.company_id = p_company_id
    and cm.role = 'COMPANY_PAYROLL_REVIEWER'
  order by cm.created_at desc, cm.user_id;
end;
$$;

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
  return jsonb_build_object('can_manage', app_private.has_permission('branch.calendar.manage', v_portfolio_id, p_company_id, p_branch_id));
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
  if not found or not app_private.has_permission('branch.calendar.manage', v_portfolio_id, p_company_id, p_branch_id) then
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
     or not app_private.has_permission('branch.calendar.manage', v.portfolio_id, v.company_id, v.branch_id)
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

revoke all on function public.assign_company_payroll_reviewer(uuid, uuid, uuid) from public, anon;
revoke all on function public.revoke_company_payroll_reviewer(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.company_payroll_reviewer_members(uuid, uuid) from public, anon;
grant execute on function public.assign_company_payroll_reviewer(uuid, uuid, uuid) to authenticated;
grant execute on function public.revoke_company_payroll_reviewer(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.company_payroll_reviewer_members(uuid, uuid) to authenticated;
grant execute on function public.branch_work_calendar_capabilities(uuid, uuid) to authenticated;
grant execute on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text) to authenticated;
grant execute on function public.branch_work_calendar_review(uuid, text, text) to authenticated;

comment on function public.assign_company_payroll_reviewer(uuid, uuid, uuid) is
  'Assigns an audited company-scoped reviewer with no payroll finalization permission.';
comment on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text) is
  'Submits a branch calendar using branch.calendar.manage, without granting branch administration.';
