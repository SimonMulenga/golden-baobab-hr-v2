-- HR configuration, employee catalog links, private documents, and atomic
-- company/branch writes. Additive only: existing text values remain supported.

create or replace function app_private.can_manage_company_hr_configuration(p_company_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog set row_security = off
as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company_id
      and (
        app_private.has_permission('company.edit', c.portfolio_id, c.id, null)
        or exists (
          select 1 from public.company_memberships cm
          where cm.portfolio_id = c.portfolio_id and cm.company_id = c.id
            and cm.user_id = auth.uid() and cm.role = 'COMPANY_ADMIN' and cm.revoked_at is null
        )
      )
  );
$$;
revoke all on function app_private.can_manage_company_hr_configuration(uuid) from public, anon, authenticated;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  code text not null check (char_length(btrim(code)) between 1 and 24),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, company_id, id),
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict
);
create unique index departments_company_name_ci_unique on public.departments(company_id, lower(btrim(name)));
create unique index departments_company_code_ci_unique on public.departments(company_id, lower(btrim(code)));
create index departments_company_status_idx on public.departments(portfolio_id, company_id, status, name);
alter table public.departments enable row level security;
revoke all on public.departments from public, anon, authenticated;
grant select on public.departments to authenticated;
create policy departments_read_authorized on public.departments for select to authenticated
  using (app_private.has_permission('company.view', portfolio_id, company_id, null));

create table public.job_roles (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  department_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  code text not null check (char_length(btrim(code)) between 1 and 24),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, company_id, id),
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, department_id)
    references public.departments(portfolio_id, company_id, id) on delete restrict
);
create unique index job_roles_company_title_ci_unique on public.job_roles(company_id, lower(btrim(title)));
create unique index job_roles_company_code_ci_unique on public.job_roles(company_id, lower(btrim(code)));
create index job_roles_company_department_status_idx on public.job_roles(portfolio_id, company_id, department_id, status, title);
alter table public.job_roles enable row level security;
revoke all on public.job_roles from public, anon, authenticated;
grant select on public.job_roles to authenticated;
create policy job_roles_read_authorized on public.job_roles for select to authenticated
  using (app_private.has_permission('company.view', portfolio_id, company_id, null));

alter table public.employees
  add column department_id uuid,
  add column job_role_id uuid;
alter table public.employees
  add constraint employees_department_tenant_fk foreign key (portfolio_id, company_id, department_id)
    references public.departments(portfolio_id, company_id, id) on delete restrict,
  add constraint employees_job_role_tenant_fk foreign key (portfolio_id, company_id, job_role_id)
    references public.job_roles(portfolio_id, company_id, id) on delete restrict;
create index employees_catalog_scope_idx on public.employees(portfolio_id, company_id, department_id, job_role_id);

create or replace function app_private.sync_employee_catalog_labels()
returns trigger language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_department public.departments%rowtype; v_role public.job_roles%rowtype;
begin
  if tg_op='UPDATE' then
    if new.department is distinct from old.department then new.department_id:=null; end if;
    if new.job_title is distinct from old.job_title or new.department_id is distinct from old.department_id then new.job_role_id:=null; end if;
  end if;
  if new.department_id is not null then
    select * into v_department from public.departments d
      where d.id = new.department_id and d.portfolio_id = new.portfolio_id and d.company_id = new.company_id;
    if not found then raise exception using errcode='23503', message='Department is outside this employee company.'; end if;
    if (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) and v_department.status <> 'ACTIVE' then
      raise exception using errcode='22023', message='New employees must use an active department.';
    end if;
    new.department := v_department.name;
  elsif nullif(btrim(new.department), '') is not null then
    select * into v_department from public.departments d
      where d.portfolio_id = new.portfolio_id and d.company_id = new.company_id
        and d.status = 'ACTIVE' and lower(btrim(d.name)) = lower(btrim(new.department));
    if found then new.department_id := v_department.id; new.department := v_department.name; end if;
  end if;

  if new.job_role_id is not null then
    select * into v_role from public.job_roles r
      where r.id = new.job_role_id and r.portfolio_id = new.portfolio_id and r.company_id = new.company_id;
    if not found then raise exception using errcode='23503', message='Job role is outside this employee company.'; end if;
    if (tg_op = 'INSERT' or new.job_role_id is distinct from old.job_role_id) and v_role.status <> 'ACTIVE' then
      raise exception using errcode='22023', message='New employees must use an active job role.';
    end if;
    if v_role.department_id is not null and new.department_id is distinct from v_role.department_id then
      raise exception using errcode='22023', message='Job role does not belong to the selected department.';
    end if;
    if v_role.department_id is not null then
      select * into v_department from public.departments d where d.id = v_role.department_id;
      new.department_id := v_department.id; new.department := v_department.name;
    end if;
    new.job_title := v_role.title;
  elsif nullif(btrim(new.job_title), '') is not null then
    select * into v_role from public.job_roles r
      where r.portfolio_id = new.portfolio_id and r.company_id = new.company_id
        and r.status = 'ACTIVE' and lower(btrim(r.title)) = lower(btrim(new.job_title));
    if found then
      if v_role.department_id is not null and new.department_id is distinct from v_role.department_id then
        raise exception using errcode='22023', message='Job role does not belong to the selected department.';
      end if;
      new.job_role_id := v_role.id; new.job_title := v_role.title;
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.sync_employee_catalog_labels() from public, anon, authenticated;
create trigger employees_sync_catalog_labels before insert or update of department, job_title, department_id, job_role_id
  on public.employees for each row execute function app_private.sync_employee_catalog_labels();

