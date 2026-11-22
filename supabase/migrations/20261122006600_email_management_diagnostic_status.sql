-- Owner-only status for the single Resend infrastructure diagnostic.
-- It stores no recipient, message body, payroll, employee, or credential data.
create table public.payslip_resend_diagnostic_status (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references public.platform_administrators(user_id) on delete restrict,
  attempt_state text not null check (attempt_state in ('IN_PROGRESS','ACCEPTED','FAILED','UNKNOWN')),
  provider_message_id text,
  provider_status text check (provider_status is null or provider_status in ('ACCEPTED','DELIVERED','DELAYED','FAILED')),
  error_code text check (error_code is null or error_code in ('PROVIDER_REJECTED','OUTCOME_UNKNOWN','STATUS_PERSISTENCE_FAILED')),
  claimed_at timestamptz not null default now(),
  result_recorded_at timestamptz,
  last_event_at timestamptz
);

alter table public.payslip_resend_diagnostic_status enable row level security;
revoke all on public.payslip_resend_diagnostic_status from public, anon, authenticated;
grant select on public.payslip_resend_diagnostic_status to service_role;

-- Extend the existing atomic, server-only claim so its status row is created
-- in the same transaction as the one-time claim.
create or replace function public.payslip_resend_diagnostic_claim_once(p_owner_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_inserted integer;
begin
  if auth.role() <> 'service_role' or p_owner_id is null
     or not exists (select 1 from public.platform_administrators pa
       where pa.user_id = p_owner_id and pa.revoked_at is null) then
    raise exception using errcode='42501', message='Diagnostic claim is not authorized.';
  end if;
  insert into public.payslip_resend_diagnostic_claims(singleton, owner_id)
    values (true, p_owner_id) on conflict (singleton) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;
  insert into public.payslip_resend_diagnostic_status(singleton, owner_id, attempt_state)
    values (true, p_owner_id, 'IN_PROGRESS');
  return true;
end $$;
revoke all on function public.payslip_resend_diagnostic_claim_once(uuid) from public, anon, authenticated;
grant execute on function public.payslip_resend_diagnostic_claim_once(uuid) to service_role;

create or replace function public.payslip_resend_diagnostic_record_result(
  p_owner_id uuid,
  p_attempt_state text,
  p_provider_message_id text default null,
  p_error_code text default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_event_type text; v_event_at timestamptz; v_provider_status text;
begin
  if auth.role() <> 'service_role'
     or p_attempt_state not in ('ACCEPTED','FAILED','UNKNOWN')
     or (p_provider_message_id is not null and char_length(p_provider_message_id) > 255)
     or (p_error_code is not null and p_error_code not in ('PROVIDER_REJECTED','OUTCOME_UNKNOWN','STATUS_PERSISTENCE_FAILED')) then
    raise exception using errcode='42501', message='Diagnostic result is not authorized.';
  end if;
  update public.payslip_resend_diagnostic_status s
    set attempt_state=p_attempt_state,
        provider_message_id=nullif(p_provider_message_id,''),
        error_code=p_error_code,
        result_recorded_at=now()
    where s.singleton=true and s.owner_id=p_owner_id
      and exists(select 1 from public.payslip_resend_diagnostic_claims c
        where c.singleton=true and c.owner_id=p_owner_id);
  if not found then
    raise exception using errcode='42501', message='Diagnostic result is not authorized.';
  end if;

  -- Reconcile signed events that arrived before the send response was stored.
  if nullif(p_provider_message_id,'') is not null then
    select e.event_type, coalesce(e.occurred_at,e.received_at)
      into v_event_type,v_event_at
      from public.payslip_email_events e
      where e.provider_message_id=p_provider_message_id and e.delivery_id is null
      order by coalesce(e.occurred_at,e.received_at) desc,e.received_at desc limit 1;
    if found then
      v_provider_status := case v_event_type
        when 'email.sent' then 'ACCEPTED'
        when 'email.delivered' then 'DELIVERED'
        when 'email.delivery_delayed' then 'DELAYED'
        when 'email.bounced' then 'FAILED'
        when 'email.failed' then 'FAILED'
        else null end;
      if v_provider_status is not null then
        update public.payslip_resend_diagnostic_status
          set provider_status=v_provider_status,last_event_at=v_event_at
          where singleton=true and owner_id=p_owner_id;
      end if;
    end if;
  end if;
  return true;
end $$;
revoke all on function public.payslip_resend_diagnostic_record_result(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.payslip_resend_diagnostic_record_result(uuid,text,text,text) to service_role;

create or replace function public.payslip_resend_diagnostic_apply_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_next_status text; v_event_at timestamptz;
begin
  if auth.role() <> 'service_role'
     or nullif(p_provider_event_id,'') is null
     or nullif(p_provider_message_id,'') is null
     or p_event_type not in ('email.sent','email.delivered','email.bounced','email.failed','email.delivery_delayed') then
    raise exception using errcode='42501', message='Diagnostic event is not authorized.';
  end if;
  if not exists(select 1 from public.payslip_email_events e
    where e.provider_event_id=p_provider_event_id
      and e.provider_message_id=p_provider_message_id
      and e.event_type=p_event_type and e.delivery_id is null) then
    raise exception using errcode='42501', message='Signed event was not persisted.';
  end if;
  v_next_status := case p_event_type
    when 'email.sent' then 'ACCEPTED'
    when 'email.delivered' then 'DELIVERED'
    when 'email.delivery_delayed' then 'DELAYED'
    when 'email.bounced' then 'FAILED'
    when 'email.failed' then 'FAILED'
    else null end;
  v_event_at := coalesce(p_occurred_at,now());
  update public.payslip_resend_diagnostic_status s
    set provider_status=v_next_status,last_event_at=v_event_at
    where s.singleton=true and s.provider_message_id=p_provider_message_id
      and (s.last_event_at is null or v_event_at >= s.last_event_at)
      and (s.provider_status is null or s.provider_status not in ('DELIVERED','FAILED') or s.provider_status=v_next_status);
  return found;
end $$;
revoke all on function public.payslip_resend_diagnostic_apply_event(text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.payslip_resend_diagnostic_apply_event(text,text,text,timestamptz) to service_role;
