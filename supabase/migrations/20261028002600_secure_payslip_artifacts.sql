-- Secure payslip documents are issued only from an immutable finalized run item.
-- Files remain in a private bucket; callers receive short-lived signed URLs
-- only after a caller-scoped RPC confirms payroll permission.

create table public.payslip_documents (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  employee_id uuid not null,
  payroll_version integer not null check (payroll_version > 0),
  storage_path text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id, payroll_version),
  unique (portfolio_id, company_id, branch_id, id),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict
);
create index payslip_documents_scope_idx
  on public.payslip_documents(portfolio_id, company_id, branch_id, generated_at desc, id);
alter table public.payslip_documents enable row level security;
revoke all on public.payslip_documents from public, anon, authenticated;
create policy payslip_documents_read_authorized on public.payslip_documents
  for select to authenticated using (
    app_private.has_permission('payroll.view', portfolio_id, company_id, branch_id)
  );
-- Authenticated callers only need the immutable document ID for the issuance
-- existence check. In particular, do not grant SELECT on the stored snapshot.
grant select (id, payroll_run_id, employee_id) on public.payslip_documents to authenticated;

create table public.payslip_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.payslip_documents(id) on delete restrict,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  recipient_email text not null check (char_length(recipient_email) <= 320),
  status text not null default 'QUEUED' check (status in ('QUEUED','SENDING','SENT','FAILED')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  provider_message_id text,
  last_error_code text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (document_id),
  foreign key (portfolio_id, company_id, branch_id, document_id)
    references public.payslip_documents(portfolio_id, company_id, branch_id, id) on delete restrict
);
create index payslip_email_delivery_scope_idx
  on public.payslip_email_deliveries(portfolio_id, company_id, branch_id, created_at desc, id);
alter table public.payslip_email_deliveries enable row level security;
revoke all on public.payslip_email_deliveries from public, anon, authenticated;
create policy payslip_email_delivery_read_authorized on public.payslip_email_deliveries
  for select to authenticated using (
    app_private.has_permission('payroll.finalize', portfolio_id, company_id, branch_id)
  );
grant select, update on public.payslip_email_deliveries to service_role;
grant select on public.payslip_documents to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('gb-payslips', 'gb-payslips', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];
-- Deliberately no authenticated storage.objects policies. The Edge Function is
-- the only path to upload/download and checks the caller before using service role.

create or replace function app_private.payslip_snapshot_for_user(p_actor_id uuid, p_payroll_run_id uuid, p_employee_id uuid, p_issuance boolean)
returns jsonb language plpgsql security definer
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
    where pm.user_id=p_actor_id and pm.portfolio_id=(v_payload->>'portfolio_id')::uuid and pm.revoked_at is null
      and (
        (p_issuance and pm.role in ('PORTFOLIO_ADMIN','OVERALL_HR_MANAGER'))
        or (not p_issuance and pm.role in ('PORTFOLIO_ADMIN','OVERALL_HR_MANAGER'))
        or (not p_issuance and pm.role in ('BRANCH_MANAGER','PAYROLL_PROCESSOR') and exists (
          select 1 from public.branch_assignments ba where ba.user_id=p_actor_id
            and ba.portfolio_id=pm.portfolio_id and ba.company_id=(v_payload->>'company_id')::uuid
            and ba.branch_id=(v_payload->>'branch_id')::uuid and ba.role=pm.role and ba.revoked_at is null
        ))
      )
  ) then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  return v_payload;
end $$;

revoke all on function app_private.payslip_snapshot_for_user(uuid,uuid,uuid,boolean) from public, anon, authenticated;

-- The trusted function worker supplies an authenticated actor ID. This helper
-- applies the same exact-resource permission rule as has_permission(), without
-- pretending that the service-role JWT is the human actor's JWT.
create or replace function app_private.payslip_actor_has_permission(
  p_actor_id uuid, p_permission text, p_portfolio_id uuid, p_company_id uuid, p_branch_id uuid
) returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select p_actor_id is not null
    and p_permission in ('payslip.issue', 'payroll.finalize')
    and exists (
      select 1 from public.portfolio_memberships pm
      join public.companies c on c.id = p_company_id and c.portfolio_id = p_portfolio_id
      join public.branches b on b.id = p_branch_id and b.company_id = c.id and b.portfolio_id = c.portfolio_id
      where pm.user_id = p_actor_id and pm.portfolio_id = p_portfolio_id and pm.revoked_at is null
        and pm.role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER')
    )