create or replace function public.department_save(
  p_company_id uuid, p_department_id uuid, p_name text, p_code text, p_description text
) returns uuid language plpgsql security definer
set search_path = pg_catalog set row_security = off
as $$
declare v_company public.companies%rowtype; v_id uuid;
begin
  if auth.uid() is null or nullif(btrim(p_name),'') is null or nullif(btrim(p_code),'') is null
    or char_length(p_name) > 120 or char_length(p_code) > 24 or char_length(coalesce(p_description,'')) > 1000
    or not app_private.can_manage_company_hr_configuration(p_company_id) then
    raise exception using errcode='42501', message='Department change is invalid or unauthorized.';
  end if;
  select * into v_company from public.companies where id=p_company_id;
  if p_department_id is null then
    insert into public.departments(portfolio_id,company_id,name,code,description,created_by)
      values(v_company.portfolio_id,v_company.id,btrim(p_name),upper(btrim(p_code)),btrim(coalesce(p_description,'')),auth.uid()) returning id into v_id;
  else
    update public.departments set name=btrim(p_name),code=upper(btrim(p_code)),description=btrim(coalesce(p_description,'')),updated_at=now()
      where id=p_department_id and portfolio_id=v_company.portfolio_id and company_id=v_company.id returning id into v_id;
    if v_id is null then raise exception using errcode='42501', message='Department is outside this company.'; end if;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v_company.portfolio_id,v_company.id,auth.uid(),case when p_department_id is null then 'DEPARTMENT_CREATED' else 'DEPARTMENT_UPDATED' end,'hr_configuration',v_id::text,jsonb_build_object('name',btrim(p_name),'code',upper(btrim(p_code))));
  return v_id;
end $$;

create or replace function public.department_deactivate(p_department_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.departments%rowtype;
begin
  select * into v from public.departments where id=p_department_id for update;
  if not found or auth.uid() is null or not app_private.can_manage_company_hr_configuration(v.company_id) then
    raise exception using errcode='42501',message='Department deactivation is unauthorized.';
  end if;
  update public.departments set status='INACTIVE',updated_at=now() where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,auth.uid(),'DEPARTMENT_DEACTIVATED','hr_configuration',v.id::text,jsonb_build_object('name',v.name));
  return v.id;
end $$;

