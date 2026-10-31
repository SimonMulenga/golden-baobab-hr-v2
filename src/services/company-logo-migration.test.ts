import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261031004700_private_company_logos.sql?raw'

describe('private company logo migration contract', () => {
  it('fails on incompatible existing bucket settings and creates a private WebP-only bucket', () => {
    expect(migration).toMatch(/if found then[\s\S]*public is distinct from false[\s\S]*file_size_limit is distinct from 2097152[\s\S]*raise exception/)
    expect(migration).toMatch(/values\('gb-company-logos','gb-company-logos',false,2097152,array\['image\/webp'\]\)/)
  })

  it('requires company edit permission, verifies the scoped uploaded object, and audits pointer changes', () => {
    expect(migration).toMatch(/security definer[\s\S]*set search_path=pg_catalog set row_security=off/)
    expect(migration).toMatch(/has_permission\('company\.edit',v_company\.portfolio_id,v_company\.id,null\)/)
    expect(migration).toMatch(/owner_id=auth\.uid\(\)::text/)
    expect(migration).toMatch(/COMPANY_LOGO_UPDATED/)
  })

  it('uses company-scoped restrictive Storage policies and blocks public or in-place update access', () => {
    expect(migration).toMatch(/create policy gb_company_logos_select_guard on storage\.objects as restrictive/)
    expect(migration).toMatch(/has_permission\('company\.view',c\.portfolio_id,c\.id,null\)/)
    expect(migration).toMatch(/create policy gb_company_logos_insert_guard on storage\.objects as restrictive/)
    expect(migration).toMatch(/create policy gb_company_logos_anon_select_guard on storage\.objects as restrictive/)
    expect(migration).toMatch(/gb_company_logos_update_guard on storage\.objects as restrictive for update[\s\S]*bucket_id<>'gb-company-logos'/)
  })
})
