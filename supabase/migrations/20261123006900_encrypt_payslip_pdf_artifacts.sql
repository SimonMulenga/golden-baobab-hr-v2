begin;

alter table public.payslip_documents
  add column if not exists encryption_version integer not null default 0
  check (encryption_version in (0, 1));

-- Existing rows default to legacy/unverified. The updated Edge Function marks
-- a new object encrypted only after it has parsed and verified the PDF bytes.

create or replace function public.payslip_issue_birth_year(
  p_payroll_run_id uuid, p_employee_id uuid, p_actor_id uuid
) returns text
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_year text;
begin
  if auth.role() <> 'service_role' or p_actor_id is null then
    raise exception using errcode='42501', message='Payslip issuance is not authorized.';
  end if;
  select to_char(e.date_of_birth, 'YYYY') into v_year
  from public.payroll_runs r
  join public.payroll_run_items i on i.payroll_run_id=r.id and i.version=r.version
  join public.employees e on e.id=i.employee_id and e.company_id=i.company_id and e.portfolio_id=i.portfolio_id
    and e.workplace_branch_id=r.branch_id
  where r.id=p_payroll_run_id and i.employee_id=p_employee_id and r.status='FINALIZED'
    and app_private.payslip_actor_has_permission(p_actor_id,'payslip.issue',r.portfolio_id,r.company_id,r.branch_id);
  if v_year is null then raise exception using errcode='42501', message='Payslip issuance is not authorized.'; end if;
  return v_year;
end $$;

create or replace function public.payslip_document_birth_year(p_document_id uuid,p_actor_id uuid)
returns text language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_year text; v_doc public.payslip_documents%rowtype;
begin
  if auth.role()<>'service_role' or p_actor_id is null then
    raise exception using errcode='42501',message='Payslip access is not authorized.';
  end if;
  select * into v_doc from public.payslip_documents where id=p_document_id;
  if not found or not app_private.payslip_actor_has_permission(p_actor_id,'payroll.view',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id) then
    raise exception using errcode='42501',message='Payslip access is not authorized.';
  end if;
  select to_char(e.date_of_birth,'YYYY') into v_year from public.employees e
  where e.id=v_doc.employee_id and e.company_id=v_doc.company_id and e.portfolio_id=v_doc.portfolio_id
    and e.workplace_branch_id=v_doc.branch_id;
  if v_year is null then raise exception using errcode='42501',message='Payslip access is not authorized.'; end if;
  return v_year;
end $$;

create or replace function public.payslip_authorized_document(p_document_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype;
begin
  select * into v_doc from public.payslip_documents where id=p_document_id;
  if not found or not app_private.has_permission('payroll.view',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id) then
    raise exception using errcode='42501',message='Payslip access is not authorized.';
  end if;
  return jsonb_build_object('id',v_doc.id,
    -- Legacy paths stay available to the new trusted converter, while the
    -- legacy Edge Function sees no signable path during a staged rollout.
    'storage_path',case when v_doc.encryption_version=1 then v_doc.storage_path else null end,
    'legacy_storage_path',case when v_doc.encryption_version=0 then v_doc.storage_path else null end,
    'content_sha256',v_doc.content_sha256,'encryption_version',v_doc.encryption_version,
    'generated_at',v_doc.generated_at,'payroll_version',v_doc.payroll_version);
end $$;

create function public.payslip_document_mark_encrypted(
  p_document_id uuid,p_expected_content_sha256 text,p_actor_id uuid
) returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype;
begin
  if auth.role()<>'service_role' or p_actor_id is null or p_expected_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='Payslip encryption state is not authorized.';
  end if;
  select * into v_doc from public.payslip_documents where id=p_document_id for update;
  if not found or v_doc.content_sha256<>p_expected_content_sha256
    or not app_private.payslip_actor_has_permission(p_actor_id,'payslip.issue',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id)
    or not exists(select 1 from storage.objects o where o.bucket_id='gb-payslips' and o.name=v_doc.storage_path) then
    raise exception using errcode='42501',message='Payslip encryption state is not authorized.';
  end if;
  if v_doc.encryption_version=1 then return true; end if;
  update public.payslip_documents set encryption_version=1 where id=v_doc.id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id,p_actor_id,'PAYSLIP_DOCUMENT_ENCRYPTED','payslips',v_doc.id::text,
      jsonb_build_object('encryption_version',1,'conversion','new_issue'));
  return true;
