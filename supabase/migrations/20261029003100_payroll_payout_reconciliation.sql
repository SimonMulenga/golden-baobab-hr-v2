-- Reconcile finalized payout instructions with an organization's external
-- bank/mobile-money statement. This records evidence only; it never transfers.

create unique index payroll_payout_exports_tenant_id_unique
  on public.payroll_payout_exports(portfolio_id,company_id,branch_id,id);

create table public.payroll_payout_reconciliations (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payout_export_id uuid not null references public.payroll_payout_exports(id) on delete restrict,
  payroll_run_id uuid not null,
  payroll_version integer not null check (payroll_version > 0),
  employee_id uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING','NO_PAYMENT_DUE','PAID','PARTIAL','FAILED','RETURNED')),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  paid_at date,
  provider_reference text check (provider_reference is null or char_length(btrim(provider_reference)) between 1 and 120),
  note text check (note is null or char_length(note) <= 1000),
  reconciled_by uuid not null references public.profiles(id) on delete restrict,
  reconciled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (payout_export_id,employee_id),
  foreign key (portfolio_id,company_id,branch_id,payroll_run_id)
    references public.payroll_runs(portfolio_id,company_id,branch_id,id) on delete restrict,
  foreign key (portfolio_id,company_id,branch_id,payout_export_id)
    references public.payroll_payout_exports(portfolio_id,company_id,branch_id,id) on delete restrict,
  foreign key (portfolio_id,company_id,branch_id,employee_id)
    references public.employees(portfolio_id,company_id,workplace_branch_id,id) on delete restrict,
  check (
    (status='PENDING' and paid_amount=0 and paid_at is null and provider_reference is null)
    or (status='NO_PAYMENT_DUE' and paid_amount=0 and paid_at is null and provider_reference is null)
    or (status='PAID' and paid_amount>0 and paid_at is not null and provider_reference is not null)
    or (status='PARTIAL' and paid_amount>0 and paid_at is not null and provider_reference is not null)
    or (status in ('FAILED','RETURNED') and paid_amount=0)
  )
);
create index payroll_payout_reconciliation_batch_idx
  on public.payroll_payout_reconciliations(portfolio_id,company_id,branch_id,payout_export_id,status,employee_id);
alter table public.payroll_payout_reconciliations enable row level security;
revoke all on public.payroll_payout_reconciliations from public,anon,authenticated;

create or replace function public.payroll_payout_reconciliation_batches(p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v_portfolio uuid;
begin
  select b.portfolio_id into v_portfolio
  from public.branches b where b.company_id=p_company_id and b.id=p_branch_id;
  if not found or auth.uid() is null
    or not app_private.has_permission('payroll.finalize',v_portfolio,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Payout reconciliation is unavailable for the selected branch.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'export_id',e.id,'payroll_run_id',e.payroll_run_id,'payroll_version',e.payroll_version,
      'created_at',e.created_at,'instruction_count',e.instruction_count,
      'manifest_sha256',e.manifest_sha256,'expected_total',coalesce(x.expected_total,0),
      'reconciled_count',coalesce(x.reconciled_count,0),'paid_count',coalesce(x.paid_count,0),
      'partial_count',coalesce(x.partial_count,0),'failed_count',coalesce(x.failed_count,0),
      'returned_count',coalesce(x.returned_count,0),'no_payment_due_count',coalesce(x.no_payment_due_count,0)
    ) order by e.created_at desc)
    from public.payroll_payout_exports e
    join public.payroll_runs r on r.id=e.payroll_run_id and r.status='FINALIZED' and r.version=e.payroll_version
    left join lateral (
      select sum((i.item->>'net_pay')::numeric) as expected_total,
        count(*) filter (where q.status is not null and q.status<>'PENDING') as reconciled_count,
        count(*) filter (where q.status='PAID') as paid_count,
        count(*) filter (where q.status='PARTIAL') as partial_count,
        count(*) filter (where q.status='FAILED') as failed_count,
        count(*) filter (where q.status='RETURNED') as returned_count,
        count(*) filter (where q.status='NO_PAYMENT_DUE') as no_payment_due_count
      from jsonb_array_elements(e.instructions) i(item)
      left join public.payroll_payout_reconciliations q
        on q.payout_export_id=e.id and q.employee_id=(i.item->>'employee_id')::uuid
    ) x on true
    where e.portfolio_id=v_portfolio and e.company_id=p_company_id and e.branch_id=p_branch_id
      and app_private.has_permission('payroll.finalize',e.portfolio_id,e.company_id,e.branch_id)
  ),'[]'::jsonb);
end $$;
revoke all on function public.payroll_payout_reconciliation_batches(uuid,uuid) from public,anon;
grant execute on function public.payroll_payout_reconciliation_batches(uuid,uuid) to authenticated;

create or replace function public.payroll_payout_reconciliation_detail(p_export_id uuid,p_page integer default 1,p_page_size integer default 50)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v_export public.payroll_payout_exports%rowtype; v_total integer; v_items jsonb;
begin
  select * into v_export from public.payroll_payout_exports where id=p_export_id;
  if not found or auth.uid() is null
    or not app_private.has_permission('payroll.finalize',v_export.portfolio_id,v_export.company_id,v_export.branch_id) then
    raise exception using errcode='42501',message='Payout reconciliation is unavailable for the selected batch.';
  end if;
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception using errcode='22023',message='Invalid payout reconciliation page.';
  end if;
  select count(*) into v_total from jsonb_array_elements(v_export.instructions);
  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id',x.item->>'employee_id','employee_number',x.item->>'employee_number',
    'employee_name',x.item->>'employee_name','expected_amount',(x.item->>'net_pay')::numeric,
    'status',coalesce(q.status,'PENDING'),'paid_amount',coalesce(q.paid_amount,0),
    'paid_at',q.paid_at,'provider_reference',q.provider_reference,'note',q.note,
    'reconciled_at',q.reconciled_at
  ) order by x.item->>'employee_number'),'[]'::jsonb) into v_items
  from (
    select i.item from jsonb_array_elements(v_export.instructions) i(item)
    order by i.item->>'employee_number'
    offset ((p_page::bigint-1)*p_page_size) limit p_page_size
  ) x
  left join public.payroll_payout_reconciliations q
    on q.payout_export_id=v_export.id and q.employee_id=(x.item->>'employee_id')::uuid;
  return jsonb_build_object('total',v_total,'page',p_page,'page_size',p_page_size,'items',v_items);
