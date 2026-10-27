import { describe, expect, it } from 'vitest'
import { getAuthGateDecision } from './auth-routing'

describe('authentication route gate', () => {
  it('preserves MOCK mode navigation without requiring a session', () => {
    expect(getAuthGateDecision({ live: false, loading: false, authenticated: false, recoveryRequired: false, pathname: '/' })).toBe('allow')
  })

  it('waits for restoration, redirects guests, and reserves recovery sessions for reset', () => {
    expect(getAuthGateDecision({ live: true, loading: true, authenticated: false, recoveryRequired: false, pathname: '/' })).toBe('loading')
    expect(getAuthGateDecision({ live: true, loading: false, authenticated: false, recoveryRequired: false, pathname: '/employees' })).toBe('login')
    expect(getAuthGateDecision({ live: true, loading: false, authenticated: true, recoveryRequired: true, pathname: '/employees' })).toBe('recovery')
    expect(getAuthGateDecision({ live: true, loading: false, authenticated: true, recoveryRequired: true, pathname: '/auth/reset' })).toBe('allow')
    expect(getAuthGateDecision({ live: true, loading: false, authenticated: true, recoveryRequired: false, pathname: '/employees' })).toBe('allow')
  })
})
