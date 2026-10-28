-- M8 security hardening: company-wide policy administration is restricted to
-- portfolio administrators and Overall HR. Branch assignments do not confer
-- portfolio-wide leave-policy or accrual authority.

create or replace function public.leave_policy_save(
  p_portfolio_id uuid, p_company_id uuid, p_leave_type text, p_pay_classification text,
  p_accrual_days_per_month numeric, p_maximum_balance_days numeric, p_effective_from date, p_effective_to date default null
)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_id uuid;
begin
  if nullif(btrim(p_leave_type), '') is null or p_pay_classification not in ('PAID', 'UNPAID')
    or p_accrual_days_per_month < 0 or (p_pay_classification = 'UNPAID' and p_accrual_days_per_month <> 0)
    or p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from)
    or (p_maximum_balance_days is not null and p_maximum_balance_days <= 0) then
    raise exception using errcode = '22023', message = 'Leave policy values are invalid.';
  end if;
  if not (app_private.has_portfolio_role(p_portfolio_id, 'PORTFOLIO_ADMIN')
    or app_private.has_portfolio_role(p_portfolio_id, 'OVERALL_HR_MANAGER')) then
    raise exception using errcode = '42501', message = 'Leave policy management is not authorized.';
  end if;
  if exists (select 1 from public.leave_policies lp where lp.portfolio_id = p_portfolio_id and lp.company_id = p_company_id
    and lp.leave_type = btrim(p_leave_type) and daterange(lp.effective_from, lp.effective_to, '[]') &&
      daterange(p_effective_from, p_effective_to, '[]')) then
    select id into v_id from public.leave_policies lp where lp.portfolio_id = p_portfolio_id and lp.company_id = p_company_id
      and lp.leave_type = btrim(p_leave_type) and lp.effective_from = p_effective_from
      and lp.pay_classification = p_pay_classification and lp.accrual_days_per_month = p_accrual_days_per_month
      and lp.maximum_balance_days is not distinct from p_maximum_balance_days and lp.effective_to is not distinct from p_effective_to
      and lp.enabled;
    if v_id is not null then return v_id; end if;
    raise exception using errcode = '23P01', message = 'Leave policy effective dates overlap an existing version.';
  end if;
  insert into public.leave_policies(portfolio_id, company_id, leave_type, pay_classification, accrual_days_per_month,
    maximum_balance_days, effective_from, effective_to, created_by)
  values (p_portfolio_id, p_company_id, btrim(p_leave_type), p_pay_classification, p_accrual_days_per_month,
    p_maximum_balance_days, p_effective_from, p_effective_to, auth.uid()) returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (p_portfolio_id, p_company_id, auth.uid(), 'LEAVE_POLICY_SAVED', 'leave', v_id::text,
    jsonb_build_object('leave_type', btrim(p_leave_type), 'effective_from', p_effective_from));
  return v_id;
end $$;

create or replace function public.leave_accrue_month(p_policy_id uuid, p_period_start date)
returns integer language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_policy public.leave_policies%rowtype; v_count integer;
begin
  if p_period_start is null or date_trunc('month', p_period_start)::date <> p_period_start then
    raise exception using errcode = '22023', message = 'Accrual period must be the first day of a month.';
  end if;
  select * into v_policy from public.leave_policies where id = p_policy_id for update;
  if not found or not v_policy.enabled or v_policy.pay_classification <> 'PAID' or v_policy.accrual_days_per_month <= 0
    or p_period_start < v_policy.effective_from or (v_policy.effective_to is not null and p_period_start > v_policy.effective_to)
    or not (app_private.has_portfolio_role(v_policy.portfolio_id, 'PORTFOLIO_ADMIN')
      or app_private.has_portfolio_role(v_policy.portfolio_id, 'OVERALL_HR_MANAGER')) then
    raise exception using errcode = '42501', message = 'Leave accrual is not authorized or the policy is not effective.';
  end if;
  insert into public.leave_balance_ledger(portfolio_id, company_id, branch_id, employee_id, leave_policy_id,
    event_type, amount_delta, reference_id, period_start, actor_id)
  select e.portfolio_id, e.company_id, e.workplace_branch_id, e.id, v_policy.id, 'ACCRUAL',
    case when v_policy.maximum_balance_days is null then v_policy.accrual_days_per_month
      else least(v_policy.accrual_days_per_month, greatest(v_policy.maximum_balance_days - coalesce(b.balance, 0), 0)) end,
    to_char(p_period_start, 'YYYY-MM'), p_period_start, auth.uid()
  from public.employees e
  left join lateral (select sum(l.amount_delta) as balance from public.leave_balance_ledger l
    where l.employee_id = e.id and l.leave_policy_id = v_policy.id) b on true
  where e.portfolio_id = v_policy.portfolio_id and e.company_id = v_policy.company_id and e.approval_status = 'APPROVED'
    and e.contract_start_date <= (p_period_start + interval '1 month - 1 day')::date
    and (e.contract_end_date is null or e.contract_end_date >= p_period_start)
    and (v_policy.maximum_balance_days is null or coalesce(b.balance, 0) < v_policy.maximum_balance_days)
  on conflict (portfolio_id, company_id, employee_id, leave_policy_id, event_type, reference_id) do nothing;
  get diagnostics v_count = row_count;
  insert into public.audit_logs(portfolio_id, company_id, actor_id, action, module, record_id, details)
  values (v_policy.portfolio_id, v_policy.company_id, auth.uid(), 'LEAVE_MONTH_ACCRUED', 'leave', v_policy.id::text,
    jsonb_build_object('period_start', p_period_start, 'new_employee_balances', v_count));
  return v_count;
end $$;

revoke all on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) from public, anon;
revoke all on function public.leave_accrue_month(uuid, date) from public, anon;
grant execute on function public.leave_policy_save(uuid, uuid, text, text, numeric, numeric, date, date) to authenticated;
grant execute on function public.leave_accrue_month(uuid, date) to authenticated;

