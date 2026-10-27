import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isLiveMode } from '../../lib/data-mode'
import { getAuthenticationService } from './auth-service'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isLiveMode)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const revision = useRef(0)

  useEffect(() => {
    if (!isLiveMode) {
      return
    }

    let mounted = true
    const auth = getAuthenticationService()
    const isRecoveryRedirect = window.location.pathname === '/auth/reset'
      && new URLSearchParams(window.location.search).get('flow') === 'recovery'
    const unsubscribe = auth.onAuthStateChange((event, nextSession) => {
      revision.current += 1
      if (!mounted) return
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY' || (isRecoveryRedirect && nextSession)) setRecoveryRequired(true)
      if (event === 'SIGNED_OUT') setRecoveryRequired(false)
      setLoading(false)
    })

    const revisionAtRequest = revision.current
    void auth.getSession().then((restoredSession) => {
      if (!mounted || revision.current !== revisionAtRequest) return
      setSession(restoredSession)
      if (isRecoveryRedirect && restoredSession) setRecoveryRequired(true)
      setLoading(false)
    }).catch(() => {
      if (!mounted || revision.current !== revisionAtRequest) return
      setSession(null)
      setLoading(false)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await getAuthenticationService().signIn(email, password)
    setSession(result.session)
    setRecoveryRequired(false)
  }, [])

  const signOut = useCallback(async () => {
    await getAuthenticationService().signOut()
    setSession(null)
    setRecoveryRequired(false)
  }, [])

  const requestPasswordRecovery = useCallback(async (email: string) => {
    await getAuthenticationService().requestPasswordRecovery(email)
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    await getAuthenticationService().updatePassword(password)
    await getAuthenticationService().signOut()
    setSession(null)
    setRecoveryRequired(false)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    loading,
    isAuthenticated: Boolean(session?.user),
    recoveryRequired,
    signIn,
    signOut,
    requestPasswordRecovery,
    updatePassword,
  }), [session, loading, recoveryRequired, signIn, signOut, requestPasswordRecovery, updatePassword])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
