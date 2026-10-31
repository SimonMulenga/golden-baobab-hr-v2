-- RLS policies call this helper for authenticated membership and branch reads.
-- It returns only the caller's own platform-admin status; it grants no data access.
revoke all on function app_private.is_platform_super_admin() from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_platform_super_admin() to authenticated;

comment on function app_private.is_platform_super_admin() is
  'RLS helper: reports whether the current authenticated user is a platform administrator; callable by authenticated only because protected-table policies invoke it.';
