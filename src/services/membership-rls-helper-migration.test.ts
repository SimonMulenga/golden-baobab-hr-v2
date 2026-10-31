import { describe, expect, it } from 'vitest'
import migration from '../../supabase/migrations/20261031004800_restore_authenticated_membership_rls_helper.sql?raw'

describe('authenticated membership RLS helper migration', () => {
  it('grants only authenticated users access to the own-user status helper', () => {
    expect(migration).toMatch(/revoke all on function app_private\.is_platform_super_admin\(\) from public, anon/i)
    expect(migration).toMatch(/grant usage on schema app_private to authenticated/i)
    expect(migration).toMatch(/grant execute on function app_private\.is_platform_super_admin\(\) to authenticated/i)
    expect(migration).not.toMatch(/grant execute on function app_private\.is_platform_super_admin\(\) to (?:anon|public|service_role)/i)
  })

  it('documents why RLS membership policies require the helper grant', () => {
    expect(migration).toMatch(/RLS policies call this helper for authenticated membership and branch reads/i)
    expect(migration).toMatch(/policies invoke it/i)
  })
})