end $$;

drop function if exists public.payslip_email_access_redeem(text,date);
drop function if exists public.payslip_email_access_redeem(text,text,date);
create function public.payslip_email_access_redeem(p_token_hash text,p_date_of_birth date)
returns table(storage_path text,content_sha256 text,encryption_version integer,birth_year text)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_access public.payslip_email_access_tokens%rowtype; v_doc public.payslip_documents%rowtype;
  v_employee public.employees%rowtype; v_delivery_status text;
begin
  if auth.role()<>'service_role' or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='Payslip access could not be verified.';
  end if;
  select * into v_access from public.payslip_email_access_tokens a where a.token_hash=p_token_hash for update;
  if not found or v_access.revoked_at is not null or v_access.expires_at<=now() or v_access.verification_attempts>=5 then
    raise exception using errcode='42501',message='Payslip access could not be verified.';
  end if;
  update public.payslip_email_access_tokens a set verification_attempts=a.verification_attempts+1 where a.id=v_access.id;
  select q.status into v_delivery_status from public.payslip_email_deliveries q where q.id=v_access.delivery_id;
  if not found or v_delivery_status not in ('SENT','DELIVERED') then return; end if;
  select d.* into v_doc from public.payslip_email_deliveries q
    join public.payslip_documents d on d.id=q.document_id where q.id=v_access.delivery_id;
  if not found then return; end if;
  select e.* into v_employee from public.employees e where e.id=v_doc.employee_id
    and e.company_id=v_doc.company_id and e.portfolio_id=v_doc.portfolio_id and e.workplace_branch_id=v_doc.branch_id;
  if not found or v_employee.date_of_birth is null or p_date_of_birth is distinct from v_employee.date_of_birth then return; end if;
  update public.payslip_email_access_tokens a set last_verified_at=now() where a.id=v_access.id;
  return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version,to_char(v_employee.date_of_birth,'YYYY');
end $$;

create function public.payslip_document_replace_encrypted_artifact(
  p_document_id uuid,p_old_storage_path text,p_old_content_sha256 text,
  p_new_storage_path text,p_new_content_sha256 text,p_actor_id uuid
) returns table(storage_path text,content_sha256 text,encryption_version integer)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_doc public.payslip_documents%rowtype; v_prefix text;
begin
  if auth.role()<>'service_role' or p_actor_id is null or p_new_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='Payslip conversion is not authorized.';
  end if;
  select * into v_doc from public.payslip_documents where id=p_document_id for update;
  if not found or not app_private.payslip_actor_has_permission(p_actor_id,'payroll.view',v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id) then
    raise exception using errcode='42501',message='Payslip conversion is not authorized.';
  end if;
  if v_doc.encryption_version=1 then
    return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version;
    return;
  end if;
  v_prefix:=replace(v_doc.storage_path,'.pdf','')||'.enc-';
  if v_doc.storage_path<>p_old_storage_path or v_doc.content_sha256<>p_old_content_sha256
    or p_new_storage_path not like v_prefix||'%.pdf' or p_new_storage_path=p_old_storage_path
    or not exists(select 1 from storage.objects o where o.bucket_id='gb-payslips' and o.name=p_new_storage_path) then
    raise exception using errcode='22023',message='Payslip conversion artifact is invalid.';
  end if;
  update public.payslip_documents set storage_path=p_new_storage_path,content_sha256=p_new_content_sha256,encryption_version=1
    where id=p_document_id returning * into v_doc;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id,p_actor_id,'PAYSLIP_DOCUMENT_ENCRYPTED','payslips',v_doc.id::text,
      jsonb_build_object('encryption_version',1));
  return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version;
