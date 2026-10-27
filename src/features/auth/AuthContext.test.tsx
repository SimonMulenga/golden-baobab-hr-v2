import { useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  service: {
    signIn: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    requestPasswordRecovery: vi.fn(),
    updatePassword: vi.fn(),
  },
}))

vi.mock('../../lib/data-mode', () => ({ isLiveMode: true }))
vi.mock('./auth-service', () => ({ getAuthenticationService: () => mocks.service }))

import { AuthProvider } from './AuthContext'
import { useAuth } from './auth-context'

const restoredSession = { access_token: 'test-access', token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh', user: { id: 'auth-user', email: 'hr@example.test' } } as Session
let authListener: ((event: string, session: Session | null) => void) | undefined
const unsubscribe = vi.fn()

function Probe() {
  const auth = useAuth()
  useEffect(() => { if (auth.isAuthenticated) document.body.dataset.authenticated = 'true' }, [auth.isAuthenticated])
  return <div>
    <span>{auth.loading ? 'loading' : auth.user?.email ?? 'signed out'}</span>
    <span>{auth.recoveryRequired ? 'recovery required' : 'normal session'}</span>
    <button onClick={() => void auth.signOut()}>Sign out test</button>
    <button onClick={() => void auth.updatePassword('a-long-enough-password')}>Update password test</button>
  </div>
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.dataset.authenticated = ''
    authListener = undefined
    mocks.service.getSession.mockResolvedValue(restoredSession)
    mocks.service.signOut.mockResolvedValue(undefined)
    mocks.service.updatePassword.mockResolvedValue(undefined)
    mocks.service.onAuthStateChange.mockImplementation((listener: (event: string, session: Session | null) => void) => {
      authListener = listener
      return unsubscribe
    })
  })

  it('restores the current session and unsubscribes when unmounted', async () => {
    const view = render(<AuthProvider><Probe/></AuthProvider>)
    expect(await screen.findByText('hr@example.test')).toBeInTheDocument()
    expect(mocks.service.getSession).toHaveBeenCalledOnce()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('handles sign-out and keeps recovery sessions in the reset state', async () => {
    render(<AuthProvider><Probe/></AuthProvider>)
    expect(await screen.findByText('hr@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out test' }))
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())

    act(() => authListener?.('PASSWORD_RECOVERY', restoredSession))
    expect(screen.getByText('recovery required')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update password test' }))
    await waitFor(() => expect(mocks.service.updatePassword).toHaveBeenCalledWith('a-long-enough-password'))
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())
    expect(screen.getByText('normal session')).toBeInTheDocument()
  })
})
