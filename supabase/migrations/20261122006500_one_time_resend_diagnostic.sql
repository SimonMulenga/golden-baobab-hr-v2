-- One durable, atomic claim for the temporary Resend infrastructure diagnostic.
-- The claim is intentionally never auto-released, even when provider delivery fails.
create table public.payslip_resend_diagnostic_claims (
  singleton boolean primary key default true check (singleton),
  owner_id uuid not null references public.platform_administrators(user_id) on delete restrict,
  claimed_at timestamptz not null default now()
);
alter table public.payslip_resend_diagnostic_claims enable row level security;
revoke all on public.payslip_resend_diagnostic_claims from public, anon, authenticated;
grant select, insert on public.payslip_resend_diagnostic_claims to service_role;

create or replace function public.payslip_resend_diagnostic_claim_once(p_owner_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
begin
  if auth.role() <> 'service_role' or p_owner_id is null
     or not exists (select 1 from public.platform_administrators pa
       where pa.user_id = p_owner_id and pa.revoked_at is null) then
    raise exception using errcode='42501', message='Diagnostic claim is not authorized.';
  end if;
  insert into public.payslip_resend_diagnostic_claims(singleton, owner_id)
    values (true, p_owner_id) on conflict (singleton) do nothing;
  return found;
end $$;
revoke all on function public.payslip_resend_diagnostic_claim_once(uuid) from public, anon, authenticated;
grant execute on function public.payslip_resend_diagnostic_claim_once(uuid) to service_role;
