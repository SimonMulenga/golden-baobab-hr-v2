import { useEffect, useState, type FormEvent } from 'react'
import { FileText, ShieldCheck } from 'lucide-react'
import '../../index.css'
import './payslip-access.css'

export function PayslipAccess() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [employeeNumber, setEmployeeNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [])

  const openPayslip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) { setError('This link is missing or has expired. Contact HR to request a new payslip link.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      if (!publishableKey) throw new Error('Secure payslip access is not configured. Contact HR.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payslip-access`, {
        method: 'POST',
        headers: new Headers({ apikey: publishableKey, 'Content-Type': 'application/json' }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ token, employeeNumber: employeeNumber.trim(), dateOfBirth }),
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(result.error || 'The link or verification details could not be verified. Check the details or contact HR.')
      }
      const pdf = await response.blob()
      if (pdf.type !== 'application/pdf' || pdf.size === 0) throw new Error('The payslip could not be retrieved. Try again or contact HR.')
      const objectUrl = URL.createObjectURL(pdf)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = 'Golden-Baobab-Payslip.pdf'
      anchor.rel = 'noreferrer'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      setNotice('Your verified payslip download has started.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The payslip could not be verified. Try again or contact HR.')
    } finally { setBusy(false) }
  }

  return <main className="payslip-access-page">
    <section className="payslip-access-card" aria-labelledby="payslip-access-title">
      <div className="payslip-access-mark" aria-hidden="true"><FileText size={22}/></div>
      <div className="payslip-access-eyebrow"><ShieldCheck size={14}/> SECURE PAYSLIP ACCESS</div>
      <h1 id="payslip-access-title">Verify your identity</h1>
      <p>Enter your employee number and date of birth to open your finalized payslip. This private link expires after 48 hours.</p>
      {!token && <div className="payslip-access-error" role="alert">This link is missing or has expired. Contact HR to request a new payslip link.</div>}
      <form onSubmit={(event) => void openPayslip(event)}>
        <label>Employee number<input autoComplete="off" autoCapitalize="characters" maxLength={80} value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value)} required/></label>
        <label>Date of birth<input type="date" autoComplete="bday" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} required/></label>
        {error && <div className="payslip-access-error" role="alert">{error}</div>}
        {notice && <div className="payslip-access-notice" role="status">{notice}</div>}
        <button className="button-primary" type="submit" disabled={busy || !token}>{busy ? 'Verifying…' : 'Verify and download payslip'}</button>
      </form>
      <footer>Golden Baobab HR · We do not display salary information until identity is verified.</footer>
    </section>
  </main>
}
