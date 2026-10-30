-- Keep the legacy calendar records for historical reference, but make the
-- retired work-calendar workflow unavailable to application roles. The payroll
-- workflow now derives its standard schedule directly and does not call these RPCs.
revoke all on function public.branch_work_calendar_request(uuid, uuid, date, date, date[], text)
  from public, anon, authenticated;
revoke all on function public.branch_work_calendar_review(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.branch_work_calendar_capabilities(uuid, uuid)
  from public, anon, authenticated;

-- PostgreSQL invokes a trigger function through its trigger binding. It does
-- not need client EXECUTE privileges, and it runs as a SECURITY DEFINER helper.
revoke all on function app_private.normalize_new_earning_history()
  from public, anon, authenticated;

comment on function app_private.normalize_new_earning_history() is
  'Internal trigger-only helper; execution is revoked from application roles.';
