import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, RefreshCw, Send, UserRoundPen } from 'lucide-react'
import { formatWorkspaceDateTime, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type AttendanceEntryRecord, type AttendancePeriodRecord, type EmployeeDirectoryRecord } from '../../services/live-business-services'
import { createLiveHrServices, type AttendancePeriodHistoryRecord } from '../../services/live-hr-services'
import './people-ops.css'

const pageSize = 50
const defaultMonth = new Date().toISOString().slice(0, 7)
const monthStart = (value: string) => `${value}-01`
const monthEnd = (value: string) => {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export function LiveAttendance() {
  const { companies, preferences } = useWorkspace()
  const { companyId, company, setCompanyId } = useCompanySelection()
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [month, setMonth] = useState(defaultMonth)
  const [page, setPage] = useState(1)
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [entries, setEntries] = useState<AttendanceEntryRecord[]>([])
  const [period, setPeriod] = useState<AttendancePeriodRecord | null>(null)
  const [history, setHistory] = useState<AttendancePeriodHistoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<EmployeeDirectoryRecord | null>(null)
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionCapability, setCorrectionCapability] = useState<'checking' | 'available' | 'unavailable'>('checking')
  const [form, setForm] = useState({ scheduled: '22', worked: '', paid: '0', unpaid: '0', other: '0', note: '' })

  useEffect(() => {
    if (company?.branches.some((item) => item.id === branchId)) return
    setBranchId(company?.branches[0]?.id ?? '')
  }, [companyId, company, branchId])

  const load = useCallback(async () => {
    if (!companyId || !branchId) { setLoading(false); setEmployees([]); setEntries([]); setPeriod(null); return }
    setLoading(true); setError('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const [people, foundPeriods] = await Promise.all([
        services.employees.list({ companyId, branchId, approvalStatus: 'APPROVED', page, pageSize }),
        services.attendance.periods({ companyId, branchId, periodStart: monthStart(month), page: 1, pageSize: 1 }),
      ])
      const found = foundPeriods.items[0] ?? null
      const monthlyEntries = found ? await services.attendance.entries(found.id) : []
      const periodHistory = found ? await createLiveHrServices(getSupabaseClient()).attendance.history(found.id) : []
      setEmployees(people.items); setTotal(people.total); setPeriod(found); setEntries(monthlyEntries); setHistory(periodHistory)
    } catch {
      setError('Live attendance could not be loaded. Check branch permissions and retry.')
    } finally { setLoading(false) }
  }, [companyId, branchId, month, page])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  useEffect(() => {
    if (period?.status !== 'APPROVED' || !companyId || !branchId) {
      setCorrectionCapability('checking')
      return
    }
    let active = true
    setCorrectionCapability('checking')
    void createLiveBusinessServices(getSupabaseClient()).attendance.approvedCorrectionCapability(companyId, branchId)
      .then((supported) => { if (active) setCorrectionCapability(supported ? 'available' : 'unavailable') })
      .catch(() => { if (active) setCorrectionCapability('unavailable') })
    return () => { active = false }
  }, [period?.id, period?.status, companyId, branchId])

  const byEmployee = useMemo(() => new Map(entries.map((item) => [item.employee_id, item])), [entries])
  const summary = useMemo(() => entries.reduce((value, item) => ({
    scheduled: value.scheduled + Number(item.scheduled_working_days), worked: value.worked + Number(item.actual_days_worked),
    paid: value.paid + Number(item.paid_leave_days), unpaid: value.unpaid + Number(item.unpaid_leave_days),
  }), { scheduled: 0, worked: 0, paid: 0, unpaid: 0 }), [entries])
  const entriesEditable = !period || ['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(period.status)

  const openEditor = (person: EmployeeDirectoryRecord) => {
    const row = byEmployee.get(person.id)
    setEditing(person)
    setForm({ scheduled: row ? String(row.scheduled_working_days) : '22', worked: row ? String(row.actual_days_worked) : '',
      paid: row ? String(row.paid_leave_days) : '0', unpaid: row ? String(row.unpaid_leave_days) : '0',
      other: row ? String(row.other_payable_absence_days) : '0', note: '' })
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing || !company?.portfolioId || !branchId) return
    const scheduled = Number(form.scheduled)
    const worked = Number(form.worked)
    const paid = Number(form.paid)
    const unpaid = Number(form.unpaid)
    const other = Number(form.other)
    if ([scheduled, worked, paid, unpaid, other].some((value) => !Number.isFinite(value) || value < 0 || value > 31)
      || worked + paid + unpaid + other > scheduled) {
      setError('Check the day totals. Worked, leave and other absence days cannot exceed scheduled working days.')
      return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      await services.attendance.saveEntry({ portfolioId: company.portfolioId, companyId, branchId,
        periodStart: monthStart(month), periodEnd: monthEnd(month), employeeId: editing.id,
        scheduledDays: scheduled, workedDays: worked, paidLeaveDays: paid,
        unpaidLeaveDays: unpaid, payableAbsenceDays: other, contractType: editing.contract_type,
        correctionNote: form.note })
      setEditing(null); setNotice('Monthly attendance entry saved.'); await load()
    } catch { setError('Attendance was not saved. Verify the values and your branch permission.') }
    finally { setBusy(false) }
  }

  const transition = async (action: 'submit' | 'approve' | 'return' | 'request-correction', reason?: string) => {
    if (!period) return
    setBusy(true); setError(''); setNotice('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      if (action === 'submit') { if (entries.length < total) throw new Error('Attendance is incomplete for this period.'); await services.attendance.submitPeriod(period.id) }
      else if (action === 'request-correction') { await services.attendance.requestApprovedCorrection(period.id, reason ?? '') }
      else await services.attendance.reviewPeriod(period.id, action === 'approve' ? 'APPROVE' : 'RETURN', action === 'return' ? 'Please correct the monthly attendance entries.' : undefined)
      setNotice(action === 'submit' ? 'Attendance period submitted for review.' : action === 'approve' ? 'Attendance period approved.' : action === 'return' ? 'Attendance period returned for correction.' : 'Correction opened. Updated entries must be resubmitted for independent review.')
      if (action === 'request-correction') { setCorrectionOpen(false); setCorrectionReason('') }
      await load()
    } catch {
      setError(action === 'request-correction'
        ? 'The correction was not opened. Confirm the period is approved, your attendance access is current, and no payroll run exists for this period.'
        : 'The attendance workflow action was not saved. Check your role and period status.')
    }
    finally { setBusy(false) }
  }

  return <div className="peopleops-screen attendance-page">
    <section className="welcome-row peopleops-heading attendance-page-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line"/>TIME & ATTENDANCE</div>
        <h1>Monthly attendance</h1>
        <p>Review each employee’s monthly record, resolve missing entries and submit the branch period for approval.</p>
      </div>
      <div className="welcome-actions">
        <button className="button-primary" type="button" onClick={() => setEmployeePickerOpen(true)} disabled={!branchId || loading || !employees.length || !entriesEditable}>
          <UserRoundPen size={16}/> Update
        </button>
        <button className="button-secondary" type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16}/> {loading ? 'Refreshing' : 'Refresh records'}
        </button>
      </div>
    </section>

    <section className="panel attendance-filter-panel" aria-label="Attendance filters">
      <div className="attendance-filter-heading">
      <div><h2>Attendance period</h2><p>Choose the company, branch and month to review. New entries start at 22 days; adjust them to the approved branch schedule.</p></div>
        {period && <span className={`ops-pill ops-${period.status.toLowerCase().replaceAll('_', '-')}`}>{period.status.replaceAll('_', ' ')}</span>}
      </div>
      <div className="attendance-filter-grid">
        <label>Company
          <select aria-label="Attendance company" value={companyId} onChange={(event) => {
            const next = companies.find((item) => item.id === event.target.value)
            setCompanyId(event.target.value); setBranchId(next?.branches[0]?.id ?? ''); setPage(1)
          }}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </label>
        <label>Branch
          <select aria-label="Attendance branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1) }}>
            {(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Month
          <input type="month" aria-label="Attendance month" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1) }}/>
        </label>
      </div>
      {period && <div className="attendance-workflow-bar">
        <div><strong>{period.status === 'APPROVED' ? 'Period approved' : period.status === 'SUBMITTED' ? 'Awaiting review' : period.status === 'RETURNED_FOR_CORRECTION' ? 'Returned for correction' : 'Draft period'}</strong>
          <span>{entries.length} of {total} employee entries recorded</span></div>
        <div className="attendance-workflow-actions">
          {period.status === 'DRAFT' || period.status === 'RETURNED_FOR_CORRECTION' ? <button className="button-primary" type="button" disabled={busy || entries.length < total} onClick={() => void transition('submit')}><Send size={15}/> Submit for approval</button> : null}
          {period.status === 'SUBMITTED' ? <><button className="button-secondary" type="button" disabled={busy} onClick={() => void transition('return')}>Return for correction</button><button className="button-primary" type="button" disabled={busy} onClick={() => void transition('approve')}><Check size={15}/> Approve period</button></> : null}
          {period.status === 'APPROVED' && <button className="button-secondary" type="button" disabled={busy || correctionCapability !== 'available'} onClick={() => { setCorrectionReason(''); setCorrectionOpen(true) }}>{correctionCapability === 'checking' ? 'Checking correction access…' : correctionCapability === 'available' ? 'Request correction' : 'Correction unavailable'}</button>}
        </div>
      </div>}
    </section>

    <section className="attendance-summary" aria-label="Attendance summary">
      <div><span>Approved employees</span><strong>{total}</strong></div>
      <div><span>Entries recorded</span><strong>{entries.length} <small>of {total}</small></strong></div>
      <div><span>Scheduled days</span><strong>{summary.scheduled}</strong></div>
      <div><span>Days worked</span><strong>{summary.worked}</strong></div>
      <div><span>Paid / unpaid leave</span><strong>{summary.paid} / {summary.unpaid}</strong></div>
    </section>

    {period?.status === 'SUBMITTED' && <p role="status" className="live-notice">This period is locked while under review. A reviewer must return it before entries can be changed.</p>}
    {period?.status === 'APPROVED' && <p role="status" className="live-notice">This approved period is locked. Request an audited correction to reopen it; the changes must be resubmitted for independent review. Reopening is blocked if a payroll run exists.</p>}
    {notice && <p role="status" className="live-notice">{notice}</p>}
    {error && <p role="alert" className="live-error">{error}</p>}

    <section className="panel attendance-records-panel" aria-labelledby="attendance-records-title">
      <header className="attendance-records-heading">
        <div><h2 id="attendance-records-title">Employee attendance</h2><p>Missing entries are marked clearly and must be recorded before submission.</p></div>
        <span className="attendance-record-count">{employees.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : `0 of ${total}`} employees</span>
      </header>
      <div className="table-scroll attendance-table-scroll" role="region" aria-label="Monthly attendance records" tabIndex={0}>
        <table className="peopleops-table attendance-table" aria-label="Employee attendance">
          <thead><tr><th scope="col">Employee</th><th scope="col">Contract</th><th scope="col">Scheduled days</th><th scope="col">Days worked</th><th scope="col">Paid leave</th><th scope="col">Unpaid leave</th><th scope="col">Other payable</th><th scope="col">Entry status</th><th scope="col">Action</th></tr></thead>
          <tbody>{employees.map((person) => {
            const row = byEmployee.get(person.id)
            return <tr key={person.id}>
              <td className="attendance-employee-cell"><strong>{person.first_name} {person.last_name}</strong><small>{person.employee_number}{person.department ? ` · ${person.department}` : ''}</small></td>
              <td>{person.contract_type || '—'}</td>
              <td className="attendance-number-cell">{row?.scheduled_working_days ?? '—'}</td>
              <td className="attendance-number-cell">{row?.actual_days_worked ?? '—'}</td>
              <td className="attendance-number-cell">{row?.paid_leave_days ?? '—'}</td>
              <td className="attendance-number-cell">{row?.unpaid_leave_days ?? '—'}</td>
              <td className="attendance-number-cell">{row?.other_payable_absence_days ?? '—'}</td>
              <td><span className={`attendance-entry-status ${row ? 'is-recorded' : 'is-missing'}`}><span aria-hidden="true"/>{row ? 'Recorded' : 'Missing'}</span></td>
              <td><button className="ops-action" type="button" disabled={!entriesEditable} onClick={() => openEditor(person)}>{entriesEditable ? row ? 'Edit entry' : 'Record entry' : 'Locked'}</button></td>
            </tr>
          })}</tbody>
        </table>
        {loading && <div className="ops-empty" role="status">Loading attendance records…</div>}
        {!loading && !employees.length && <div className="ops-empty">No approved employees are available in this branch.</div>}
        {!loading && employees.length > 0 && !period && <div className="attendance-inline-note">No attendance period exists for this month yet. Record an entry to open the period.</div>}
      </div>
      <footer className="attendance-table-footer">
        <p>Attendance is reviewed by period. Pay adjustments follow the approved payroll rules.</p>
        <nav aria-label="Attendance employee pages">
          <button type="button" aria-label="Previous employee page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17}/></button>
          <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <button type="button" aria-label="Next employee page" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17}/></button>
        </nav>
      </footer>
    </section>
    {employeePickerOpen && <div className="ops-backdrop"><section className="ops-dialog attendance-employee-picker" role="dialog" aria-modal="true" aria-labelledby="attendance-update-title"><header><div><h2 id="attendance-update-title">Update attendance</h2><p>{company?.name} · {company?.branches.find((item) => item.id === branchId)?.name} · {month}</p></div><button className="icon-button" type="button" onClick={() => setEmployeePickerOpen(false)} aria-label="Close">×</button></header><p>Select an approved employee in this branch. Existing entries can be updated while the period is open.</p><div className="attendance-employee-picker-list">{employees.map((person) => { const row = byEmployee.get(person.id); return <button type="button" key={person.id} disabled={!entriesEditable} onClick={() => { setEmployeePickerOpen(false); openEditor(person) }}><span><strong>{person.first_name} {person.last_name}</strong><small>{person.employee_number} · {person.department || 'No department'}</small></span><span>{row ? `${row.actual_days_worked} worked · ${row.paid_leave_days + row.unpaid_leave_days} leave` : 'No entry · defaults to 22 scheduled days'}</span></button> })}</div></section></div>}
    {period && <section className="panel peopleops-panel"><div className="leave-list-heading"><div><div className="section-eyebrow">PERIOD AUDIT TRAIL</div><h2>Attendance history</h2></div></div>{history.length ? <ol className="attendance-history">{history.map((item) => <li key={item.id}><strong>{item.previous_status ?? 'Created'} → {item.new_status}</strong><span>{item.action} · {formatWorkspaceDateTime(item.occurred_at, preferences)}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol> : <div className="ops-empty">No attendance workflow changes recorded yet.</div>}</section>}
    {editing && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-entry-title"><header><div><h2 id="attendance-entry-title">Monthly attendance entry</h2><p>{editing.first_name} {editing.last_name} · {month}</p></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Close">×</button></header><form onSubmit={save}><div className="ops-date-pair"><label>Scheduled working days<input type="number" min="0" max="31" step="0.5" required value={form.scheduled} onChange={(event) => setForm({ ...form, scheduled: event.target.value })}/></label><label>Actual days worked<input type="number" min="0" max="31" step="0.5" required value={form.worked} onChange={(event) => setForm({ ...form, worked: event.target.value })}/></label><label>Paid leave days taken<input type="number" min="0" max="31" step="0.5" value={form.paid} onChange={(event) => setForm({ ...form, paid: event.target.value })}/></label><label>Unpaid leave days taken<input type="number" min="0" max="31" step="0.5" value={form.unpaid} onChange={(event) => setForm({ ...form, unpaid: event.target.value })}/></label><label>Other payable absence<input type="number" min="0" max="31" step="0.5" value={form.other} onChange={(event) => setForm({ ...form, other: event.target.value })}/></label></div><label>Correction note<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Required context for a correction" rows={2}/></label><p><CalendarDays size={14}/> New entries use an editable 22-day starting value; follow the approved branch schedule. Saving refreshes attendance totals. Leave balances still follow approved leave requests, and payroll checks attendance against approved leave.</p><footer><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button-primary" disabled={busy}><Check size={14}/> Save entry</button></footer></form></section></div>}
    {correctionOpen && period && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true" aria-labelledby="attendance-correction-title"><header><div><h2 id="attendance-correction-title">Request attendance correction</h2><p>{month} · {company?.name}</p></div><button className="icon-button" type="button" onClick={() => setCorrectionOpen(false)} aria-label="Close">×</button></header><form onSubmit={(event) => { event.preventDefault(); void transition('request-correction', correctionReason) }}><label>Reason for correction<textarea autoFocus required minLength={3} maxLength={1000} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} rows={4}/></label><p>Payroll run history is checked before reopening. After changes, submit the period for review by a different authorized reviewer.</p><footer><button type="button" className="button-secondary" disabled={busy} onClick={() => setCorrectionOpen(false)}>Cancel</button><button className="button-primary" disabled={busy || correctionReason.trim().length < 3}>{busy ? 'Requesting…' : 'Open correction'}</button></footer></form></section></div>}
  </div>
}

