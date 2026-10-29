import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActivateAccountScreen, ForgotPasswordScreen, LiveLoginScreen, ResetPasswordScreen } from './AuthScreens'
import { useAuth } from './auth-context'

vi.mock('./auth-context', () => ({ useAuth: vi.fn() }))
const useAuthMock = vi.mocked(useAuth)

function renderAt(path: string, routeElement: ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/auth/login" element={<LiveLoginScreen/>}/><Route path="/auth/forgot" element={<ForgotPasswordScreen/>}/><Route path="/auth/reset" element={<ResetPasswordScreen/>}/><Route path="/auth/activate" element={<ActivateAccountScreen/>}/><Route path="/" element={<div>Workspace route</div>}/><Route path="*" element={routeElement}/></Routes></MemoryRouter>)
}

describe('live authentication screens', () => {
  it('validates missing login credentials and shows safe auth errors', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('Email or password is incorrect.'))
    useAuthMock.mockReturnValue({ loading: false, isAuthenticated: false, recoveryRequired: false, signIn } as unknown as ReturnType<typeof useAuth>)
    renderAt('/auth/login', <div />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email address and password.')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'demo@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
  })

  it('signs in and goes only to the application root', async () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    useAuthMock.mockReturnValue({ loading: false, isAuthenticated: false, recoveryRequired: false, signIn } as unknown as ReturnType<typeof useAuth>)
    renderAt('/auth/login?next=https://attacker.example', <div />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'demo@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in securely' }))
    expect(await screen.findByText('Workspace route')).toBeInTheDocument()
    expect(signIn).toHaveBeenCalledWith('demo@example.test', 'a-strong-password')
  })

  it('requests recovery and confirms without disclosing account existence', async () => {
    const requestPasswordRecovery = vi.fn().mockResolvedValue(undefined)
    useAuthMock.mockReturnValue({ loading: false, requestPasswordRecovery } as unknown as ReturnType<typeof useAuth>)
    renderAt('/auth/forgot', <div />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'demo@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If an account matches that address')
    expect(requestPasswordRecovery).toHaveBeenCalledWith('demo@example.test')
  })

  it('rejects an invalid recovery link and validates password confirmation', async () => {
    useAuthMock.mockReturnValue({ loading: false, recoveryRequired: false } as unknown as ReturnType<typeof useAuth>)
    const { unmount } = renderAt('/auth/reset', <div />)
    expect(screen.getByText('Reset link unavailable')).toBeInTheDocument()
    unmount()

    const updatePassword = vi.fn().mockResolvedValue(undefined)
    useAuthMock.mockReturnValue({ loading: false, recoveryRequired: true, updatePassword } as unknown as ReturnType<typeof useAuth>)
    renderAt('/auth/reset', <div />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith('long-enough-password'))
  })

  it('requires an invitation session and activates an invited account through Supabase password update', async () => {
    useAuthMock.mockReturnValue({ loading: false, isAuthenticated: false } as unknown as ReturnType<typeof useAuth>)
    const { unmount } = renderAt('/auth/activate', <div />)
    expect(screen.getByText('Invitation link unavailable')).toBeInTheDocument()
    unmount()

    const updatePassword = vi.fn().mockImplementation(async () => {
      useAuthMock.mockReturnValue({ loading: false, isAuthenticated: false, recoveryRequired: false, signIn: vi.fn() } as unknown as ReturnType<typeof useAuth>)
    })
    useAuthMock.mockReturnValue({ loading: false, isAuthenticated: true, updatePassword } as unknown as ReturnType<typeof useAuth>)
    renderAt('/auth/activate', <div />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password and activate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password and activate' }))
    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith('long-enough-password'))
    expect(await screen.findByText('Your account is active. Sign in to continue.')).toBeInTheDocument()
  })
})

