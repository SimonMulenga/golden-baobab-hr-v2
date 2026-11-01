-- M52: enrich the immutable payslip source snapshot with as-of leave and
-- repayment balances. All calculations use the finalized run's own period.

create or replace function app_private.payslip_financial_details(
  p_payroll_run_id uuid, p_employee_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_period_end date; v_version integer; v_details jsonb;
begin
  select pp.period_end, r.version into v_period_end, v_version
  from public.payroll_runs r
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  join public.payroll_run_items i on i.payroll_run_id = r.id
    and i.employee_id = p_employee_id and i.version = r.version
  where r.id = p_payroll_run_id and r.status = 'FINALIZED';
  if not found then
    raise exception using errcode = 'P0002', message = 'Finalized payslip source was not found.';
  end if;

  select jsonb_build_object(
    'leave', coalesce((
      select jsonb_build_object(
        'monthly_entitlement_days', round(coalesce(sum(lp.accrual_days_per_month), 0), 2),
        'balance_days', round(coalesce(sum(lb.balance_days), 0), 2),
        'policies', coalesce(jsonb_agg(jsonb_build_object(
          'leave_type', lp.leave_type,
          'monthly_entitlement_days', lp.accrual_days_per_month,
          'balance_days', lb.balance_days
        ) order by lp.leave_type), '[]'::jsonb)
      )
      from public.leave_policies lp
      left join lateral (
        select coalesce(sum(l.amount_delta), 0)::numeric(10,2) as balance_days
        from public.leave_balance_ledger l
        where l.portfolio_id = lp.portfolio_id and l.company_id = lp.company_id
          and l.employee_id = p_employee_id and l.leave_policy_id = lp.id
          and l.period_start <= v_period_end
      ) lb on true
      where lp.company_id = (select company_id from public.payroll_runs where id = p_payroll_run_id)
        and lp.portfolio_id = (select portfolio_id from public.payroll_runs where id = p_payroll_run_id)
        and lp.enabled and lp.pay_classification = 'PAID' and lp.accrual_days_per_month > 0
        and lp.effective_from <= v_period_end
        and (lp.effective_to is null or lp.effective_to >= v_period_end)
    ), jsonb_build_object('monthly_entitlement_days', 0, 'balance_days', 0, 'policies', '[]'::jsonb)),
    'deductions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', d.reason,
        'deduction_type', d.deduction_type,
        'total_amount', d.principal_amount,
        'amount_recovered', recovered.amount_recovered,
        'balance', greatest(0, d.principal_amount - recovered.amount_recovered)
      ) order by d.created_at, d.id)
      from public.employee_deductions d
      cross join lateral (
        select least(d.principal_amount, greatest(0, coalesce(sum(
          case when t.transaction_type = 'REVERSAL' then -t.amount else t.amount end
        ), 0)))::numeric(14,2) as amount_recovered
        from public.deduction_transactions t
        join public.payroll_runs tr on tr.id = t.payroll_run_id
        join public.payroll_periods tp on tp.id = tr.payroll_period_id
        where t.deduction_id = d.id and t.employee_id = p_employee_id
          and tp.period_end <= v_period_end
      ) recovered
      where d.employee_id = p_employee_id
        and d.company_id = (select company_id from public.payroll_runs where id = p_payroll_run_id)
        and d.portfolio_id = (select portfolio_id from public.payroll_runs where id = p_payroll_run_id)
        and d.start_period <= v_period_end and d.approved_at is not null
        and d.status not in ('DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELED')
        and d.principal_amount > recovered.amount_recovered
    ), '[]'::jsonb)
  ) into v_details;
  return v_details;
end;
$$;

revoke all on function app_private.payslip_financial_details(uuid,uuid) from public, anon, authenticated;