end $$;
revoke all on function public.payroll_payout_reconciliation_detail(uuid,integer,integer) from public,anon;
grant execute on function public.payroll_payout_reconciliation_detail(uuid,integer,integer) to authenticated;

create or replace function public.payroll_payout_reconciliation_save(
  p_export_id uuid,p_employee_id uuid,p_status text,p_paid_amount numeric default 0,
  p_paid_at date default null,p_provider_reference text default null,p_note text default null
) returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare
  v_export public.payroll_payout_exports%rowtype;
  v_run public.payroll_runs%rowtype;
  v_item jsonb;
  v_expected numeric(14,2);
  v_id uuid;
begin
  select * into v_export from public.payroll_payout_exports where id=p_export_id;
  if not found or auth.uid() is null
    or not app_private.has_permission('payroll.finalize',v_export.portfolio_id,v_export.company_id,v_export.branch_id) then
    raise exception using errcode='42501',message='Payout reconciliation is unavailable for the selected batch.';
  end if;
  select * into v_run from public.payroll_runs r where r.id=v_export.payroll_run_id
    and r.status='FINALIZED' and r.version=v_export.payroll_version for share;
  if not found then
    raise exception using errcode='55000',message='Only the matching finalized payroll version may be reconciled.';
  end if;
  select i.item into v_item from jsonb_array_elements(v_export.instructions) i(item)
    where i.item->>'employee_id'=p_employee_id::text;
  if not found then raise exception using errcode='22023',message='Employee is not in this payout batch.'; end if;
  v_expected:=(v_item->>'net_pay')::numeric(14,2);
  if v_expected is null or v_expected<0
    or p_status is null or p_status not in ('PENDING','NO_PAYMENT_DUE','PAID','PARTIAL','FAILED','RETURNED')
    or p_paid_amount is null or p_paid_amount<0 or p_paid_amount>v_expected or p_paid_amount<>round(p_paid_amount,2)
    or nullif(btrim(p_provider_reference),'') is distinct from p_provider_reference
    or char_length(coalesce(p_provider_reference,''))>120
    or char_length(coalesce(p_note,''))>1000
    or (p_status='PENDING' and (p_paid_amount<>0 or p_paid_at is not null or p_provider_reference is not null))
    or (p_status='NO_PAYMENT_DUE' and (v_expected<>0 or p_paid_amount<>0 or p_paid_at is not null or p_provider_reference is not null))
    or (p_status='PAID' and (v_expected<=0 or p_paid_amount<>v_expected or p_paid_at is null or nullif(btrim(p_provider_reference),'') is null))
    or (p_status='PARTIAL' and (p_paid_amount<=0 or p_paid_amount>=v_expected or p_paid_at is null or nullif(btrim(p_provider_reference),'') is null))
    or (p_status in ('FAILED','RETURNED') and p_paid_amount<>0) then
    raise exception using errcode='22023',message='Payout reconciliation values do not match the selected outcome.';
  end if;
  insert into public.payroll_payout_reconciliations(
    portfolio_id,company_id,branch_id,payout_export_id,payroll_run_id,payroll_version,
    employee_id,status,paid_amount,paid_at,provider_reference,note,reconciled_by
    ) values (
    v_export.portfolio_id,v_export.company_id,v_export.branch_id,v_export.id,v_export.payroll_run_id,v_export.payroll_version,
    p_employee_id,p_status,p_paid_amount,case when p_status in ('PENDING','NO_PAYMENT_DUE','FAILED','RETURNED') then null else p_paid_at end,
    case when p_status in ('PENDING','NO_PAYMENT_DUE') then null else nullif(btrim(p_provider_reference),'') end,
    nullif(btrim(p_note),''),auth.uid()
  ) on conflict(payout_export_id,employee_id) do update set
    status=excluded.status,paid_amount=excluded.paid_amount,paid_at=excluded.paid_at,
    provider_reference=excluded.provider_reference,note=excluded.note,
    reconciled_by=excluded.reconciled_by,reconciled_at=now()
  returning id into v_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_export.portfolio_id,v_export.company_id,v_export.branch_id,auth.uid(),
    'PAYOUT_RECONCILIATION_UPDATED','payroll',v_export.id::text||':'||p_employee_id::text,
    jsonb_build_object('payroll_run_id',v_export.payroll_run_id,'payroll_version',v_export.payroll_version,
      'status',p_status,'paid_amount',p_paid_amount));
  return v_id;
end $$;
revoke all on function public.payroll_payout_reconciliation_save(uuid,uuid,text,numeric,date,text,text) from public,anon;
grant execute on function public.payroll_payout_reconciliation_save(uuid,uuid,text,numeric,date,text,text) to authenticated;

comment on table public.payroll_payout_reconciliations is
  'Restricted reconciliation evidence for finalized payout instruction batches. No payment is initiated; bank account details are not copied here.';