create or replace function public.job_role_save(
  p_company_id uuid, p_job_role_id uuid, p_department_id uuid, p_title text, p_code text, p_description text
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_company public.companies%rowtype; v_id uuid;
begin
  if auth.uid() is null or nullif(btrim(p_title),'') is null or nullif(btrim(p_code),'') is null
    or char_length(p_title)>120 or char_length(p_code)>24 or char_length(coalesce(p_description,''))>1000
    or not app_private.can_manage_company_hr_configuration(p_company_id) then
    raise exception using errcode='42501',message='Job role change is invalid or unauthorized.';
  end if;
  select * into v_company from public.companies where id=p_company_id;
  if p_department_id is not null and not exists(select 1 from public.departments d where d.id=p_department_id
    and d.portfolio_id=v_company.portfolio_id and d.company_id=v_company.id and d.status='ACTIVE') then
    raise exception using errcode='22023',message='Choose an active department in this company.';
  end if;
  if p_job_role_id is null then
    insert into public.job_roles(portfolio_id,company_id,department_id,title,code,description,created_by)
      values(v_company.portfolio_id,v_company.id,p_department_id,btrim(p_title),upper(btrim(p_code)),btrim(coalesce(p_description,'')),auth.uid()) returning id into v_id;
  else
    update public.job_roles set department_id=p_department_id,title=btrim(p_title),code=upper(btrim(p_code)),description=btrim(coalesce(p_description,'')),updated_at=now()
      where id=p_job_role_id and portfolio_id=v_company.portfolio_id and company_id=v_company.id returning id into v_id;
    if v_id is null then raise exception using errcode='42501',message='Job role is outside this company.'; end if;
  end if;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v_company.portfolio_id,v_company.id,auth.uid(),case when p_job_role_id is null then 'JOB_ROLE_CREATED' else 'JOB_ROLE_UPDATED' end,'hr_configuration',v_id::text,jsonb_build_object('title',btrim(p_title),'code',upper(btrim(p_code)),'department_id',p_department_id));
  return v_id;
end $$;

create or replace function public.job_role_deactivate(p_job_role_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.job_roles%rowtype;
begin
  select * into v from public.job_roles where id=p_job_role_id for update;
  if not found or auth.uid() is null or not app_private.can_manage_company_hr_configuration(v.company_id) then
    raise exception using errcode='42501',message='Job role deactivation is unauthorized.';
  end if;
  update public.job_roles set status='INACTIVE',updated_at=now() where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.company_id,auth.uid(),'JOB_ROLE_DEACTIVATED','hr_configuration',v.id::text,jsonb_build_object('title',v.title));
  return v.id;
end $$;

