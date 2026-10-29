import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useAuth } from './auth-context'

function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-prototype"><div className="auth-brand"><span>GB</span><strong>Golden Baobab <i>HR</i></strong></div><section className="auth-card"><div className="auth-demo-label"><ShieldCheck size={14}/> SECURE WORKSPACE ACCESS</div><div className="auth-card-mark">GB</div><h1>{title}</h1><p>{description}</p>{children}</section><footer><ShieldCheck size={13}/> Secure sign-in for your Golden Baobab HR workspace.</footer></main>
}

export function LiveLoginScreen() {
  const { signIn, loading, isAuthenticated, recoveryRequired } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  if (loading) return <AuthLoading />
  if (recoveryRequired) return <Navigate to="/auth/reset" replace />
  if (isAuthenticated) return <Navigate to="/" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) { setError('Enter your email address and password.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return }
    setSubmitting(true)
    try {
      await signIn(email, password)
      // Never redirect to arbitrary query-string URLs.
      navigate('/', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in. Please try again.')
    } finally { setSubmitting(false) }
  }

  return <AuthFrame title="Welcome back" description="Sign in to continue to your workspace.">
    {searchParams.has('reset') && <div className="auth-response" role="status">Your password has been updated. Sign in with your new password.</div>}
    {searchParams.has('activated') && <div className="auth-response" role="status">Your account is active. Sign in to continue.</div>}
    {searchParams.get('error') === 'session-expired' ? <div className="auth-error" role="status">Your session has expired. Sign in again to continue.</div> : searchParams.has('error') && <div className="auth-error" role="alert">This sign-in or recovery link is invalid or has expired. Request a new password reset link.</div>}
    <form onSubmit={submit} noValidate>
      <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>
      <label>Password<span className="auth-password"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="button-primary" disabled={submitting}>{submitting ? 'Signing inâ€¦' : 'Sign in securely'}</button>
    </form>
    <Link to="/auth/forgot">Forgot password?</Link>
  </AuthFrame>
}

export function ForgotPasswordScreen() {
  const { requestPasswordRecovery, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  if (loading) return <AuthLoading />

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!email.trim()) { setError('Enter your email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return }
    setSubmitting(true)
    try { await requestPasswordRecovery(email); setSent(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to send the request. Please try again.') }
    finally { setSubmitting(false) }
  }

  return <AuthFrame title="Reset your password" description="Enter your work email and weâ€™ll send a secure reset link if the account is eligible.">
    {sent ? <div className="auth-response" role="status">If an account matches that address, a password reset message will arrive shortly. Check your inbox.</div> : <form onSubmit={submit} noValidate><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" disabled={submitting}>{submitting ? 'Sendingâ€¦' : 'Send reset link'}</button></form>}
    <Link to="/auth/login">Back to sign in</Link>
  </AuthFrame>
}

export function ResetPasswordScreen() {
  const { loading, recoveryRequired, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  if (loading) return <AuthLoading />
  if (!recoveryRequired) return <AuthFrame title="Reset link unavailable" description="This password reset link is invalid, expired, or already used."><div className="auth-error" role="status">Request a new reset link to continue.</div><Link to="/auth/forgot">Request another link</Link><Link to="/auth/login">Return to sign in</Link></AuthFrame>

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (password.length < 10) { setError('Use a password with at least 10 characters.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    setSubmitting(true)
    try { await updatePassword(password); navigate('/auth/login?reset=complete', { replace: true }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update your password. Request a new reset link.') }
    finally { setSubmitting(false) }
  }

  return <AuthFrame title="Choose a new password" description="Create a strong password for your account."><form onSubmit={submit} noValidate><label>New password<span className="auth-password"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters"/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Enter it again"/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary" disabled={submitting}>{submitting ? 'Updatingâ€¦' : 'Update password'}</button></form></AuthFrame>
}

export function ActivateAccountScreen() {
  const { loading, isAuthenticated, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (loading) return <AuthLoading />
  if (!isAuthenticated) return <AuthFrame title="Invitation link unavailable" description="This invitation is invalid, expired, or already used."><div className="auth-error" role="status">Open the latest invitation link from your administrator. If your account is already active, sign in instead.</div><Link to="/auth/login">Return to sign in</Link></AuthFrame>

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (password.length < 10) { setError('Use a password with at least 10 characters.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    setBusy(true)
    try { await updatePassword(password); navigate('/auth/login?activated=complete', { replace: true }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Account activation could not be completed. Request a new invitation link.') }
    finally { setBusy(false) }
  }

  return <AuthFrame title="Activate your account" description="Set a password to finish activating your Golden Baobab HR account.">
    <form onSubmit={(event) => void submit(event)} noValidate>
      <label>New password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <button className="button-primary" disabled={busy}>{busy ? 'Activatingâ€¦' : 'Set password and activate'}</button>
    </form>
  </AuthFrame>
}

export function AuthCallbackScreen() {
  const { loading, recoveryRequired, isAuthenticated } = useAuth()
  if (loading) return <AuthLoading />
  if (recoveryRequired) return <Navigate to="/auth/reset" replace />
  return <Navigate to={isAuthenticated ? '/' : '/auth/login?error=invalid-link'} replace />
}

export function AuthLoading() {
  return <main className="auth-prototype" aria-live="polite"><div className="route-loading"><span className="route-loading-mark">GB</span><span>Securing your sessionâ€¦</span></div></main>
}


