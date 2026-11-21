-- Secure bulk distribution, employee-verified 48-hour access, and delivery events.
-- Existing immutable PDFs and finalized payroll snapshots remain unchanged.

alter table public.payslip_email_deliveries
  drop constraint payslip_email_deliveries_status_check;
alter table public.payslip_email_deliveries
  add constraint payslip_email_deliveries_status_check
  check (status in ('QUEUED','SENDING','SENT','DELIVERED','FAILED','BOUNCED'));
alter table public.payslip_email_deliveries
  add column delivered_at timestamptz,
  add column bounced_at timestamptz;

create table public.payslip_email_access_tokens (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique references public.payslip_email_deliveries(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  verification_attempts integer not null default 0 check (verification_attempts between 0 and 5),
  last_verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index payslip_email_access_expiry_idx on public.payslip_email_access_tokens(expires_at) where revoked_at is null;
alter table public.payslip_email_access_tokens enable row level security;
revoke all on public.payslip_email_access_tokens from public, anon, authenticated;
grant select, insert, update on public.payslip_email_access_tokens to service_role;

create table public.payslip_email_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_message_id text not null,
  delivery_id uuid references public.payslip_email_deliveries(id) on delete restrict,
  event_type text not null check (event_type in ('email.sent','email.delivered','email.bounced','email.failed','email.delivery_delayed')),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  safe_error_code text
);
create index payslip_email_events_delivery_idx on public.payslip_email_events(delivery_id, received_at desc);
create index payslip_email_events_message_pending_idx on public.payslip_email_events(provider_message_id, occurred_at) where delivery_id is null;
alter table public.payslip_email_events enable row level security;
revoke all on public.payslip_email_events from public, anon, authenticated;
grant select, insert on public.payslip_email_events to service_role;

-- Keep enqueue idempotent under concurrent clicks and reject malformed addresses
-- before creating a durable delivery row. Delivery itself remains server-gated.
create or replace function public.payslip_email_enqueue(p_document_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype; v_email text; v_id uuid; v_status text;
begin
  select * into v_doc from public.payslip_documents where id=p_document_id;
  if not found or not app_private.has_permission('payroll.finalize',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id)
      or not app_private.has_permission('payslip.issue',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id) then
    raise exception using errcode='42501',message='Payslip delivery is not authorized.';
  end if;
  select nullif(btrim(pd.email),'') into v_email from public.employee_private_details pd
    where pd.employee_id=v_doc.employee_id and pd.company_id=v_doc.company_id and pd.portfolio_id=v_doc.portfolio_id;
  if v_email is null or char_length(v_email)>320 or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Employee delivery email is missing or invalid.';
  end if;
  insert into public.payslip_email_deliveries(document_id,portfolio_id,company_id,branch_id,recipient_email,created_by)
    values(v_doc.id,v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id,v_email,auth.uid())
    on conflict(document_id) do nothing returning id into v_id;
  if v_id is null then
    select id,status into v_id,v_status from public.payslip_email_deliveries where document_id=p_document_id;
    if v_status not in ('QUEUED','SENDING','SENT','DELIVERED') then
      raise exception using errcode='23505',message='Delivery already exists; use the authorized retry action if it failed.';
    end if;
    return v_id;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id)
    values(v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id,auth.uid(),'PAYSLIP_EMAIL_QUEUED','payslips',v_id::text);
  return v_id;
end $$;

create or replace function public.payslip_email_retry(p_delivery_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype;
begin
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id for update;
  if not found or not app_private.has_permission('payroll.finalize',v_job.portfolio_id,v_job.company_id,v_job.branch_id)
      or not app_private.has_permission('payslip.issue',v_job.portfolio_id,v_job.company_id,v_job.branch_id) then
    raise exception using errcode='42501',message='Delivery retry is not authorized.';
  end if;
  if v_job.attempts>=3 or not (v_job.status='FAILED' or
      (v_job.status='SENDING' and v_job.updated_at<now()-interval '10 minutes')) then
    raise exception using errcode='22023',message='Only failed or stale deliveries with fewer than three attempts may be retried.';
  end if;
  update public.payslip_email_deliveries set status='QUEUED',last_error_code=null,updated_at=now() where id=p_delivery_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id)
    values(v_job.portfolio_id,v_job.company_id,v_job.branch_id,auth.uid(),'PAYSLIP_EMAIL_RETRY_QUEUED','payslips',p_delivery_id::text);
  return p_delivery_id;
end $$;

create or replace function public.payslip_distribution_preview(
  p_payroll_run_id uuid, p_page integer default 1, p_page_size integer default 100
) returns table (
  employee_id uuid, employee_number text, first_name text, middle_name text, last_name text,
  company_id uuid, branch_id uuid, branch_name text, department text, job_title text,
  recipient_email text, document_id uuid, delivery_id uuid, delivery_status text, delivery_attempts integer,
  total_count bigint
) language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_run record;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='Payslip distribution access is not authorized.'; end if;
  select r.id, r.portfolio_id, r.company_id, r.branch_id, r.version, r.status
    into v_run from public.payroll_runs r where r.id=p_payroll_run_id;
  if not found or v_run.status <> 'FINALIZED'
     or not app_private.has_permission('payroll.finalize',v_run.portfolio_id,v_run.company_id,v_run.branch_id)
     or not app_private.has_permission('payslip.issue',v_run.portfolio_id,v_run.company_id,v_run.branch_id)
     or not app_private.has_permission('employee.private.view',v_run.portfolio_id,v_run.company_id,v_run.branch_id) then
    raise exception using errcode='42501', message='Payslip distribution access is not authorized.';
  end if;
  return query
    with candidates as (
      select e.id employee_id,e.employee_number,e.first_name,e.middle_name,e.last_name,
        e.company_id,e.workplace_branch_id branch_id,b.name branch_name,e.department,e.job_title,
        nullif(btrim(pd.email),'') recipient_email,d.id document_id,q.id delivery_id,q.status delivery_status,
        q.attempts delivery_attempts
      from public.payroll_run_items i
      join public.employees e on e.id=i.employee_id and e.company_id=i.company_id and e.portfolio_id=i.portfolio_id
      join public.branches b on b.id=e.workplace_branch_id and b.company_id=e.company_id and b.portfolio_id=e.portfolio_id
      left join public.employee_private_details pd on pd.employee_id=e.id and pd.company_id=e.company_id and pd.portfolio_id=e.portfolio_id
      left join public.payslip_documents d on d.payroll_run_id=i.payroll_run_id and d.employee_id=i.employee_id and d.payroll_version=i.version
      left join public.payslip_email_deliveries q on q.document_id=d.id
      where i.payroll_run_id=v_run.id and i.version=v_run.version
    )
    select c.employee_id,c.employee_number,c.first_name,c.middle_name,c.last_name,c.company_id,c.branch_id,
      c.branch_name,c.department,c.job_title,c.recipient_email,c.document_id,c.delivery_id,
      coalesce(c.delivery_status,'PENDING'),coalesce(c.delivery_attempts,0),count(*) over()::bigint
    from candidates c
    order by c.last_name,c.first_name,c.employee_number
    offset greatest(0,(greatest(1,p_page)-1)*least(200,greatest(1,p_page_size)))
    limit least(200,greatest(1,p_page_size));
end $$;

create or replace function public.payslip_email_prepare_access(
  p_delivery_id uuid, p_token_hash text, p_actor_id uuid
) returns timestamptz language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype; v_expiry timestamptz;
begin
  if auth.role()<>'service_role' or p_actor_id is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501', message='Payslip access preparation is not authorized.';
  end if;
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id for update;
  if not found or v_job.status<>'SENDING' or not app_private.payslip_actor_has_permission(
    p_actor_id,'payroll.finalize',v_job.portfolio_id,v_job.company_id,v_job.branch_id
  ) then raise exception using errcode='42501', message='Payslip access preparation is not authorized.'; end if;
  v_expiry:=now()+interval '48 hours';
  insert into public.payslip_email_access_tokens(delivery_id,token_hash,expires_at)
    values(p_delivery_id,p_token_hash,v_expiry)
  on conflict(delivery_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,
    revoked_at=null,verification_attempts=0,last_verified_at=null,created_at=now();
  return v_expiry;
end $$;

create or replace function public.payslip_email_mark_sent(
  p_delivery_id uuid, p_provider_message_id text, p_actor_id uuid
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype; v_event public.payslip_email_events%rowtype;
begin
  if auth.role()<>'service_role' or p_actor_id is null or nullif(p_provider_message_id,'') is null then
    raise exception using errcode='42501',message='Delivery state update is not authorized.';
  end if;
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id for update;
  if not found or not app_private.payslip_actor_has_permission(p_actor_id,'payroll.finalize',v_job.portfolio_id,v_job.company_id,v_job.branch_id) then
    raise exception using errcode='42501',message='Delivery state update is not authorized.';
  end if;
  if v_job.status='SENDING' then
    update public.payslip_email_deliveries set status='SENT',provider_message_id=p_provider_message_id,
      sent_at=coalesce(sent_at,now()),updated_at=now(),last_error_code=null where id=p_delivery_id;
    insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
      values(v_job.portfolio_id,v_job.company_id,v_job.branch_id,p_actor_id,'PAYSLIP_EMAIL_PROVIDER_ACCEPTED','payslips',p_delivery_id::text,
        jsonb_build_object('attempt',v_job.attempts));
  elsif v_job.status not in ('SENT','DELIVERED') or v_job.provider_message_id is distinct from p_provider_message_id then
    return false;
  end if;
  for v_event in select * from public.payslip_email_events e where e.delivery_id is null
      and e.provider_message_id=p_provider_message_id order by coalesce(e.occurred_at,e.received_at),e.received_at for update
  loop
    update public.payslip_email_events set delivery_id=p_delivery_id where id=v_event.id;
    if v_event.event_type='email.delivered' then
      update public.payslip_email_deliveries set status='DELIVERED',delivered_at=coalesce(delivered_at,v_event.occurred_at,now()),updated_at=now()
        where id=p_delivery_id and status<>'BOUNCED';
    elsif v_event.event_type='email.bounced' then
      update public.payslip_email_deliveries set status='BOUNCED',bounced_at=coalesce(bounced_at,v_event.occurred_at,now()),updated_at=now()
        where id=p_delivery_id and delivered_at is null;
    elsif v_event.event_type='email.failed' then
      update public.payslip_email_deliveries set status='FAILED',last_error_code='PROVIDER_REPORTED_FAILURE',updated_at=now()
        where id=p_delivery_id and status not in ('DELIVERED','BOUNCED');
    end if;
  end loop;
  return true;
end $$;

create or replace function public.payslip_email_mark_failed(
  p_delivery_id uuid, p_safe_error_code text, p_actor_id uuid
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype; v_code text;
begin
  if auth.role()<>'service_role' or p_actor_id is null then
    raise exception using errcode='42501',message='Delivery state update is not authorized.';
  end if;
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id for update;
  if not found or not app_private.payslip_actor_has_permission(p_actor_id,'payroll.finalize',v_job.portfolio_id,v_job.company_id,v_job.branch_id) then
    raise exception using errcode='42501',message='Delivery state update is not authorized.';
  end if;
  if v_job.status<>'SENDING' then return v_job.status='FAILED'; end if;
  v_code:=case when p_safe_error_code ~ '^PROVIDER_HTTP_[0-9]{3}$' then p_safe_error_code else 'DELIVERY_FAILED' end;
  update public.payslip_email_deliveries set status='FAILED',last_error_code=v_code,updated_at=now() where id=p_delivery_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_job.portfolio_id,v_job.company_id,v_job.branch_id,p_actor_id,'PAYSLIP_EMAIL_DELIVERY_FAILED','payslips',p_delivery_id::text,
      jsonb_build_object('attempt',v_job.attempts,'error_code',v_code));
  return true;
end $$;

create or replace function public.payslip_email_access_redeem(
  p_token_hash text, p_employee_number text, p_date_of_birth date
) returns table(storage_path text, content_sha256 text)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_access public.payslip_email_access_tokens%rowtype; v_doc public.payslip_documents%rowtype; v_employee public.employees%rowtype; v_delivery_status text;
begin
  if auth.role()<>'service_role' or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501', message='Payslip access could not be verified.';
  end if;
  select * into v_access from public.payslip_email_access_tokens a
    where a.token_hash=p_token_hash for update;
  if not found or v_access.revoked_at is not null or v_access.expires_at<=now()
      or v_access.verification_attempts>=5 then
    raise exception using errcode='42501', message='Payslip access could not be verified.';
  end if;
  update public.payslip_email_access_tokens a set verification_attempts=a.verification_attempts+1
    where a.id=v_access.id;
  select q.status into v_delivery_status from public.payslip_email_deliveries q where q.id=v_access.delivery_id;
  if not found or v_delivery_status not in ('SENT','DELIVERED') then return; end if;
  select d.* into v_doc from public.payslip_email_deliveries q
    join public.payslip_documents d on d.id=q.document_id where q.id=v_access.delivery_id;
  if not found then return; end if;
  select e.* into v_employee from public.employees e where e.id=v_doc.employee_id
    and e.company_id=v_doc.company_id and e.portfolio_id=v_doc.portfolio_id;
  if not found or upper(btrim(coalesce(p_employee_number,'')))<>upper(v_employee.employee_number)
      or p_date_of_birth is distinct from v_employee.date_of_birth then return; end if;
  update public.payslip_email_access_tokens a set last_verified_at=now() where a.id=v_access.id;
  return query select v_doc.storage_path,v_doc.content_sha256;
end $$;

create or replace function public.payslip_email_revoke_access(p_delivery_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype;
begin
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id;
  if not found or not app_private.has_permission('payroll.finalize',v_job.portfolio_id,v_job.company_id,v_job.branch_id) then
    raise exception using errcode='42501', message='Payslip access revocation is not authorized.';
  end if;
  update public.payslip_email_access_tokens set revoked_at=coalesce(revoked_at,now()) where delivery_id=p_delivery_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v_job.portfolio_id,v_job.company_id,v_job.branch_id,auth.uid(),'PAYSLIP_EMAIL_ACCESS_REVOKED','payslips',p_delivery_id::text,'{}'::jsonb);
end $$;

create or replace function public.payslip_email_apply_webhook(
  p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamptz default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_delivery public.payslip_email_deliveries%rowtype; v_inserted integer; v_delivery_found boolean;
begin
  if auth.role()<>'service_role' or nullif(p_provider_event_id,'') is null or nullif(p_provider_message_id,'') is null
      or p_event_type not in ('email.sent','email.delivered','email.bounced','email.failed','email.delivery_delayed') then
    raise exception using errcode='42501', message='Delivery event is not authorized.';
  end if;
  select * into v_delivery from public.payslip_email_deliveries q
    where q.provider_message_id=p_provider_message_id for update;
  v_delivery_found:=found;
  insert into public.payslip_email_events(provider_event_id,provider_message_id,delivery_id,event_type,occurred_at)
    values(p_provider_event_id,p_provider_message_id,case when v_delivery_found then v_delivery.id else null end,p_event_type,p_occurred_at)
    on conflict(provider_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return true; end if;
  if not v_delivery_found then return true; end if;
  if p_event_type='email.delivered' then
    update public.payslip_email_deliveries set status='DELIVERED',delivered_at=coalesce(delivered_at,p_occurred_at,now()),updated_at=now()
      where id=v_delivery.id and status<>'BOUNCED';
  elsif p_event_type='email.bounced' then
    update public.payslip_email_deliveries set status='BOUNCED',bounced_at=coalesce(bounced_at,p_occurred_at,now()),updated_at=now()
      where id=v_delivery.id and delivered_at is null;
  elsif p_event_type='email.failed' then
    update public.payslip_email_deliveries set status='FAILED',last_error_code='PROVIDER_REPORTED_FAILURE',updated_at=now()
      where id=v_delivery.id and status not in ('DELIVERED','BOUNCED');
  elsif p_event_type='email.sent' then
    update public.payslip_email_deliveries set status='SENT',sent_at=coalesce(sent_at,p_occurred_at,now()),updated_at=now()
      where id=v_delivery.id and status in ('QUEUED','SENDING');
  end if;
  return true;
end $$;

create or replace function public.payslip_email_event_history(p_document_id uuid)
returns table(event_id uuid,event_type text,occurred_at timestamptz,received_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.payslip_documents d where d.id=p_document_id
      and app_private.has_permission('payroll.finalize',d.portfolio_id,d.company_id,d.branch_id)
  ) then raise exception using errcode='42501',message='Delivery history is not authorized.'; end if;
  return query select e.id,e.event_type,e.occurred_at,e.received_at
    from public.payslip_email_events e join public.payslip_email_deliveries q on q.id=e.delivery_id
    where q.document_id=p_document_id order by e.received_at desc limit 50;
end $$;

revoke all on function public.payslip_distribution_preview(uuid,integer,integer),
  public.payslip_email_prepare_access(uuid,text,uuid),public.payslip_email_access_redeem(text,text,date),
  public.payslip_email_mark_sent(uuid,text,uuid),public.payslip_email_mark_failed(uuid,text,uuid),
  public.payslip_email_revoke_access(uuid),public.payslip_email_apply_webhook(text,text,text,timestamptz),
  public.payslip_email_event_history(uuid) from public,anon,authenticated;
grant execute on function public.payslip_distribution_preview(uuid,integer,integer),
  public.payslip_email_revoke_access(uuid),public.payslip_email_event_history(uuid) to authenticated;
grant execute on function public.payslip_email_prepare_access(uuid,text,uuid),
  public.payslip_email_access_redeem(text,text,date),
  public.payslip_email_mark_sent(uuid,text,uuid),public.payslip_email_mark_failed(uuid,text,uuid),
  public.payslip_email_apply_webhook(text,text,text,timestamptz) to service_role;

comment on table public.payslip_email_access_tokens is 'Hash-only 48-hour payslip access tokens; retrieval also requires employee number and date of birth.';
comment on table public.payslip_email_events is 'Idempotent Resend delivery events; stores no message body, recipient address, or payroll values.';