end $$;

create function public.payslip_email_access_replace_encrypted_artifact(
  p_token_hash text,p_old_storage_path text,p_old_content_sha256 text,
  p_new_storage_path text,p_new_content_sha256 text
) returns table(storage_path text,content_sha256 text,encryption_version integer)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_access public.payslip_email_access_tokens%rowtype; v_doc public.payslip_documents%rowtype;
  v_delivery public.payslip_email_deliveries%rowtype; v_prefix text;
begin
  if auth.role()<>'service_role' or p_token_hash !~ '^[a-f0-9]{64}$' or p_new_content_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501',message='Payslip conversion is not authorized.';
  end if;
  select * into v_access from public.payslip_email_access_tokens a where a.token_hash=p_token_hash for update;
  if not found or v_access.revoked_at is not null or v_access.expires_at<=now() or v_access.last_verified_at is null
    or v_access.last_verified_at<now()-interval '2 minutes' then
    raise exception using errcode='42501',message='Payslip conversion is not authorized.';
  end if;
  select * into v_delivery from public.payslip_email_deliveries q where q.id=v_access.delivery_id;
  if not found or v_delivery.status not in ('SENT','DELIVERED') then
    raise exception using errcode='42501',message='Payslip conversion is not authorized.';
  end if;
  select * into v_doc from public.payslip_documents d where d.id=v_delivery.document_id for update;
  if not found then raise exception using errcode='42501',message='Payslip conversion is not authorized.'; end if;
  if v_doc.encryption_version=1 then
    return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version;
    return;
  end if;
  v_prefix:=replace(v_doc.storage_path,'.pdf','')||'.enc-';
  if v_doc.storage_path<>p_old_storage_path or v_doc.content_sha256<>p_old_content_sha256
    or p_new_storage_path not like v_prefix||'%.pdf' or p_new_storage_path=p_old_storage_path
    or not exists(select 1 from storage.objects o where o.bucket_id='gb-payslips' and o.name=p_new_storage_path) then
    raise exception using errcode='22023',message='Payslip conversion artifact is invalid.';
  end if;
  update public.payslip_documents set storage_path=p_new_storage_path,content_sha256=p_new_content_sha256,encryption_version=1
    where id=v_doc.id returning * into v_doc;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
    values(v_doc.portfolio_id,v_doc.company_id,v_doc.branch_id,v_doc.generated_by,'PAYSLIP_DOCUMENT_ENCRYPTED','payslips',v_doc.id::text,
      jsonb_build_object('encryption_version',1,'conversion','email_access'));
  return query select v_doc.storage_path,v_doc.content_sha256,v_doc.encryption_version;
end $$;

revoke all on function public.payslip_issue_birth_year(uuid,uuid,uuid),
  public.payslip_document_birth_year(uuid,uuid),public.payslip_email_access_redeem(text,date),
  public.payslip_document_mark_encrypted(uuid,text,uuid),
  public.payslip_document_replace_encrypted_artifact(uuid,text,text,text,text,uuid),
  public.payslip_email_access_replace_encrypted_artifact(text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.payslip_issue_birth_year(uuid,uuid,uuid),
  public.payslip_document_birth_year(uuid,uuid),public.payslip_email_access_redeem(text,date),
  public.payslip_document_mark_encrypted(uuid,text,uuid),
  public.payslip_document_replace_encrypted_artifact(uuid,text,text,text,text,uuid),
  public.payslip_email_access_replace_encrypted_artifact(text,text,text,text,text) to service_role;
grant execute on function public.payslip_authorized_document(uuid) to authenticated;

comment on column public.payslip_documents.encryption_version is
  '0 marks a legacy private unencrypted PDF awaiting verified atomic conversion; 1 marks AES-256 encrypted PDF.';
comment on table public.payslip_email_access_tokens is
  'Hash-only 48-hour document-specific tokens; retrieval requires exact employee DOB and returns AES-256 protected PDF.';

commit;