create or replace function public.company_workspace_save(
  p_portfolio_id uuid, p_company_id uuid, p_company jsonb, p_branches jsonb, p_deactivate_branch_ids jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v_company_id uuid; v_company public.companies%rowtype; v_branch jsonb; v_branch_id uuid; v_status text; v_deactivate uuid;
begin
  if auth.uid() is null or jsonb_typeof(p_company) is distinct from 'object'
    or jsonb_typeof(p_branches) is distinct from 'array' or jsonb_array_length(p_branches)>500
    or jsonb_typeof(p_deactivate_branch_ids) is distinct from 'array' or jsonb_array_length(p_deactivate_branch_ids)>500 then
    raise exception using errcode='22023',message='Company workspace payload is invalid.';
  end if;
  if p_company_id is null then
    if not app_private.has_permission('company.create',p_portfolio_id,null,null) then raise exception using errcode='42501',message='Company creation is unauthorized.'; end if;
    insert into public.companies(portfolio_id,name,registration_number,tpin,industry,business_email,phone,province,town,physical_address,contact_person,status)
    values(p_portfolio_id,btrim(p_company->>'name'),btrim(p_company->>'registration_number'),btrim(p_company->>'tpin'),btrim(p_company->>'industry'),btrim(p_company->>'business_email'),btrim(p_company->>'phone'),btrim(p_company->>'province'),btrim(p_company->>'town'),btrim(p_company->>'physical_address'),btrim(p_company->>'contact_person'),upper(coalesce(p_company->>'status','ACTIVE')))
    returning id into v_company_id;
  else
    select * into v_company from public.companies where id=p_company_id and portfolio_id=p_portfolio_id for update;
    if not found or not app_private.has_permission('company.edit',p_portfolio_id,p_company_id,null) then raise exception using errcode='42501',message='Company update is unauthorized.'; end if;
    update public.companies set name=btrim(p_company->>'name'),registration_number=btrim(p_company->>'registration_number'),tpin=btrim(p_company->>'tpin'),industry=btrim(p_company->>'industry'),business_email=btrim(p_company->>'business_email'),phone=btrim(p_company->>'phone'),province=btrim(p_company->>'province'),town=btrim(p_company->>'town'),physical_address=btrim(p_company->>'physical_address'),contact_person=btrim(p_company->>'contact_person'),status=upper(p_company->>'status') where id=p_company_id;
    v_company_id:=p_company_id;
  end if;
  for v_branch in select value from jsonb_array_elements(p_branches) loop
    v_branch_id:=nullif(v_branch->>'id','')::uuid;
    v_status:=upper(coalesce(v_branch->>'status','ACTIVE'));
    if v_status not in ('ACTIVE','INACTIVE','PENDING') or nullif(btrim(v_branch->>'name'),'') is null or nullif(btrim(v_branch->>'code'),'') is null then
      raise exception using errcode='22023',message='Branch details are invalid.';
    end if;
    if v_branch_id is null then
      if not app_private.has_permission('branch.create',p_portfolio_id,v_company_id,null) then raise exception using errcode='42501',message='Branch creation is unauthorized.'; end if;
      insert into public.branches(portfolio_id,company_id,name,code,province,town,physical_address,manager_name,contact_phone,status)
      values(p_portfolio_id,v_company_id,btrim(v_branch->>'name'),upper(btrim(v_branch->>'code')),coalesce(v_branch->>'province',''),coalesce(v_branch->>'town',''),coalesce(v_branch->>'physical_address',''),nullif(btrim(v_branch->>'manager_name'),''),nullif(btrim(v_branch->>'contact_phone'),''),v_status);
    else
      if not app_private.has_permission('branch.edit',p_portfolio_id,v_company_id,v_branch_id) then raise exception using errcode='42501',message='Branch update is unauthorized.'; end if;
      update public.branches set name=btrim(v_branch->>'name'),code=upper(btrim(v_branch->>'code')),province=coalesce(v_branch->>'province',''),town=coalesce(v_branch->>'town',''),physical_address=coalesce(v_branch->>'physical_address',''),manager_name=nullif(btrim(v_branch->>'manager_name'),''),contact_phone=nullif(btrim(v_branch->>'contact_phone'),''),status=v_status
        where id=v_branch_id and portfolio_id=p_portfolio_id and company_id=v_company_id;
      if not found then raise exception using errcode='42501',message='Branch is outside this company.'; end if;
    end if;
  end loop;
  for v_deactivate in select value::text::uuid from jsonb_array_elements_text(p_deactivate_branch_ids) loop
    if not app_private.has_permission('branch.edit',p_portfolio_id,v_company_id,v_deactivate) then raise exception using errcode='42501',message='Branch deactivation is unauthorized.'; end if;
    update public.branches set status='INACTIVE' where id=v_deactivate and portfolio_id=p_portfolio_id and company_id=v_company_id;
    if not found then raise exception using errcode='42501',message='Branch is outside this company.'; end if;
  end loop;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(p_portfolio_id,v_company_id,auth.uid(),case when p_company_id is null then 'COMPANY_CREATED' else 'COMPANY_WORKSPACE_UPDATED' end,'companies',v_company_id::text,jsonb_build_object('branch_count',jsonb_array_length(p_branches)));
  return v_company_id;
end $$;

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null, company_id uuid not null, branch_id uuid not null, employee_id uuid not null,
  storage_path text not null unique,
  document_type text not null check (document_type in ('IDENTITY','CONTRACT','CERTIFICATE','TAX','OTHER')),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 180),
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png')),
  byte_size bigint not null check (byte_size between 1 and 15728640),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(portfolio_id,company_id,branch_id,employee_id)
    references public.employees(portfolio_id,company_id,workplace_branch_id,id) on delete restrict
);
create index employee_documents_scope_idx on public.employee_documents(portfolio_id,company_id,branch_id,employee_id,created_at desc);
alter table public.employee_documents enable row level security;
revoke all on public.employee_documents from public,anon,authenticated;
grant select on public.employee_documents to authenticated;
create policy employee_documents_read_authorized on public.employee_documents for select to authenticated using (
  app_private.has_permission('employee.private.view',portfolio_id,company_id,branch_id)
  or exists(select 1 from public.employees e where e.id=employee_id and e.created_by=auth.uid()
    and e.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
    and app_private.has_permission('employee.create',portfolio_id,company_id,branch_id))
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('gb-employee-documents','gb-employee-documents',false,15728640,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets b
    where b.id='gb-employee-documents' and b.name='gb-employee-documents'
      and b.public is false and b.file_size_limit=15728640
      and cardinality(b.allowed_mime_types)=3
      and b.allowed_mime_types @> array['application/pdf','image/jpeg','image/png']::text[]
  ) then
    raise exception using errcode='55000',
      message='The gb-employee-documents bucket is missing or has incompatible privacy, size, or MIME settings; review it explicitly before applying migration 028.';
  end if;
end $$;

create policy employee_documents_storage_read on storage.objects for select to authenticated using (
  bucket_id='gb-employee-documents' and exists(select 1 from public.employees e
    where e.id::text=split_part(name,'/',4) and e.portfolio_id::text=split_part(name,'/',1)
      and e.company_id::text=split_part(name,'/',2) and e.workplace_branch_id::text=split_part(name,'/',3)
      and (app_private.has_permission('employee.private.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
        or (e.created_by=auth.uid() and e.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
          and app_private.has_permission('employee.create',e.portfolio_id,e.company_id,e.workplace_branch_id))))
);
create policy employee_documents_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='gb-employee-documents' and exists(select 1 from public.employees e
    where e.id::text=split_part(name,'/',4) and e.portfolio_id::text=split_part(name,'/',1)
      and e.company_id::text=split_part(name,'/',2) and e.workplace_branch_id::text=split_part(name,'/',3)
      and (app_private.has_permission('employee.private.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
        or (e.created_by=auth.uid() and e.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
          and app_private.has_permission('employee.create',e.portfolio_id,e.company_id,e.workplace_branch_id))))
);
create policy employee_documents_storage_remove_unregistered_upload on storage.objects for delete to authenticated using (
  bucket_id='gb-employee-documents' and owner_id=auth.uid()::text
  and not exists(select 1 from public.employee_documents d where d.storage_path=storage.objects.name)
);

-- Restrictive policies keep other permissive storage.objects policies from
-- broadening access to this bucket. Policies for all other buckets are unchanged.
create policy employee_documents_storage_read_guard on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'gb-employee-documents' or exists(select 1 from public.employees e
    where e.id::text=split_part(name,'/',4) and e.portfolio_id::text=split_part(name,'/',1)
      and e.company_id::text=split_part(name,'/',2) and e.workplace_branch_id::text=split_part(name,'/',3)
      and (app_private.has_permission('employee.private.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
        or (e.created_by=auth.uid() and e.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
          and app_private.has_permission('employee.create',e.portfolio_id,e.company_id,e.workplace_branch_id))))
);
create policy employee_documents_storage_insert_guard on storage.objects as restrictive for insert to authenticated with check (
  bucket_id<>'gb-employee-documents' or exists(select 1 from public.employees e
    where e.id::text=split_part(name,'/',4) and e.portfolio_id::text=split_part(name,'/',1)
      and e.company_id::text=split_part(name,'/',2) and e.workplace_branch_id::text=split_part(name,'/',3)
      and (app_private.has_permission('employee.private.view',e.portfolio_id,e.company_id,e.workplace_branch_id)
        or (e.created_by=auth.uid() and e.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
          and app_private.has_permission('employee.create',e.portfolio_id,e.company_id,e.workplace_branch_id))))
);
create policy employee_documents_storage_update_guard on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'gb-employee-documents') with check (bucket_id<>'gb-employee-documents');
create policy employee_documents_storage_delete_guard on storage.objects as restrictive for delete to authenticated using (
  bucket_id<>'gb-employee-documents' or (owner_id=auth.uid()::text
    and not exists(select 1 from public.employee_documents d where d.storage_path=storage.objects.name))
);
create policy employee_documents_storage_anon_read_guard on storage.objects as restrictive for select to anon
  using (bucket_id<>'gb-employee-documents');
create policy employee_documents_storage_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id<>'gb-employee-documents');
create policy employee_documents_storage_anon_update_guard on storage.objects as restrictive for update to anon
  using (bucket_id<>'gb-employee-documents') with check (bucket_id<>'gb-employee-documents');
