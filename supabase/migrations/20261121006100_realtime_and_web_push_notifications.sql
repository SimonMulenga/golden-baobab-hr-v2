-- Instant, private inbox updates plus server-owned Web Push subscriptions.
-- No notification body or employee/payroll value is copied into the push queue.

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;

create table public.user_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint like 'https://%'),
  constraint push_key_sizes check (length(p256dh) between 40 and 100 and length(auth_secret) between 12 and 100)
);
create index user_push_subscriptions_user_idx on public.user_push_subscriptions(user_id);
alter table public.user_push_subscriptions enable row level security;
revoke all on public.user_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.user_push_subscriptions to service_role;

create table public.notification_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.user_notifications(id) on delete cascade,
  state text not null default 'PENDING' check (state in ('PENDING','PROCESSING','DELIVERED','FAILED')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error_code text
);
alter table public.notification_push_outbox enable row level security;
revoke all on public.notification_push_outbox from public, anon, authenticated;
grant select, insert, update on public.notification_push_outbox to service_role;

create table public.notification_push_delivery_log (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.notification_push_outbox(id) on delete cascade,
  subscription_id uuid,
  outcome text not null check (outcome in ('SENT','EXPIRED','FAILED')),
  error_code text,
  created_at timestamptz not null default now()
);
alter table public.notification_push_delivery_log enable row level security;
revoke all on public.notification_push_delivery_log from public, anon, authenticated;
grant select, insert on public.notification_push_delivery_log to service_role;
revoke all on sequence public.notification_push_delivery_log_id_seq from public, anon, authenticated;
grant usage, select on sequence public.notification_push_delivery_log_id_seq to service_role;

create or replace function public.user_push_subscription_save(p_endpoint text, p_p256dh text, p_auth_secret text)
returns uuid language plpgsql security definer set search_path = pg_catalog set row_security = off as $$
declare v_id uuid; v_host text;
begin
  if auth.uid() is null or p_endpoint is null or p_p256dh is null or p_auth_secret is null
    or length(p_endpoint) > 2048 or length(p_p256dh) not between 40 and 100 or length(p_auth_secret) not between 12 and 100
    or p_endpoint !~ '^https://([A-Za-z0-9-]+\.)*(push\.services\.mozilla\.com|fcm\.googleapis\.com|push\.apple\.com)(:[0-9]+)?(/|$)' then
    raise exception using errcode='22023', message='Push subscription is invalid or unsupported.';
  end if;
  insert into public.user_push_subscriptions(user_id,endpoint,p256dh,auth_secret)
  values(auth.uid(),p_endpoint,p_p256dh,p_auth_secret)
  on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,updated_at=now()
  where public.user_push_subscriptions.user_id=auth.uid()
  returning id into v_id;
  if v_id is null then raise exception using errcode='42501',message='Push subscription belongs to another account.'; end if;
  return v_id;
end $$;
revoke all on function public.user_push_subscription_save(text,text,text) from public, anon;
grant execute on function public.user_push_subscription_save(text,text,text) to authenticated;

create or replace function public.user_push_subscription_remove(p_endpoint text)
returns boolean language plpgsql security definer set search_path = pg_catalog set row_security = off as $$
declare v_count integer;
begin
  if auth.uid() is null or p_endpoint is null or length(p_endpoint) > 2048 then
    raise exception using errcode='42501', message='Push subscription removal is unauthorized.';
  end if;
  delete from public.user_push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;
revoke all on function public.user_push_subscription_remove(text) from public, anon;
grant execute on function public.user_push_subscription_remove(text) to authenticated;

create or replace function app_private.enqueue_notification_push()
returns trigger language plpgsql security definer set search_path=pg_catalog set row_security=off as $$
declare v_outbox_id uuid; v_url text; v_secret text; v_extension_schema text;
begin
  insert into public.notification_push_outbox(notification_id) values(new.id)
  on conflict(notification_id) do nothing returning id into v_outbox_id;
  if v_outbox_id is null then return new; end if;

  -- The endpoint and dispatch secret are installed in Supabase Vault by the
  -- production operator. Missing secrets leave the item safely queued.
  select decrypted_secret into v_url from vault.decrypted_secrets where name='gbhr_push_dispatch_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='gbhr_push_dispatch_secret' limit 1;
  if v_url is null or v_secret is null then return new; end if;

  select nspname into v_extension_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_net';
  if v_extension_schema is null then return new; end if;
  execute format('select %I.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 1000)', v_extension_schema)
    using v_url, jsonb_build_object('Content-Type','application/json','x-gbhr-dispatch-secret',v_secret), jsonb_build_object('outbox_id',v_outbox_id);
  return new;
exception when others then
  -- Push dispatch is best-effort and must never roll back a workflow event.
  return new;
end $$;
revoke all on function app_private.enqueue_notification_push() from public, anon, authenticated;
create trigger user_notification_push_dispatch after insert on public.user_notifications
for each row execute function app_private.enqueue_notification_push();

comment on table public.user_push_subscriptions is 'Private push endpoints and encryption keys; accessible only through user-scoped RPCs and trusted server credentials.';
comment on table public.notification_push_outbox is 'Idempotent, generic notification push queue. No employee or payroll payload is stored.';
comment on table public.notification_push_delivery_log is 'Push delivery outcomes with non-sensitive error codes only.';