$$;
revoke all on function app_private.payslip_actor_has_permission(uuid,text,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.payslip_issue_snapshot(p_payroll_run_id uuid, p_employee_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_scope record;
begin
  if auth.role() <> 'service_role' or p_actor_id is null then
    raise exception using errcode = '42501', message = 'Payslip issuance is restricted to the trusted server.';
  end if;
  select r.portfolio_id, r.company_id, r.branch_id into v_scope
  from public.payroll_runs r
  join public.payroll_run_items i on i.payroll_run_id = r.id and i.version = r.version
  where r.id = p_payroll_run_id and i.employee_id = p_employee_id and r.status = 'FINALIZED';
  if not found then
    raise exception using errcode = '42501', message = 'Payslip issuance is not authorized.';
  end if;
  if not app_private.payslip_actor_has_permission(
    p_actor_id, 'payslip.issue', v_scope.portfolio_id, v_scope.company_id, v_scope.branch_id
  ) then
    raise exception using errcode = '42501', message = 'Payslip issuance is not authorized.';
  end if;
  return app_private.payslip_snapshot_for_user(p_actor_id, p_payroll_run_id, p_employee_id, true);
end
$$;

create or replace function public.payslip_register_document(
  p_payroll_run_id uuid, p_employee_id uuid, p_storage_path text, p_content_sha256 text, p_actor_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_snapshot jsonb; v_existing public.payslip_documents%rowtype; v_id uuid;
begin
  if auth.role() <> 'service_role' or p_actor_id is null then
    raise exception using errcode = '42501', message = 'Payslip registration is restricted to the trusted server.';
  end if;
  v_snapshot := app_private.payslip_snapshot_for_user(p_actor_id, p_payroll_run_id, p_employee_id, true);
  if p_content_sha256 !~ '^[a-f0-9]{64}$' or p_storage_path <> format('%s/%s/%s/%s/%s.pdf',
      v_snapshot->>'portfolio_id', v_snapshot->>'company_id', p_payroll_run_id::text,
      v_snapshot->>'payroll_version', p_employee_id::text) then
    raise exception using errcode = '22023', message = 'Payslip artifact metadata is invalid.';
  end if;
  select * into v_existing from public.payslip_documents
  where payroll_run_id = p_payroll_run_id and employee_id = p_employee_id
    and payroll_version = (v_snapshot->>'payroll_version')::integer;
  if found then
    if v_existing.storage_path <> p_storage_path or v_existing.content_sha256 <> p_content_sha256 then
      raise exception using errcode = '23505', message = 'An immutable payslip already exists with different content.';
    end if;
    return v_existing.id;
  end if;
  insert into public.payslip_documents(portfolio_id, company_id, branch_id, payroll_run_id,
      employee_id, payroll_version, storage_path, content_sha256, snapshot, generated_by)
  values ((v_snapshot->>'portfolio_id')::uuid, (v_snapshot->>'company_id')::uuid,
      (v_snapshot->>'branch_id')::uuid, p_payroll_run_id, p_employee_id,
      (v_snapshot->>'payroll_version')::integer, p_storage_path, p_content_sha256,
      v_snapshot, p_actor_id) returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id, details)
  values ((v_snapshot->>'portfolio_id')::uuid, (v_snapshot->>'company_id')::uuid,
      (v_snapshot->>'branch_id')::uuid, p_actor_id, 'PAYSLIP_DOCUMENT_ISSUED', 'payslips', v_id::text,
      jsonb_build_object('run_id', p_payroll_run_id, 'employee_id', p_employee_id,
        'version', (v_snapshot->>'payroll_version')::integer, 'sha256', p_content_sha256));
  return v_id;
end $$;

create or replace function public.payslip_authorized_document(p_document_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype;
begin
  select * into v_doc from public.payslip_documents where id = p_document_id;
  if not found then raise exception using errcode = 'P0002', message = 'Payslip document was not found.'; end if;
  if not app_private.has_permission('payroll.view', v_doc.portfolio_id, v_doc.company_id, v_doc.branch_id) then
    raise exception using errcode = '42501', message = 'Payslip access is not authorized.';
  end if;
  return jsonb_build_object('id', v_doc.id, 'storage_path', v_doc.storage_path,
    'generated_at', v_doc.generated_at, 'payroll_version', v_doc.payroll_version);
end $$;

create or replace function public.payslip_email_enqueue(p_document_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype; v_email text; v_id uuid;
begin
  select * into v_doc from public.payslip_documents where id = p_document_id;
  if not found then raise exception using errcode = 'P0002', message = 'Payslip document was not found.'; end if;
  if not app_private.has_permission('payroll.finalize', v_doc.portfolio_id, v_doc.company_id, v_doc.branch_id) then
    raise exception using errcode = '42501', message = 'Payslip delivery is not authorized.';
  end if;
  select nullif(btrim(pd.email), '') into v_email from public.employee_private_details pd
    where pd.employee_id = v_doc.employee_id and pd.company_id = v_doc.company_id and pd.portfolio_id = v_doc.portfolio_id;
  if v_email is null then raise exception using errcode = '22023', message = 'Employee has no available delivery email.'; end if;
  select id into v_id from public.payslip_email_deliveries where document_id = p_document_id;
  if found then
    if exists(select 1 from public.payslip_email_deliveries where id = v_id and status = 'SENT') then return v_id; end if;
    if exists(select 1 from public.payslip_email_deliveries where id = v_id and status in ('QUEUED','SENDING')) then return v_id; end if;
    raise exception using errcode = '23505', message = 'Delivery already exists; use the authorized retry action if it failed.';
  end if;
  insert into public.payslip_email_deliveries(document_id, portfolio_id, company_id, branch_id,
      recipient_email, created_by)
    values(v_doc.id, v_doc.portfolio_id, v_doc.company_id, v_doc.branch_id, v_email, auth.uid())
    returning id into v_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values(v_doc.portfolio_id, v_doc.company_id, v_doc.branch_id, auth.uid(), 'PAYSLIP_EMAIL_QUEUED', 'payslips', v_id::text);
  return v_id;
end $$;

create or replace function public.payslip_email_retry(p_delivery_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype;
begin
  select * into v_job from public.payslip_email_deliveries where id = p_delivery_id for update;
  if not found or not app_private.has_permission('payroll.finalize', v_job.portfolio_id, v_job.company_id, v_job.branch_id) then
    raise exception using errcode = '42501', message = 'Delivery retry is not authorized.';
  end if;
  if v_job.attempts >= 3 or not (
      v_job.status = 'FAILED'
      or (v_job.status = 'SENDING' and v_job.updated_at < now() - interval '10 minutes')
    ) then
    raise exception using errcode = '22023', message = 'Only failed or stale deliveries with fewer than three attempts may be retried.';
  end if;
  update public.payslip_email_deliveries set status='QUEUED', last_error_code=null, updated_at=now() where id=p_delivery_id;
  insert into public.audit_logs(portfolio_id, company_id, branch_id, actor_id, action, module, record_id)
  values(v_job.portfolio_id, v_job.company_id, v_job.branch_id, auth.uid(), 'PAYSLIP_EMAIL_RETRY_QUEUED', 'payslips', p_delivery_id::text);
  return p_delivery_id;
end $$;

create or replace function public.payslip_email_claim(p_delivery_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_job public.payslip_email_deliveries%rowtype; v_doc public.payslip_documents%rowtype;
begin
  if auth.role() <> 'service_role' or p_actor_id is null then
    raise exception using errcode = '42501', message = 'Delivery claiming is restricted to the trusted server.';
  end if;
  select * into v_job from public.payslip_email_deliveries where id=p_delivery_id for update;
  if not found or not exists (
    select 1 from public.payslip_documents d
    where d.id = v_job.document_id
      and app_private.payslip_actor_has_permission(
        p_actor_id, 'payroll.finalize', d.portfolio_id, d.company_id, d.branch_id
      )
  ) then
    raise exception using errcode = '42501', message = 'Delivery access is not authorized.';
  end if;
  if v_job.status <> 'QUEUED' or v_job.attempts >= 3 then return null; end if;
  update public.payslip_email_deliveries set status='SENDING', attempts=attempts+1, updated_at=now()
    where id=p_delivery_id returning * into v_job;
  select * into v_doc from public.payslip_documents where id=v_job.document_id;
  return jsonb_build_object('id', v_job.id, 'recipient_email', v_job.recipient_email,
    'storage_path', v_doc.storage_path, 'attempt', v_job.attempts);
end $$;

-- Return operational delivery metadata without exposing the recipient address.
-- The destination remains available only to trusted delivery functions.
create or replace function public.payslip_email_history(p_document_id uuid)
returns table (
  id uuid,
  document_id uuid,
  status text,
  attempts integer,
  last_error_code text,
  created_at timestamptz,
  updated_at timestamptz,
  sent_at timestamptz
)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.payslip_documents d
    where d.id = p_document_id
      and app_private.has_permission('payroll.finalize', d.portfolio_id, d.company_id, d.branch_id)
  ) then
    raise exception using errcode = '42501', message = 'Delivery history is not authorized.';
  end if;
  return query
    select q.id, q.document_id, q.status, q.attempts, q.last_error_code, q.created_at, q.updated_at, q.sent_at
    from public.payslip_email_deliveries q
    where q.document_id = p_document_id
    order by q.created_at desc
    limit 10;
end $$;

revoke all on function public.payslip_issue_snapshot(uuid,uuid,uuid),
  public.payslip_register_document(uuid,uuid,text,text,uuid), public.payslip_authorized_document(uuid),
  public.payslip_email_enqueue(uuid), public.payslip_email_retry(uuid),
  public.payslip_email_history(uuid)
  from public, anon, authenticated;
revoke all on function public.payslip_email_claim(uuid,uuid) from public, anon, authenticated;
grant execute on function public.payslip_issue_snapshot(uuid,uuid,uuid) to service_role;
grant execute on function public.payslip_authorized_document(uuid),
  public.payslip_email_enqueue(uuid), public.payslip_email_retry(uuid),
  public.payslip_email_history(uuid)
  to authenticated;
grant execute on function public.payslip_register_document(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.payslip_email_claim(uuid,uuid) to service_role;

comment on table public.payslip_documents is 'Immutable metadata and source snapshot for PDF documents generated only from finalized payroll items.';
comment on table public.payslip_email_deliveries is 'Audited, bounded-retry payslip delivery queue; recipient addresses are only exposed to trusted server-side delivery operations.';
