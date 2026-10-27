import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { createAuthenticationService } from './auth-service'

const session = { access_token: 'mock-token', token_type: 'bearer', expires_in: 3600, expires_at: 1, refresh_token: 'mock-refresh', user: { id: 'user-1', email: 'demo@example.test' } } as Session
const user = session.user as User

function makeAuthService() {
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  }
  const client = { auth } as unknown as SupabaseClient
  return { auth, service: createAuthenticationService(client) }
}

describe('Supabase authentication service', () => {
  let auth: ReturnType<typeof makeAuthService>['auth']
  let service: ReturnType<typeof makeAuthService>['service']

  beforeEach(() => { ({ auth, service } = makeAuthService()) })

  it('requires credentials and sanitizes rejected credentials', async () => {
    await expect(service.signIn('', '')).rejects.toThrow('Enter your email address and password.')
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: new Error('Invalid login credentials') })
    await expect(service.signIn('person@example.test', 'bad-password')).rejects.toThrow('Email or password is incorrect.')
  })

  it('returns the signed-in user and session', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user, session }, error: null })
    await expect(service.signIn(' person@example.test ', 'a-long-password')).resolves.toEqual({ user, session })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'person@example.test', password: 'a-long-password' })
  })

  it('restores a session, signs out, and cleans up auth listeners', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null })
    auth.signOut.mockResolvedValue({ error: null })
    const unsubscribe = vi.fn()
    auth.onAuthStateChange.mockImplementation((callback) => {
      callback('INITIAL_SESSION', session)
      return { data: { subscription: { unsubscribe } } }
    })
    await expect(service.getSession()).resolves.toEqual(session)
    const received = vi.fn()
    const cleanup = service.onAuthStateChange(received)
    expect(received).toHaveBeenCalledWith('INITIAL_SESSION', session)
    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
    await service.signOut()
    expect(auth.signOut).toHaveBeenCalledOnce()
  })

  it('uses a fixed same-origin password reset route and updates password', async () => {
    window.history.replaceState({}, '', '/auth/forgot')
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    auth.updateUser.mockResolvedValue({ data: { user }, error: null })
    await service.requestPasswordRecovery('person@example.test')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('person@example.test', { redirectTo: 'http://localhost:3000/auth/reset?flow=recovery' })
    await expect(service.updatePassword('short')).rejects.toThrow('at least 10 characters')
    await service.updatePassword('a-strong-demo-password')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-strong-demo-password' })
  })
})
