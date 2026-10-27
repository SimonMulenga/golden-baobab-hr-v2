import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../../lib/data-mode', () => ({ isLiveMode: true }))
vi.mock('./AuthScreens', () => ({
  LiveLoginScreen: () => <div>Supabase login form</div>,
  ForgotPasswordScreen: () => <div>Supabase recovery form</div>,
  ResetPasswordScreen: () => <div>Supabase password reset form</div>,
  AuthCallbackScreen: () => <div>Supabase callback</div>,
}))

import { AuthPrototype } from './AuthPrototype'

describe('AuthPrototype route selection', () => {
  it('renders the LIVE Supabase login component at /auth/login', () => {
    render(<MemoryRouter initialEntries={['/auth/login']}><Routes><Route path="/auth/:screen" element={<AuthPrototype/>}/></Routes></MemoryRouter>)
    expect(screen.getByText('Supabase login form')).toBeInTheDocument()
    expect(screen.queryByText('This is a visual demo only. No account or message was created.')).not.toBeInTheDocument()
  })
})