create or replace function app_private.payslip_snapshot_for_user(
  p_actor_id uuid, p_payroll_run_id uuid, p_employee_id uuid, p_issuance boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_payload jsonb;
begin
  select jsonb_build_object(
    'portfolio_id', r.portfolio_id,
    'company_id', r.company_id,
    'branch_id', r.branch_id,
    'payroll_run_id', r.id,
    'employee_id', i.employee_id,
    'payroll_version', i.version,
    'finalized_at', r.finalized_at,
    'period_start', pp.period_start,
    'period_end', pp.period_end,
    'company', jsonb_build_object('name', c.name, 'address', c.physical_address, 'town', c.town, 'province', c.province),
    'branch', jsonb_build_object('name', b.name),
    'employee', jsonb_build_object('employee_number', e.employee_number,
      'first_name', e.first_name, 'middle_name', e.middle_name, 'last_name', e.last_name,
      'job_title', e.job_title, 'department', e.department),
    'payroll_item', to_jsonb(i)
  ) into v_payload
  from public.payroll_runs r
  join public.payroll_periods pp on pp.id = r.payroll_period_id
  join public.companies c on c.id = r.company_id and c.portfolio_id = r.portfolio_id
  join public.branches b on b.id = r.branch_id and b.company_id = r.company_id and b.portfolio_id = r.portfolio_id
  join public.payroll_run_items i on i.payroll_run_id = r.id and i.version = r.version
  join public.employees e on e.id = i.employee_id and e.company_id = i.company_id and e.portfolio_id = i.portfolio_id
  where r.id = p_payroll_run_id and i.employee_id = p_employee_id and r.status = 'FINALIZED';
  if v_payload is null then
    raise exception using errcode = 'P0002', message = 'Finalized payslip source was not found.';
  end if;
  if p_actor_id is null then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  if not exists (
    select 1 from public.portfolio_memberships pm
    where pm.user_id = p_actor_id and pm.portfolio_id = (v_payload->>'portfolio_id')::uuid and pm.revoked_at is null
      and (
        (p_issuance and pm.role in ('PORTFOLIO_ADMIN','OVERALL_HR_MANAGER'))
        or (not p_issuance and pm.role in ('PORTFOLIO_ADMIN','OVERALL_HR_MANAGER'))
        or (not p_issuance and pm.role in ('BRANCH_MANAGER','PAYROLL_PROCESSOR') and exists (
          select 1 from public.branch_assignments ba where ba.user_id = p_actor_id
            and ba.portfolio_id = pm.portfolio_id and ba.company_id = (v_payload->>'company_id')::uuid
            and ba.branch_id = (v_payload->>'branch_id')::uuid and ba.role = pm.role and ba.revoked_at is null
        ))
      )
  ) then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  return v_payload || app_private.payslip_financial_details(p_payroll_run_id, p_employee_id);
end;
$$;
revoke all on function app_private.payslip_snapshot_for_user(uuid,uuid,uuid,boolean) from public, anon, authenticated;

create or replace function public.payslip_statement_details(
  p_payroll_run_id uuid, p_employee_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_scope record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  select r.portfolio_id, r.company_id, r.branch_id into v_scope
  from public.payroll_runs r
  join public.payroll_run_items i on i.payroll_run_id = r.id
    and i.employee_id = p_employee_id and i.version = r.version
  where r.id = p_payroll_run_id and r.status = 'FINALIZED';
  if not found or not app_private.has_permission(
    'payroll.view', v_scope.portfolio_id, v_scope.company_id, v_scope.branch_id
  ) then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  return app_private.payslip_financial_details(p_payroll_run_id, p_employee_id);
end;
$$;

revoke all on function public.payslip_statement_details(uuid,uuid) from public, anon;
grant execute on function public.payslip_statement_details(uuid,uuid) to authenticated;

-- Keep the server-side issuer aligned with the application's authorized
-- Overall HR / portfolio administrator roles. Scope still must match an
-- active portfolio membership and a real company and branch.
create or replace function app_private.payslip_actor_has_permission(
  p_actor_id uuid, p_permission text, p_portfolio_id uuid, p_company_id uuid, p_branch_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select p_actor_id is not null
    and p_permission in ('payslip.issue', 'payroll.finalize')
    and exists (
      select 1
      from public.portfolio_memberships pm
      join public.companies c on c.id = p_company_id and c.portfolio_id = p_portfolio_id
      join public.branches b on b.id = p_branch_id and b.company_id = c.id and b.portfolio_id = c.portfolio_id
      where pm.user_id = p_actor_id and pm.portfolio_id = p_portfolio_id and pm.revoked_at is null
        and pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER')
    );
$$;

comment on function public.payslip_statement_details(uuid,uuid) is
  'Returns leave entitlement/balance and active approved deduction balances as of the finalized payroll period, subject to payroll.view.';
