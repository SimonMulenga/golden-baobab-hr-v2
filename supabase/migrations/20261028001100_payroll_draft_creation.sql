-- Idempotent creation of a payroll period and DRAFT run after attendance approval.
-- Calculation, submission, approval, and finalization remain separate workflows.

create unique index payroll_periods_exact_period_unique
  on public.payroll_periods(portfolio_id, company_id, branch_id, period_start, period_end, frequency);

create or replace function public.payroll_create_draft(
  p_company_id uuid,
  p_branch_id uuid,
  p_period_start date,
  p_period_end date,
  p_frequency text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_portfolio_id uuid;
  v_period_id uuid;
  v_run_id uuid;
begin
  if auth.uid() is null or p_period_start is null or p_period_end is null or p_period_end < p_period_start
    or p_frequency not in ('MONTHLY', 'FORTNIGHTLY', 'WEEKLY')
    or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 12 or length(p_idempotency_key) > 120 then
    raise exception using errcode = '22023', message = 'A valid payroll period, frequency, and idempotency key are required.';
  end if;

  select b.portfolio_id into v_portfolio_id
  from public.branches b
  where b.company_id = p_company_id and b.id = p_branch_id;
  if not found or not app_private.has_permission('payroll.prepare', v_portfolio_id, p_company_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Payroll preparation is not authorized for this branch.';
  end if;

  if not exists (
    select 1 from public.attendance_periods ap
    where ap.portfolio_id = v_portfolio_id and ap.company_id = p_company_id and ap.branch_id = p_branch_id
      and ap.period_start = p_period_start and ap.period_end = p_period_end and ap.status = 'APPROVED'
  ) then
    raise exception using errcode = '22023', message = 'An approved attendance period matching the payroll dates is required.';
  end if;

  insert into public.payroll_periods(portfolio_id, company_id, branch_id, period_start, period_end, frequency)
  values (v_portfolio_id, p_company_id, p_branch_id, p_period_start, p_period_end, p_frequency)
  on conflict (portfolio_id, company_id, branch_id, period_start, period_end, frequency) do nothing;

  select pp.id into strict v_period_id from public.payroll_periods pp
  where pp.portfolio_id = v_portfolio_id and pp.company_id = p_company_id and pp.branch_id = p_branch_id
    and pp.period_start = p_period_start and pp.period_end = p_period_end and pp.frequency = p_frequency
  for update;

  select pr.id into v_run_id from public.payroll_runs pr
  where pr.portfolio_id = v_portfolio_id and pr.company_id = p_company_id and pr.branch_id = p_branch_id
    and pr.payroll_period_id = v_period_id
  for update;
  if found then
    if v_run_id is not null then return v_run_id; end if;
  end if;

  insert into public.payroll_runs(portfolio_id, company_id, branch_id, payroll_period_id, created_by, idempotency_key)
  values (v_portfolio_id, p_company_id, p_branch_id, v_period_id, auth.uid(), btrim(p_idempotency_key))
  returning id into v_run_id;

  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values (v_portfolio_id, p_company_id, p_branch_id, auth.uid(), 'PAYROLL_DRAFT_CREATED', 'payroll', v_run_id::text,
    jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end, 'frequency', p_frequency));
  return v_run_id;
end;
$$;

revoke all on function public.payroll_create_draft(uuid, uuid, date, date, text, text) from public, anon;
grant execute on function public.payroll_create_draft(uuid, uuid, date, date, text, text) to authenticated;

comment on function public.payroll_create_draft(uuid, uuid, date, date, text, text) is
  'Creates or returns an idempotent DRAFT payroll run only for a matching HR-approved attendance period and authorized payroll.prepare actor.';