create policy employee_documents_storage_anon_delete_guard on storage.objects as restrictive for delete to anon
  using (bucket_id<>'gb-employee-documents');

create or replace function public.employee_document_register(
  p_employee_id uuid,p_storage_path text,p_document_type text,p_file_name text,p_content_type text,p_byte_size bigint
) returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.employees%rowtype;v_id uuid;v_object storage.objects%rowtype;
begin
  select * into v from public.employees where id=p_employee_id;
  if not found or auth.uid() is null or p_storage_path is null or p_document_type not in ('IDENTITY','CONTRACT','CERTIFICATE','TAX','OTHER')
    or p_content_type not in ('application/pdf','image/jpeg','image/png') or p_byte_size not between 1 and 15728640
    or char_length(btrim(p_file_name)) not between 1 and 180
    or p_storage_path not like v.portfolio_id::text||'/'||v.company_id::text||'/'||v.workplace_branch_id::text||'/'||v.id::text||'/%'
    or not (app_private.has_permission('employee.private.view',v.portfolio_id,v.company_id,v.workplace_branch_id)
      or (v.created_by=auth.uid() and v.approval_status in ('DRAFT','RETURNED_FOR_CORRECTION')
        and app_private.has_permission('employee.create',v.portfolio_id,v.company_id,v.workplace_branch_id))) then
    raise exception using errcode='42501',message='Employee document registration is unauthorized or invalid.';
  end if;
  select * into v_object from storage.objects where bucket_id='gb-employee-documents' and name=p_storage_path;
  if not found then raise exception using errcode='23503',message='Uploaded employee document was not found in private storage.'; end if;
  if v_object.metadata->>'mimetype' is distinct from p_content_type
    or nullif(v_object.metadata->>'size','')::bigint is distinct from p_byte_size then
    raise exception using errcode='22023',message='Uploaded employee document metadata does not match the stored object.';
  end if;
  insert into public.employee_documents(portfolio_id,company_id,branch_id,employee_id,storage_path,document_type,file_name,content_type,byte_size,uploaded_by)
  values(v.portfolio_id,v.company_id,v.workplace_branch_id,v.id,p_storage_path,p_document_type,btrim(p_file_name),p_content_type,p_byte_size,auth.uid()) returning id into v_id;
  insert into public.audit_logs(portfolio_id,company_id,branch_id,actor_id,action,module,record_id,details)
  values(v.portfolio_id,v.company_id,v.workplace_branch_id,auth.uid(),'EMPLOYEE_DOCUMENT_UPLOADED','employees',v_id::text,jsonb_build_object('employee_id',v.id,'document_type',p_document_type,'byte_size',p_byte_size));
  return v_id;
