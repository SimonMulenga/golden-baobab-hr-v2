-- Keep staged employee candidates incomplete, but require an active
-- company-scoped department before a record can be marked ready for approval.
-- This is a forward-only function/trigger change; it does not modify employee,
-- payroll, or existing staging rows.

create or replace function app_private.employee_import_department_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_department text;
  v_bank_name text;
  v_payment_method text;
  v_normalized_bank text;
  v_errors jsonb;
begin
  v_department := nullif(btrim(coalesce(new.current_data->>'department', '')), '');
  v_bank_name := nullif(btrim(coalesce(new.current_data->>'bank_name', '')), '');
  v_payment_method := upper(coalesce(new.current_data->>'payment_method', ''));
  select coalesce(jsonb_agg(entry.value), '[]'::jsonb)
    into v_errors
  from jsonb_array_elements(coalesce(new.validation_errors, '[]'::jsonb)) as entry(value)
  where entry.value->>'type' is distinct from 'DEPARTMENT_REVIEW'
    and entry.value->>'type' is distinct from 'BANK_NAME_REVIEW';

  if v_payment_method = 'BANK_TRANSFER' and v_bank_name is not null then
    v_normalized_bank := regexp_replace(lower(v_bank_name), '[^a-z0-9]', '', 'g');
    if v_normalized_bank <> all(array[
      'abbankzambia', 'absabankzambia', 'accessbankzambia', 'bankofchinazambia', 'citibankzambia',
      'ecobankzambia', 'firstalliancebankzambia', 'firstcapitalbankzambia',
      'firstnationalbankzambiafnb', 'indozambiabank', 'stanbicbankzambia',
      'standardcharteredzambia', 'unitedbankforafricaubazambia',
      'zambiaindustrialcommercialbankzicb', 'zambianationalcommercialbankzanaco',
      'absa', 'fnb', 'zanaco', 'uba', 'zicb'
    ]) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'type', 'BANK_NAME_REVIEW',
        'field', 'bank_name',
        'message', 'Select a supported bank from the HR bank directory.'
      ));
      if new.review_status = 'READY_FOR_APPROVAL' then
        raise exception using errcode = '22023',
          message = 'Select a supported bank from the HR bank directory before marking this employee ready.';
      end if;
      if new.review_status = 'PENDING_REVIEW' then
        new.review_status := 'NEEDS_INFORMATION';
      end if;
    end if;
  end if;

  if new.company_id is not null and v_department is not null and not exists (
    select 1
    from public.departments d
    where d.company_id = new.company_id
      and d.status = 'ACTIVE'
      and lower(btrim(d.name)) = lower(v_department)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'type', 'DEPARTMENT_REVIEW',
      'field', 'department',
      'message', 'Select an active department configured for the assigned company.'
    ));
    if new.review_status = 'READY_FOR_APPROVAL' then
      raise exception using errcode = '22023',
        message = 'Select an active department configured for the assigned company before marking this employee ready.';
    end if;
    if new.review_status in ('PENDING_REVIEW', 'READY_FOR_APPROVAL') then
      new.review_status := 'NEEDS_INFORMATION';
    end if;
  end if;

  new.validation_errors := v_errors;
  return new;
end;
$$;

revoke all on function app_private.employee_import_department_guard() from public, anon, authenticated;
drop trigger if exists employee_import_department_guard on public.employee_import_staging_records;
create trigger employee_import_department_guard
before insert or update of company_id, current_data, validation_errors, review_status
on public.employee_import_staging_records
for each row execute function app_private.employee_import_department_guard();
