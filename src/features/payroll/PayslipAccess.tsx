import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { FileText, ShieldCheck } from 'lucide-react'
import '../../index.css'
import './payslip-access.css'
import { daysInMonth, formatBirthDate, todayInTimeZone, type BirthDateParts } from './payslip-access-date'

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const verificationFailure = 'We could not verify your details. Please check your date of birth or contact HR.'

export function PayslipAccess() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [birthDate, setBirthDate] = useState<BirthDateParts>({ day: '', month: '', year: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const today = useMemo(() => todayInTimeZone(), [])
  const years = useMemo(() => Array.from({ length: Math.max(0, today.year - 1899) }, (_, index) => String(today.year - index)), [today.year])
  const maxDay = birthDate.month && birthDate.year
    ? daysInMonth(Number(birthDate.year), Number(birthDate.month))
    : 31
  const dateOfBirth = formatBirthDate(birthDate, today)

  useEffect(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }, [])

  useEffect(() => () => {
    if (documentUrl) URL.revokeObjectURL(documentUrl)
  }, [documentUrl])

  const updateBirthDate = (key: keyof BirthDateParts, value: string) => {
    setBirthDate((current) => {
      const next = { ...current, [key]: value }
      const nextMaxDay = next.month && next.year ? daysInMonth(Number(next.year), Number(next.month)) : 31
      if (next.day && Number(next.day) > nextMaxDay) next.day = ''
      return next
    })
    setError('')
  }

  const openPayslip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) { setError('This link is missing or has expired. Contact HR to request a new payslip link.'); return }
    if (!dateOfBirth) { setError(verificationFailure); return }
    setBusy(true); setError('')
    try {
      const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      if (!publishableKey) throw new Error('SECURE_ACCESS_UNAVAILABLE')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payslip-access`, {
        method: 'POST',
        headers: new Headers({ apikey: publishableKey, 'Content-Type': 'application/json' }),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ token, dateOfBirth }),
      })
      if (!response.ok) throw new Error('VERIFICATION_FAILED')
      const pdf = await response.blob()
      if (pdf.type !== 'application/pdf' || pdf.size === 0) throw new Error('VERIFICATION_FAILED')
      const nextUrl = URL.createObjectURL(pdf)
      setDocumentUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return nextUrl
      })
    } catch {
      setError(verificationFailure)
    } finally { setBusy(false) }
  }

  return <main className="payslip-access-page">
    <section className="payslip-access-card" aria-labelledby="payslip-access-title">
      <div className="payslip-access-mark" aria-hidden="true"><FileText size={22}/></div>
      <div className="payslip-access-eyebrow"><ShieldCheck size={14}/> SECURE PAYSLIP ACCESS</div>
      <div className="payslip-access-brand">Golden Baobab HR</div>
      <h1 id="payslip-access-title">Secure Payslip Verification</h1>
      <p>For your security, please enter your date of birth to access your payslip.</p>
      {!token && <div className="payslip-access-error" role="alert">This link is missing or has expired. Contact HR to request a new payslip link.</div>}
      {!documentUrl && <form onSubmit={(event) => void openPayslip(event)}>
        <div className="payslip-access-date-fields" aria-label="Date of birth">
          <label htmlFor="payslip-birth-day">Day<select id="payslip-birth-day" value={birthDate.day} onChange={(event) => updateBirthDate('day', event.target.value)} required disabled={!token || busy} autoComplete="bday-day">
            <option value="">Select day</option>{Array.from({ length: maxDay }, (_, index) => index + 1).map((day) => <option value={String(day)} key={day}>{day}</option>)}
          </select></label>
          <label htmlFor="payslip-birth-month">Month<select id="payslip-birth-month" value={birthDate.month} onChange={(event) => updateBirthDate('month', event.target.value)} required disabled={!token || busy} autoComplete="bday-month">
            <option value="">Select month</option>{months.map((month, index) => <option value={String(index + 1)} key={month}>{month}</option>)}
          </select></label>
          <label htmlFor="payslip-birth-year">Year<select id="payslip-birth-year" value={birthDate.year} onChange={(event) => updateBirthDate('year', event.target.value)} required disabled={!token || busy} autoComplete="bday-year">
            <option value="">Select year</option>{years.map((year) => <option value={year} key={year}>{year}</option>)}
          </select></label>
        </div>
        {error && <div className="payslip-access-error" role="alert">{error}</div>}
        <button className="button-primary" type="submit" disabled={busy || !token || !dateOfBirth}>{busy ? 'Verifying…' : 'Verify & View Payslip'}</button>
      </form>}
      {documentUrl && <section className="payslip-access-viewer" aria-label="Verified payslip">
        <p role="status">Your payslip is verified. The PDF asks for your four-digit birth year to open. Please keep the file private, because a birth year is easy to guess.</p>
        <a className="button-primary payslip-access-download" href={documentUrl} download="Golden-Baobab-Payslip.pdf">Download secured payslip</a>
        <iframe title="Verified payslip PDF" src={documentUrl}/>
      </section>}
      <footer>Only a valid, unexpired email link and matching date of birth can open this private payslip. Links expire after 48 hours.</footer>
    </section>
  </main>
}
