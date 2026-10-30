import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type BranchWorkCalendarRecord } from '../../services/live-business-services'

const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

export function BranchWorkCalendarWorkflow({ companyId, branchId, month }: { companyId: string; branchId: string; month: string }) {
  const [canManage, setCanManage] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [records, setRecords] = useState<BranchWorkCalendarRecord[]>([])
  const [datesText, setDatesText] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const start = `${month}-01`
  const end = monthEnd(month)
  const load = useCallback(async () => {
    const client = getSupabaseClient()
    const [userResult, capability, rows] = await Promise.all([
      client.auth.getUser(),
      createLiveBusinessServices(client).payroll.workCalendarCapabilities(companyId, branchId),
      createLiveBusinessServices(client).payroll.listWorkCalendars(companyId, branchId, start, end),
    ])
    setCurrentUserId(userResult.data.user?.id ?? '')
    setCanManage(capability.can_manage === true)
    setRecords(rows)
  }, [companyId, branchId, start, end])

  useEffect(() => { let active = true; void load().catch(() => { if (active) setError('Branch calendar requests could not be loaded for your current access.') }); return () => { active = false } }, [load])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const dates = datesText.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean)
    const isRealDate = (date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
      const parsed = new Date(`${date}T00:00:00Z`)
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    }
    if (!dates.length || dates.some((date) => !isRealDate(date) || date < start || date > end) || new Set(dates).size !== dates.length) {
      setError('Enter unique scheduled dates in YYYY-MM-DD format within the selected month.'); setBusy(false); return
    }
    try {
      await createLiveBusinessServices(getSupabaseClient()).payroll.requestWorkCalendar({ companyId, branchId, periodStart: start, periodEnd: end, scheduledWorkDates: dates.sort(), reason: reason.trim() })
      setDatesText(''); setReason(''); setNotice('Calendar submitted. Payroll remains blocked until a different authorized reviewer approves it.'); await load()
    } catch { setError('Calendar was not submitted. Check calendar management access, dates, and whether another request is pending.') }
    finally { setBusy(false) }
  }

  const review = async (record: BranchWorkCalendarRecord, decision: 'APPROVE' | 'RETURN') => {
    const reviewReason = decision === 'RETURN' ? window.prompt('Reason for returning this calendar')?.trim() : undefined
    if (decision === 'RETURN' && !reviewReason) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).payroll.reviewWorkCalendar(record.id, decision, reviewReason)
      setNotice(decision === 'APPROVE' ? 'Branch calendar approved and available to payroll.' : 'Calendar returned for correction.')
      await load()
    } catch { setError('Calendar review was not saved. The requester cannot approve their own calendar.') }
    finally { setBusy(false) }
  }

  return <section className="panel branch-calendar-workflow" aria-labelledby="branch-calendar-title">
    <header><div><h2 id="branch-calendar-title">Branch work calendar · {month}</h2><p>Enter the exact scheduled working dates, including branch-specific days and holidays. A separate authorized reviewer must approve the schedule.</p></div></header>
    {records.map((record) => <article className="branch-calendar-record" key={record.id}><strong>{record.status.replaceAll('_', ' ')}</strong><span>{record.scheduled_work_dates.length} scheduled days · {record.reason}</span>
      {record.status === 'PENDING' && canManage && currentUserId !== record.requested_by && <div className="branch-calendar-actions"><button type="button" className="button-primary" disabled={busy} onClick={() => void review(record, 'APPROVE')}>Approve calendar</button><button type="button" className="button-secondary" disabled={busy} onClick={() => void review(record, 'RETURN')}>Return for correction</button></div>}
    </article>)}
    {!records.some((record) => record.status === 'APPROVED') && !canManage && <p role="status">An approved calendar is required for payroll. Ask an authorized branch manager or HR administrator to submit the schedule for independent review.</p>}
    {canManage && !records.some((record) => record.status === 'PENDING') && <form onSubmit={(event) => void submit(event)}>
      <label>Scheduled work dates<textarea required value={datesText} onChange={(event) => setDatesText(event.target.value)} placeholder="2026-11-02, 2026-11-03, 2026-11-04" rows={4} /></label>
      <small>Provide every scheduled date in the month once. Dates are not inferred from weekdays.</small>
      <label>Reason<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button className="button-primary" disabled={busy || !datesText.trim() || !reason.trim()}>{busy ? 'Submitting…' : 'Submit calendar for approval'}</button>
    </form>}
    {error && <p role="alert" className="auth-shell-error">{error}</p>}{notice && <p role="status" className="import-success">{notice}</p>}
  </section>
}
