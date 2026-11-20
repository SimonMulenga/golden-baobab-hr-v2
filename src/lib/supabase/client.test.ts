import { describe, expect, it } from 'vitest'
import { validateSupabaseConfiguration } from './client'

describe('Supabase browser configuration validation', () => {
  it('requires URL and publishable key in LIVE mode', () => {
    expect(() => validateSupabaseConfiguration('', '', '')).toThrow('LIVE data mode requires')
  })

  it('accepts an https project URL with a publishable key', () => {
    expect(validateSupabaseConfiguration('https://abcdefghijklmnopqrst.supabase.co/', 'sb_publishable_synthetic', 'abcdefghijklmnopqrst')).toEqual({
      url: 'https://abcdefghijklmnopqrst.supabase.co',
      publishableKey: 'sb_publishable_synthetic',
    })
  })

  it('rejects invalid URLs, service-role keys, and other key types', () => {
    expect(() => validateSupabaseConfiguration('not-a-url', 'sb_publishable_synthetic', 'abcdefghijklmnopqrst')).toThrow('valid absolute URL')
    const rolePayload = btoa(JSON.stringify({ role: 'service_role' })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    expect(() => validateSupabaseConfiguration('https://abcdefghijklmnopqrst.supabase.co', `header.${rolePayload}.signature`, 'abcdefghijklmnopqrst')).toThrow('never a secret or service-role key')
    expect(() => validateSupabaseConfiguration('https://abcdefghijklmnopqrst.supabase.co', 'not-a-supabase-key', 'abcdefghijklmnopqrst')).toThrow('publishable key or a legacy anon JWT')
  })
})
