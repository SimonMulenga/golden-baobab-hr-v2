-- Retire the legacy trial endpoint's stale regulatory status and blockers.
-- The compatibility RPC now delegates to the same trusted, persistent,
-- versioned calculation used by the live payroll workflow.
create or replace function public.payroll_calculate_trial(
  p_payroll_run_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
begin
  return public.payroll_calculate(p_payroll_run_id, p_idempotency_key);
end;
$$;

revoke all on function public.payroll_calculate_trial(uuid, text) from public, anon;
grant execute on function public.payroll_calculate_trial(uuid, text) to authenticated;
comment on function public.payroll_calculate_trial(uuid, text) is
  'Backward-compatible alias for the trusted, persistent payroll_calculate function. The legacy non-authoritative trial calculation has been retired.';
