-- Track manual filing and remittance against immutable finalized payroll.
-- This migration does not submit returns or initiate payments.

create table public.statutory_filing_records (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  payroll_version integer not null check (payroll_version > 0),
  authority text not null check (authority in ('PAYE','NAPSA','NHIMA')),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  liability_amount numeric(14,2) not null check (liability_amount >= 0),
  filing_status text not null default 'NOT_STARTED'
    check (filing_status in ('NOT_STARTED','SUBMITTED','ACCEPTED','REJECTED')),
  submitted_at timestamptz,
  submission_reference text check (submission_reference is null or char_length(btrim(submission_reference)) between 1 and 160),
  remittance_status text not null default 'UNPAID' check (remittance_status in ('UNPAID','PARTIAL','PAID')),
  remitted_amount numeric(14,2) not null default 0 check (remitted_amount >= 0),
  remitted_at timestamptz,
  remittance_reference text check (remittance_reference is null or char_length(btrim(remittance_reference)) between 1 and 160),
  note text check (note is null or char_length(note) <= 1000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_run_id,payroll_version,authority),
  unique (portfolio_id,company_id,branch_id,id),
  foreign key (portfolio_id,company_id,branch_id,payroll_run_id)
    references public.payroll_runs(portfolio_id,company_id,branch_id,id) on delete restrict,
  check (period_end >= period_start),
  check (remitted_amount <= liability_amount),
  check ((filing_status='NOT_STARTED' and submitted_at is null and submission_reference is null)
      or (filing_status in ('SUBMITTED','ACCEPTED','REJECTED') and submitted_at is not null and submission_reference is not null)),
  check ((remittance_status='UNPAID' and remitted_amount=0)
      or (remittance_status='PARTIAL' and remitted_amount>0 and remitted_amount<liability_amount)
      or (remittance_status='PAID' and remitted_amount=liability_amount)),
  check ((remittance_status='UNPAID' and remitted_at is null and remittance_reference is null)
      or (remittance_status in ('PARTIAL','PAID') and remitted_at is not null and remittance_reference is not null))
);

create index statutory_filing_scope_due_idx
  on public.statutory_filing_records(portfolio_id,company_id,branch_id,due_date desc,authority);
alter table public.statutory_filing_records enable row level security;
revoke all on public.statutory_filing_records from public,anon,authenticated;

create or replace function public.statutory_filing_list(
  p_company_id uuid,p_branch_id uuid,p_page integer default 1,p_page_size integer default 25
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v_portfolio uuid; v_total integer; v_items jsonb;
begin
  select b.portfolio_id into v_portfolio from public.branches b
    where b.company_id=p_company_id and b.id=p_branch_id;
  if not found or auth.uid() is null
     or not app_private.has_permission('payroll.finalize',v_portfolio,p_company_id,p_branch_id) then
    raise exception using errcode='42501',message='Statutory filing records are unavailable for this branch.';
  end if;
  if p_page is null or p_page<1 or p_page_size is null or p_page_size not between 1 and 100 then
    raise exception using errcode='22023',message='Invalid statutory filing page.';
  end if;
  select count(*) into v_total from public.statutory_filing_records f
    where f.portfolio_id=v_portfolio and f.company_id=p_company_id and f.branch_id=p_branch_id;
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.period_start desc,page_rows.authority), '[]'::jsonb)
    into v_items from (
      select f.id,f.payroll_run_id,f.payroll_version,f.authority,f.period_start,f.period_end,f.due_date,
        f.liability_amount,f.filing_status,f.submitted_at,f.submission_reference,f.remittance_status,
        f.remitted_amount,f.remitted_at,f.remittance_reference,f.note,f.updated_at
      from public.statutory_filing_records f
      where f.portfolio_id=v_portfolio and f.company_id=p_company_id and f.branch_id=p_branch_id
      order by f.period_start desc,f.authority
      offset ((p_page::bigint-1)*p_page_size) limit p_page_size
    ) page_rows;
  return jsonb_build_object('items',v_items,'total',v_total,'page',p_page,'page_size',p_page_size);