end $$;

create or replace function public.company_set_status(p_company_id uuid,p_status text)
returns uuid language plpgsql security definer set search_path=pg_catalog set row_security=off
as $$
declare v public.companies%rowtype;
begin
  if p_status not in ('ACTIVE','INACTIVE','PENDING') then raise exception using errcode='22023',message='Company status is invalid.'; end if;
  select * into v from public.companies where id=p_company_id for update;
  if not found or auth.uid() is null or not app_private.has_permission('company.edit',v.portfolio_id,v.id,null) then
    raise exception using errcode='42501',message='Company status change is unauthorized.';
  end if;
  update public.companies set status=p_status where id=v.id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
    values(v.portfolio_id,v.id,auth.uid(),'COMPANY_STATUS_CHANGED','companies',v.id::text,jsonb_build_object('from',v.status,'to',p_status));
  return v.id;
end $$;

revoke all on function public.department_save(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.department_deactivate(uuid) from public,anon;
revoke all on function public.job_role_save(uuid,uuid,uuid,text,text,text) from public,anon;
revoke all on function public.job_role_deactivate(uuid) from public,anon;
revoke all on function public.company_workspace_save(uuid,uuid,jsonb,jsonb,jsonb) from public,anon;
revoke all on function public.employee_document_register(uuid,text,text,text,text,bigint) from public,anon;
revoke all on function public.company_set_status(uuid,text) from public,anon;
grant execute on function public.department_save(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.department_deactivate(uuid) to authenticated;
grant execute on function public.job_role_save(uuid,uuid,uuid,text,text,text) to authenticated;
grant execute on function public.job_role_deactivate(uuid) to authenticated;
grant execute on function public.company_workspace_save(uuid,uuid,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.employee_document_register(uuid,text,text,text,text,bigint) to authenticated;
grant execute on function public.company_set_status(uuid,text) to authenticated;

comment on table public.departments is 'Company-scoped department catalog. Legacy employee text remains valid and is linked on exact case-insensitive matches.';
comment on table public.job_roles is 'Company-scoped job titles optionally linked to a department.';
comment on table public.employee_documents is 'Private Storage object metadata; document bytes live only in the private gb-employee-documents bucket.';
