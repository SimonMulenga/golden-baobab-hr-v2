import { describe, expect, it } from 'vitest'
import { validateSupabaseConfiguration } from './client'

describe('Supabase browser configuration validation', () => {
  it('requires URL and publishable key in LIVE mode', () => {
    expect(() => validateSupabaseConfiguration('', '')).toThrow('LIVE data mode requires')
  })

  it('accepts an https project URL with a publishable key', () => {
    expect(validateSupabaseConfiguration('https://demo-project.supabase.co/', 'sb_publishable_synthetic')).toEqual({
      url: 'https://demo-project.supabase.co',
      publishableKey: 'sb_publishable_synthetic',
    })
  })

  it('rejects invalid URLs, service-role keys, and other key types', () => {
    expect(() => validateSupabaseConfiguration('not-a-url', 'sb_publishable_synthetic')).toThrow('valid absolute URL')
    const rolePayload = btoa(JSON.stringify({ role: 'service_role' })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    expect(() => validateSupabaseConfiguration('https://demo-project.supabase.co', `header.${rolePayload}.signature`)).toThrow('never a secret or service-role key')
    expect(() => validateSupabaseConfiguration('https://demo-project.supabase.co', 'not-a-supabase-key')).toThrow('publishable key or a legacy anon JWT')
  })
})
