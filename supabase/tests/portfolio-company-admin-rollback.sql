-- Local-only, synthetic, rollback-only tests for migration 046.
-- Intended for an isolated restore of the development backup, never for Supabase.
\set ON_ERROR_STOP on
begin;

insert into public.client_portfolios(id,name)
values ('00000000-0000-0000-0000-000000000046','Synthetic migration 046 bootstrap portfolio');

create temporary table qa_bootstrap_subject on commit drop as
select u.id as user_id
from auth.users u
join public.profiles p on p.id = u.id
where u.deleted_at is null and u.email_confirmed_at is not null
order by u.created_at, u.id
limit 1;

do $$
begin
  if not exists (select 1 from pg_temp.qa_bootstrap_subject) then
    raise exception 'No confirmed Auth user with a profile is available in the restored test archive.';
  end if;
end;
$$;

select public.bootstrap_first_company_administrator(
  '00000000-0000-0000-0000-000000000046'::uuid,
  (select user_id from pg_temp.qa_bootstrap_subject)
);
select set_config('request.jwt.claim.sub',(select user_id::text from pg_temp.qa_bootstrap_subject),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from pg_temp.qa_bootstrap_subject),'role','authenticated')::text,true);

do $$
declare
  v_portfolio uuid := '00000000-0000-0000-0000-000000000046';
  v_other_portfolio uuid := '00000000-0000-0000-0000-000000000047';
  v_user uuid;
  v_company uuid;
  v_branch uuid;
  v_other_company uuid;
begin
  select user_id into v_user from pg_temp.qa_bootstrap_subject;
  if not exists (select 1 from public.portfolio_memberships where portfolio_id=v_portfolio and user_id=v_user and role='COMPANY_ADMIN' and revoked_at is null) then
    raise exception 'Bootstrap did not assign the portfolio Company Administrator role.';
  end if;
  if not exists (select 1 from public.audit_logs where portfolio_id=v_portfolio and actor_id is null and actor_kind='SYSTEM' and action='COMPANY_ADMIN_BOOTSTRAPPED' and record_id=v_user::text) then
    raise exception 'Bootstrap did not record the system audit event.';
  end if;
  if has_function_privilege('authenticated','public.bootstrap_first_company_administrator(uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.bootstrap_first_company_administrator(uuid,uuid)','EXECUTE')
    or has_function_privilege('service_role','public.bootstrap_first_company_administrator(uuid,uuid)','EXECUTE') then
    raise exception 'Bootstrap RPC is exposed to an API role.';
  end if;
  if not app_private.has_permission('company.create',v_portfolio,null,null)
    or not app_private.has_permission('users.manage',v_portfolio,null,null)
    or app_private.has_permission('employee.view',v_portfolio,null,null)
    or app_private.has_permission('employee.create',v_portfolio,null,null)
    or app_private.has_permission('employee.private.view',v_portfolio,null,null)
    or app_private.has_permission('compensation.view',v_portfolio,null,null)
    or app_private.has_permission('compensation.edit',v_portfolio,null,null)
    or app_private.has_permission('payroll.view',v_portfolio,null,null)
    or app_private.has_permission('payroll.prepare',v_portfolio,null,null)
    or app_private.has_permission('payroll.submit',v_portfolio,null,null)
    or app_private.has_permission('payroll.approve',v_portfolio,null,null)
    or app_private.has_permission('payroll.finalize',v_portfolio,null,null)
    or app_private.has_permission('reports.view',v_portfolio,null,null) then
    raise exception 'Company Administrator portfolio permission boundary failed.';
  end if;

  insert into public.companies(portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person)
  values(v_portfolio,'Synthetic 046 Company A','TEST-046-A','TEST-TPIN-A','Services','a@example.invalid','+260000000001','Lusaka','Lusaka','Synthetic','Synthetic QA') returning id into v_company;
  insert into public.branches(portfolio_id,company_id,name,code,province,town,physical_address)
  values(v_portfolio,v_company,'Synthetic Branch A','TEST-046-A','Lusaka','Lusaka','Synthetic') returning id into v_branch;
  if not app_private.has_permission('company.view',v_portfolio,v_company,null)
    or not app_private.has_permission('company.edit',v_portfolio,v_company,null)
    or not app_private.has_permission('branch.view',v_portfolio,v_company,v_branch)
    or not app_private.has_permission('branch.create',v_portfolio,v_company,null)
    or not app_private.has_permission('users.manage',v_portfolio,v_company,null)
    or not app_private.has_permission('users.manage',v_portfolio,v_company,v_branch) then
    raise exception 'Company or branch setup scope failed inside the administrator portfolio.';
  end if;
  if app_private.has_permission('employee.view',v_portfolio,v_company,v_branch)
    or app_private.has_permission('compensation.view',v_portfolio,v_company,v_branch)
    or app_private.has_permission('payroll.prepare',v_portfolio,v_company,v_branch)
    or app_private.has_permission('payroll.finalize',v_portfolio,v_company,v_branch)
    or app_private.has_permission('reports.view',v_portfolio,v_company,v_branch) then
    raise exception 'Company-scoped HR/payroll permissions leaked to the portfolio Company Administrator.';
  end if;

  insert into public.client_portfolios(id,name) values(v_other_portfolio,'Synthetic unrelated portfolio');
  insert into public.companies(portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person)
  values(v_other_portfolio,'Synthetic Other Company','TEST-046-OTHER','TEST-TPIN-OTHER','Services','other@example.invalid','+260000000002','Lusaka','Lusaka','Synthetic','Synthetic QA') returning id into v_other_company;
  if app_private.has_permission('company.view',v_other_portfolio,v_other_company,null)
    or app_private.has_permission('company.edit',v_other_portfolio,v_other_company,null)
    or app_private.has_permission('users.manage',v_other_portfolio,null,null) then
    raise exception 'Cross-portfolio access was granted.';
  end if;

  begin
    insert into public.portfolio_memberships(portfolio_id,user_id,role) values(v_portfolio,v_user,'PORTFOLIO_ADMIN');
    raise exception 'Company Administrator unexpectedly assigned a portfolio administrator.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.portfolio_memberships(portfolio_id,user_id,role) values(v_portfolio,v_user,'PAYROLL_PROCESSOR');
    raise exception 'Company Administrator unexpectedly assigned a payroll processor.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.assign_portfolio_membership(v_portfolio,v_user,'BRANCH_MANAGER',array[v_branch]);
    raise exception 'Company Administrator unexpectedly assigned access to self.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.authorize_member_invitation(v_portfolio,'PAYROLL_PROCESSOR',null);
    raise exception 'Company Administrator unexpectedly invited a payroll processor.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.bootstrap_first_company_administrator(v_portfolio,v_user);
    raise exception 'The first-administrator bootstrap unexpectedly ran twice.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
select 'PASS portfolio Company Administrator authorization and bootstrap rollback assertions passed';
