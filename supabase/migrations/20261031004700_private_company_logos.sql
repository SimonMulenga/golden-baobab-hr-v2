-- Private, tenant-scoped company logo storage.
-- The bucket is never silently reconfigured if it already exists.

alter table public.companies add column logo_storage_path text;

do $$
declare
  v_bucket storage.buckets%rowtype;
begin
  select * into v_bucket from storage.buckets where id = 'gb-company-logos';
  if found then
    if v_bucket.name <> 'gb-company-logos'
      or v_bucket.public is distinct from false
      or v_bucket.file_size_limit is distinct from 2097152
      or v_bucket.allowed_mime_types is distinct from array['image/webp']::text[] then
      raise exception using errcode='55000',
        message='The gb-company-logos bucket exists with incompatible privacy, size, or MIME settings; review it explicitly before applying migration 047.';
    end if;
  else
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('gb-company-logos','gb-company-logos',false,2097152,array['image/webp']);
  end if;
end;
$$;

create or replace function public.company_logo_set(p_company_id uuid, p_storage_path text)
returns void language plpgsql security definer
set search_path=pg_catalog set row_security=off
as $$
declare
  v_company public.companies%rowtype;
begin
  if auth.uid() is null or p_company_id is null then
    raise exception using errcode='42501', message='Company logo update is unauthorized.';
  end if;
  select * into v_company from public.companies where id=p_company_id for update;
  if not found or not app_private.has_permission('company.edit',v_company.portfolio_id,v_company.id,null) then
    raise exception using errcode='42501', message='Company logo update is unauthorized.';
  end if;
  if p_storage_path is not null then
    if storage.foldername(p_storage_path) is distinct from array[v_company.portfolio_id::text,v_company.id::text]
      or storage.filename(p_storage_path) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      or not exists(select 1 from storage.objects o where o.bucket_id='gb-company-logos'
        and o.name=p_storage_path and o.owner_id=auth.uid()::text) then
      raise exception using errcode='42501', message='The uploaded company logo is not authorized for this company.';
    end if;
  end if;
  update public.companies set logo_storage_path=p_storage_path where id=v_company.id;
  insert into public.audit_logs(portfolio_id,company_id,actor_id,action,module,record_id,details)
  values(v_company.portfolio_id,v_company.id,auth.uid(),'COMPANY_LOGO_UPDATED','companies',v_company.id::text,
    jsonb_build_object('logo_present',p_storage_path is not null));
end;
$$;

revoke all on function public.company_logo_set(uuid,text) from public,anon;
grant execute on function public.company_logo_set(uuid,text) to authenticated;

drop policy if exists gb_company_logos_select on storage.objects;
drop policy if exists gb_company_logos_insert on storage.objects;
drop policy if exists gb_company_logos_delete on storage.objects;
drop policy if exists gb_company_logos_select_guard on storage.objects;
drop policy if exists gb_company_logos_insert_guard on storage.objects;
drop policy if exists gb_company_logos_update_guard on storage.objects;
drop policy if exists gb_company_logos_delete_guard on storage.objects;
drop policy if exists gb_company_logos_anon_select_guard on storage.objects;
drop policy if exists gb_company_logos_anon_insert_guard on storage.objects;
drop policy if exists gb_company_logos_anon_update_guard on storage.objects;
drop policy if exists gb_company_logos_anon_delete_guard on storage.objects;

create policy gb_company_logos_select on storage.objects for select to authenticated using (
  bucket_id='gb-company-logos' and exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and app_private.has_permission('company.view',c.portfolio_id,c.id,null)
  )
);
create policy gb_company_logos_insert on storage.objects for insert to authenticated with check (
  bucket_id='gb-company-logos' and exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and storage.filename(storage.objects.name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      and app_private.has_permission('company.edit',c.portfolio_id,c.id,null)
  )
);
create policy gb_company_logos_delete on storage.objects for delete to authenticated using (
  bucket_id='gb-company-logos' and not exists(
    select 1 from public.companies c where c.logo_storage_path=storage.objects.name
  ) and exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and app_private.has_permission('company.edit',c.portfolio_id,c.id,null)
  )
);

-- Restrictive policies prevent unrelated permissive Storage policies from
-- granting cross-company, anonymous, or in-place mutation access to this bucket.
create policy gb_company_logos_select_guard on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'gb-company-logos' or exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and app_private.has_permission('company.view',c.portfolio_id,c.id,null)
  )
);
create policy gb_company_logos_insert_guard on storage.objects as restrictive for insert to authenticated with check (
  bucket_id<>'gb-company-logos' or exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and storage.filename(storage.objects.name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
      and app_private.has_permission('company.edit',c.portfolio_id,c.id,null)
  )
);
create policy gb_company_logos_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'gb-company-logos') with check(bucket_id<>'gb-company-logos');
create policy gb_company_logos_delete_guard on storage.objects as restrictive for delete to authenticated using (
  bucket_id<>'gb-company-logos' or (not exists(
    select 1 from public.companies c where c.logo_storage_path=storage.objects.name
  ) and exists(
    select 1 from public.companies c
    where c.id::text=split_part(storage.objects.name,'/',2)
      and c.portfolio_id::text=split_part(storage.objects.name,'/',1)
      and storage.foldername(storage.objects.name)=array[c.portfolio_id::text,c.id::text]
      and app_private.has_permission('company.edit',c.portfolio_id,c.id,null)
  ))
);
create policy gb_company_logos_anon_select_guard on storage.objects as restrictive for select to anon using(bucket_id<>'gb-company-logos');
create policy gb_company_logos_anon_insert_guard on storage.objects as restrictive for insert to anon with check(bucket_id<>'gb-company-logos');
create policy gb_company_logos_anon_update_guard on storage.objects as restrictive for update to anon using(bucket_id<>'gb-company-logos') with check(bucket_id<>'gb-company-logos');
create policy gb_company_logos_anon_delete_guard on storage.objects as restrictive for delete to anon using(bucket_id<>'gb-company-logos');

comment on column public.companies.logo_storage_path is 'Private Supabase Storage object path for the company logo; access is company-scoped.';
comment on function public.company_logo_set(uuid,text) is 'Updates the private company logo pointer after verifying company.edit permission and ownership of the uploaded object.';
