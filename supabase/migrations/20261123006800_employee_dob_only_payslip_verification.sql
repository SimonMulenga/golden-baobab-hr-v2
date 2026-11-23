begin;

-- Replace the employee-number + DOB verification RPC with DOB-only verification.
-- The emailed token remains hash-only, delivery-specific, revocable and 48-hour.
drop function if exists public.payslip_email_access_redeem(text, text, date);

create function public.payslip_email_access_redeem(
  p_token_hash text,
  p_date_of_birth date
) returns table(storage_path text, content_sha256 text)
language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare
  v_access public.payslip_email_access_tokens%rowtype;
  v_doc public.payslip_documents%rowtype;
  v_employee public.employees%rowtype;
  v_delivery_status text;
begin
  if auth.role() <> 'service_role' or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='42501', message='Payslip access could not be verified.';
  end if;

  -- Serialize attempts against this exact email token and enforce its expiry,
  -- revocation and bounded attempt counter before any employee lookup.
  select * into v_access
  from public.payslip_email_access_tokens a
  where a.token_hash = p_token_hash
  for update;
  if not found or v_access.revoked_at is not null or v_access.expires_at <= now()
      or v_access.verification_attempts >= 5 then
    raise exception using errcode='42501', message='Payslip access could not be verified.';
  end if;

  update public.payslip_email_access_tokens a
  set verification_attempts = a.verification_attempts + 1
  where a.id = v_access.id;

  select q.status into v_delivery_status
  from public.payslip_email_deliveries q
  where q.id = v_access.delivery_id;
  if not found or v_delivery_status not in ('SENT', 'DELIVERED') then return; end if;

  -- The token maps to one delivery and one document. Tenant keys are checked
  -- again when loading the authoritative employee DOB and private PDF path.
  select d.* into v_doc
  from public.payslip_email_deliveries q
  join public.payslip_documents d on d.id = q.document_id
  where q.id = v_access.delivery_id;
  if not found then return; end if;

  select e.* into v_employee
  from public.employees e
  where e.id = v_doc.employee_id
    and e.company_id = v_doc.company_id
    and e.portfolio_id = v_doc.portfolio_id;
  if not found or v_employee.date_of_birth is null
      or p_date_of_birth is distinct from v_employee.date_of_birth then
    return;
  end if;

  update public.payslip_email_access_tokens a
  set last_verified_at = now()
  where a.id = v_access.id;

  return query select v_doc.storage_path, v_doc.content_sha256;
end $$;

revoke all on function public.payslip_email_access_redeem(text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.payslip_email_access_redeem(text, date)
  to service_role;

comment on table public.payslip_email_access_tokens is
  'Hash-only 48-hour payslip access tokens; retrieval also requires the employee date of birth.';

commit;
