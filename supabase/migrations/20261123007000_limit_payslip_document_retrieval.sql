begin;

create table public.payslip_document_download_limits (
  document_id uuid not null references public.payslip_documents(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  primary key (document_id,actor_id)
);
alter table public.payslip_document_download_limits enable row level security;
revoke all on public.payslip_document_download_limits from public,anon,authenticated,service_role;

create table public.payslip_email_access_limits (
  token_id uuid primary key references public.payslip_email_access_tokens(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
alter table public.payslip_email_access_limits enable row level security;
revoke all on public.payslip_email_access_limits from public,anon,authenticated,service_role;

create function public.payslip_document_download_rate_limit(p_document_id uuid,p_actor_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype; v_count integer;
begin
  if auth.role()<>'service_role' or p_actor_id is null then
    raise exception using errcode='42501',message='Payslip download is not authorized.';
  end if;
  select * into v_doc from public.payslip_documents where id=p_document_id;
  if not found or not app_private.payslip_actor_has_permission(p_actor_id,'payroll.view',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id) then
    raise exception using errcode='42501',message='Payslip download is not authorized.';
  end if;
  insert into public.payslip_document_download_limits(document_id,actor_id,window_started_at,request_count)
    values(p_document_id,p_actor_id,now(),1)
  on conflict(document_id,actor_id) do update set
    window_started_at=case when public.payslip_document_download_limits.window_started_at<=now()-interval '1 minute' then now()
      else public.payslip_document_download_limits.window_started_at end,
    request_count=case when public.payslip_document_download_limits.window_started_at<=now()-interval '1 minute' then 1
      else public.payslip_document_download_limits.request_count+1 end
  returning request_count into v_count;
  return v_count<=20;
end $$;

create or replace function public.payslip_email_access_redeem(p_token_hash text,p_date_of_birth date)
returns table(storage_path text,content_sha256 text,encryption_version integer,birth_year text)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_access public.payslip_email_access_tokens%rowtype; v_doc public.payslip_documents%rowtype;
  v_employee public.employees%rowtype; v_delivery_status text; v_request_count integer;
begin
  if auth.role()<>'service_role' or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='Payslip access could not be verified.';
  end if;
  select * into v_access from public.payslip_email_access_tokens a where a.token_hash=p_token_hash for update;
  if not found or v_access.revoked_at is not null or v_access.expires_at<=now() or v_access.verification_attempts>=5 then
    raise exception using errcode='42501',message='Payslip access could not be verified.';
  end if;
  select q.status into v_delivery_status from public.payslip_email_deliveries q where q.id=v_access.delivery_id;
  if not found or v_delivery_status not in ('SENT','DELIVERED') then return; end if;
  select d.* into v_doc from public.payslip_email_deliveries q
    join public.payslip_documents d on d.id=q.document_id where q.id=v_access.delivery_id;
  if not found then return; end if;
  select e.* into v_employee from public.employees e where e.id=v_doc.employee_id
    and e.company_id=v_doc.company_id and e.portfolio_id=v_doc.portfolio_id and e.workplace_branch_id=v_doc.branch_id;
  if not found or v_employee.date_of_birth is null or p_date_of_birth is distinct from v_employee.date_of_birth then
    update public.payslip_email_access_tokens a set verification_attempts=a.verification_attempts+1 where a.id=v_access.id;
    return;
  end if;
  -- Successful opens do not consume failed-verification attempts, but are
  -- still rate-limited server-side so a valid link cannot flood document reads.
  insert into public.payslip_email_access_limits(token_id,window_started_at,request_count)
    values(v_access.id,now(),1)
  on conflict(token_id) do update set
    window_started_at=case when public.payslip_email_access_limits.window_started_at<=now()-interval '1 minute' then now()
      else public.payslip_email_access_limits.window_started_at end,
    request_count=case when public.payslip_email_access_limits.window_started_at<=now()-interval '1 minute' then 1
      else public.payslip_email_access_limits.request_count+1 end
  returning request_count into v_request_count;
  if v_request_count>20 then return; end if;
  update public.payslip_email_access_tokens a set last_verified_at=now() where a.id=v_access.id;
  return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version,to_char(v_employee.date_of_birth,'YYYY');
end $$;

revoke all on function public.payslip_document_download_rate_limit(uuid,uuid),
  public.payslip_email_access_redeem(text,date) from public,anon,authenticated,service_role;
grant execute on function public.payslip_document_download_rate_limit(uuid,uuid),
  public.payslip_email_access_redeem(text,date) to service_role;

comment on table public.payslip_document_download_limits is
  'Service-only sliding one-minute per administrator/document retrieval limits.';
comment on table public.payslip_email_access_limits is
  'Service-only sliding one-minute retrieval limit keyed by the hash-only emailed access token record.';

commit;
