import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '../../lib/supabase/client'

export interface AuthenticationService {
  signIn(email: string, password: string): Promise<{ user: User; session: Session }>
  signOut(): Promise<void>
  getSession(): Promise<Session | null>
  onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void
  requestPasswordRecovery(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function safeAuthError(error: unknown): Error {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('invalid login credentials')) return new Error('Email or password is incorrect.')
  if (message.includes('email not confirmed')) return new Error('Confirm your email address before signing in.')
  if (message.includes('too many requests') || message.includes('rate limit')) return new Error('Too many attempts. Please wait a moment and try again.')
  if (message.includes('password should be') || message.includes('password is too short')) return new Error('Choose a stronger password and try again.')
  return new Error('We could not complete that request. Please try again.')
}

export function createAuthenticationService(client: SupabaseClient): AuthenticationService {
  return {
    async signIn(email, password) {
      if (!email.trim() || !password) throw new Error('Enter your email address and password.')
      if (!emailPattern.test(email.trim())) throw new Error('Enter a valid email address.')
      const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw safeAuthError(error)
      if (!data.user || !data.session) throw new Error('Sign-in did not create a valid session. Please try again.')
      return { user: data.user, session: data.session }
    },
    async signOut() {
      const { error } = await client.auth.signOut()
      if (error) throw safeAuthError(error)
    },
    async getSession() {
      const { data, error } = await client.auth.getSession()
      if (error) throw safeAuthError(error)
      return data.session
    },
    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session))
      return () => data.subscription.unsubscribe()
    },
    async requestPasswordRecovery(email) {
      if (!email.trim()) throw new Error('Enter your email address.')
      if (!emailPattern.test(email.trim())) throw new Error('Enter a valid email address.')
      // Build a fixed same-origin route. User-controlled redirect targets are never accepted.
      const redirectTo = new URL('/auth/reset?flow=recovery', window.location.origin)
      if (redirectTo.origin !== window.location.origin) throw new Error('Password recovery is unavailable on this origin.')
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo.toString() })
      if (error) throw safeAuthError(error)
    },
    async updatePassword(password) {
      if (password.length < 10) throw new Error('Use a password with at least 10 characters.')
      const { error } = await client.auth.updateUser({ password })
      if (error) throw safeAuthError(error)
    },
  }
}

let service: AuthenticationService | undefined
export function getAuthenticationService(): AuthenticationService {
  if (!service) service = createAuthenticationService(getSupabaseClient())
  return service
}