end $$;
revoke all on function public.statutory_filing_list(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.statutory_filing_list(uuid,uuid,integer,integer) to authenticated;

create or replace function public.statutory_filing_prepare(
  p_payroll_run_id uuid,p_authority text,p_due_date date
) returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype;
  v_liability numeric(14,2);
  v_id uuid;
begin
  if auth.uid() is null or p_payroll_run_id is null or p_due_date is null
     or p_authority is null or p_authority not in ('PAYE','NAPSA','NHIMA') then
    raise exception using errcode='22023',message='A finalized run, supported authority, and approved due date are required.';
  end if;
  select * into v_run from public.payroll_runs r where r.id=p_payroll_run_id for share;
  if not found or v_run.status<>'FINALIZED' or v_run.finalized_at is null
     or not app_private.has_permission('payroll.finalize',v_run.portfolio_id,v_run.company_id,v_run.branch_id) then
    raise exception using errcode='42501',message='Only authorized users may prepare a filing from finalized payroll.';
  end if;
  select * into v_period from public.payroll_periods p where p.id=v_run.payroll_period_id
    and p.portfolio_id=v_run.portfolio_id and p.company_id=v_run.company_id and p.branch_id=v_run.branch_id;
  if not found then raise exception using errcode='55000',message='Finalized payroll period is unavailable.'; end if;
  select round(coalesce(sum(case p_authority
    when 'PAYE' then coalesce((i.statutory_deductions->>'PAYE')::numeric,0)
    when 'NAPSA' then i.napsa_employee+i.napsa_employer
    when 'NHIMA' then i.nhima_employee+i.nhima_employer end),0),2)
    into v_liability from public.payroll_run_items i
    where i.payroll_run_id=v_run.id and i.version=v_run.version
      and i.portfolio_id=v_run.portfolio_id and i.company_id=v_run.company_id and i.branch_id=v_run.branch_id;
  if v_liability is null or v_liability<0 then
    raise exception using errcode='55000',message='Finalized statutory amounts could not be derived.';
  end if;
  insert into public.statutory_filing_records(
    portfolio_id,company_id,branch_id,payroll_run_id,payroll_version,authority,
    period_start,period_end,due_date,liability_amount,created_by,updated_by
  ) values (
    v_run.portfolio_id,v_run.company_id,v_run.branch_id,v_run.id,v_run.version,p_authority,
    v_period.period_start,v_period.period_end,p_due_date,v_liability,auth.uid(),auth.uid()
  ) on conflict(payroll_run_id,payroll_version,authority) do nothing returning id into v_id;
  if v_id is null then
    select f.id into v_id from public.statutory_filing_records f
      where f.payroll_run_id=v_run.id and f.payroll_version=v_run.version and f.authority=p_authority;
  else
    insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
      values(v_run.portfolio_id,v_run.company_id,v_run.branch_id,auth.uid(),'STATUTORY_FILING_PREPARED','statutory',v_id::text,
        jsonb_build_object('authority',p_authority,'period_start',v_period.period_start,'period_end',v_period.period_end,'liability_amount',v_liability));
  end if;
  return v_id;
end $$;
revoke all on function public.statutory_filing_prepare(uuid,text,date) from public,anon;
grant execute on function public.statutory_filing_prepare(uuid,text,date) to authenticated;

create or replace function public.statutory_filing_update(
  p_filing_id uuid,p_filing_status text,p_submitted_at timestamptz,p_submission_reference text,
  p_remittance_status text,p_remitted_amount numeric,p_remitted_at timestamptz,
  p_remittance_reference text,p_note text
) returns uuid language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare v public.statutory_filing_records%rowtype;
begin
  select * into v from public.statutory_filing_records where id=p_filing_id for update;
  if not found or auth.uid() is null
     or not app_private.has_permission('payroll.finalize',v.portfolio_id,v.company_id,v.branch_id) then
    raise exception using errcode='42501',message='Statutory filing update is unauthorized.';
  end if;
  if p_filing_status is null or p_filing_status not in ('NOT_STARTED','SUBMITTED','ACCEPTED','REJECTED')
     or p_remittance_status is null or p_remittance_status not in ('UNPAID','PARTIAL','PAID')
     or p_remitted_amount is null or p_remitted_amount<0 or p_remitted_amount>v.liability_amount
     or p_remitted_amount<>round(p_remitted_amount,2)
     or char_length(coalesce(p_submission_reference,''))>160
     or char_length(coalesce(p_remittance_reference,''))>160
     or char_length(coalesce(p_note,''))>1000
     or (p_filing_status='NOT_STARTED' and (p_submitted_at is not null or p_submission_reference is not null))
     or (p_filing_status in ('SUBMITTED','ACCEPTED','REJECTED') and (p_submitted_at is null or nullif(btrim(p_submission_reference),'') is null))
     or (p_filing_status='REJECTED' and nullif(btrim(p_note),'') is null)
     or (p_remittance_status='UNPAID' and (p_remitted_amount<>0 or p_remitted_at is not null or p_remittance_reference is not null))
     or (p_remittance_status='PARTIAL' and (p_remitted_amount<=0 or p_remitted_amount>=v.liability_amount or p_remitted_at is null or nullif(btrim(p_remittance_reference),'') is null))
     or (p_remittance_status='PAID' and (p_remitted_amount<>v.liability_amount or p_remitted_at is null or nullif(btrim(p_remittance_reference),'') is null)) then
    raise exception using errcode='22023',message='Filing and remittance values are inconsistent with the finalized liability.';
  end if;
  update public.statutory_filing_records set
    filing_status=p_filing_status,submitted_at=p_submitted_at,
    submission_reference=nullif(btrim(p_submission_reference),''),remittance_status=p_remittance_status,
    remitted_amount=p_remitted_amount,remitted_at=p_remitted_at,
    remittance_reference=nullif(btrim(p_remittance_reference),''),note=nullif(btrim(p_note),''),
    updated_by=auth.uid(),updated_at=now()
    where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,v.branch_id,auth.uid(),'STATUTORY_FILING_UPDATED','statutory',v.id::text,
      jsonb_build_object('authority',v.authority,'filing_status',p_filing_status,'remittance_status',p_remittance_status,
        'previous_filing_status',v.filing_status,'previous_remittance_status',v.remittance_status,
        'previous_remitted_amount',v.remitted_amount,'remitted_amount',p_remitted_amount,'liability_amount',v.liability_amount));
  return v.id;
end $$;
revoke all on function public.statutory_filing_update(uuid,text,timestamptz,text,text,numeric,timestamptz,text,text) from public,anon;
grant execute on function public.statutory_filing_update(uuid,text,timestamptz,text,text,numeric,timestamptz,text,text) to authenticated;

comment on table public.statutory_filing_records is
  'Manual filing and remittance status reconciled to immutable finalized payroll. This table never submits returns or initiates payments.';
