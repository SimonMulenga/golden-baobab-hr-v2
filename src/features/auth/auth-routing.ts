export type AuthGateDecision = 'loading' | 'recovery' | 'login' | 'allow'

export function getAuthGateDecision(input: {
  live: boolean
  loading: boolean
  authenticated: boolean
  recoveryRequired: boolean
  pathname: string
}): AuthGateDecision {
  if (!input.live || input.pathname.startsWith('/auth/')) return 'allow'
  if (input.loading) return 'loading'
  if (input.recoveryRequired && input.pathname !== '/auth/reset') return 'recovery'
  if (!input.authenticated) return 'login'
  return 'allow'
}
