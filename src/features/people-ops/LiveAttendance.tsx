import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, RefreshCw, Send } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type AttendanceEntryRecord, type AttendancePeriodRecord, type EmployeeDirectoryRecord } from '../../services/live-business-services'

const pageSize = 50
const defaultMonth = new Date().toISOString().slice(0, 7)
const monthStart = (value: string) => `${value}-01`
const monthEnd = (value: string) => {
  const [year, month] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export function LiveAttendance() {
  const { companies, activeCompanyId } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [month, setMonth] = useState(defaultMonth)
  const [page, setPage] = useState(1)
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [entries, setEntries] = useState<AttendanceEntryRecord[]>([])
  const [period, setPeriod] = useState<AttendancePeriodRecord | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<EmployeeDirectoryRecord | null>(null)
  const [form, setForm] = useState({ scheduled: '', worked: '', paid: '0', unpaid: '0', other: '0', note: '' })

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
      setEmployees(people.items); setTotal(people.total); setPeriod(found); setEntries(monthlyEntries)
    } catch {
      setError('Live attendance could not be loaded. Check branch permissions and retry.')
    } finally { setLoading(false) }
  }, [companyId, branchId, month, page])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  const byEmployee = useMemo(() => new Map(entries.map((item) => [item.employee_id, item])), [entries])
  const summary = useMemo(() => entries.reduce((value, item) => ({
    scheduled: value.scheduled + Number(item.scheduled_working_days), worked: value.worked + Number(item.actual_days_worked),
    paid: value.paid + Number(item.paid_leave_days), unpaid: value.unpaid + Number(item.unpaid_leave_days),
  }), { scheduled: 0, worked: 0, paid: 0, unpaid: 0 }), [entries])

  const openEditor = (person: EmployeeDirectoryRecord) => {
    const row = byEmployee.get(person.id)
    setEditing(person)
    setForm({ scheduled: row ? String(row.scheduled_working_days) : '', worked: row ? String(row.actual_days_worked) : '',
      paid: row ? String(row.paid_leave_days) : '0', unpaid: row ? String(row.unpaid_leave_days) : '0',
      other: row ? String(row.other_payable_absence_days) : '0', note: '' })
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing || !company?.portfolioId || !branchId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      await services.attendance.saveEntry({ portfolioId: company.portfolioId, companyId, branchId,
        periodStart: monthStart(month), periodEnd: monthEnd(month), employeeId: editing.id,
        scheduledDays: Number(form.scheduled), workedDays: Number(form.worked), paidLeaveDays: Number(form.paid),
        unpaidLeaveDays: Number(form.unpaid), payableAbsenceDays: Number(form.other), contractType: editing.contract_type,
        correctionNote: form.note })
      setEditing(null); setNotice('Monthly attendance entry saved to Supabase.'); await load()
    } catch { setError('Attendance was not saved. Verify the values and your branch permission.') }
    finally { setBusy(false) }
  }

  const transition = async (action: 'submit' | 'approve' | 'return') => {
    if (!period) return
    setBusy(true); setError(''); setNotice('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      if (action === 'submit') await services.attendance.submitPeriod(period.id)
      else await services.attendance.reviewPeriod(period.id, action === 'approve' ? 'APPROVE' : 'RETURN', action === 'return' ? 'Please correct the monthly attendance entries.' : undefined)
      setNotice(action === 'submit' ? 'Attendance period submitted for review.' : action === 'approve' ? 'Attendance period approved.' : 'Attendance period returned for correction.')
      await load()
    } catch { setError('The attendance workflow action was not saved. Check your role and period status.') }
    finally { setBusy(false) }
  }

  return <div className="peopleops-screen">
    <section className="welcome-row peopleops-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>TIME & ATTENDANCE · LIVE</div><h1>Monthly attendance</h1><p>Record attendance by approved employee, then submit the branch period for review.</p></div><div className="welcome-actions"><button className="button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button></div></section>
    <section className="panel peopleops-panel"><div className="peopleops-toolbar">
      <label>Company<select aria-label="Attendance company" value={companyId} onChange={(event) => { const next = companies.find((item) => item.id === event.target.value); setCompanyId(event.target.value); setBranchId(next?.branches[0]?.id ?? ''); setPage(1) }}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Branch<select aria-label="Attendance branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1) }}>{(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Payroll month<input type="month" aria-label="Attendance month" value={month} onChange={(event) => setMonth(event.target.value)}/></label>
      {period && <span className={`ops-pill ops-${period.status.toLowerCase().replaceAll('_', '-')}`}>{period.status.replaceAll('_', ' ')}</span>}
      {period?.status === 'DRAFT' || period?.status === 'RETURNED_FOR_CORRECTION' ? <button className="button-primary" disabled={busy || entries.length === 0} onClick={() => void transition('submit')}><Send size={14}/> Submit period</button> : null}
      {period?.status === 'SUBMITTED' ? <><button className="button-secondary" disabled={busy} onClick={() => void transition('return')}>Return for correction</button><button className="button-primary" disabled={busy} onClick={() => void transition('approve')}><Check size={14}/> Approve period</button></> : null}
    </div>
    <div className="peopleops-kpis"><div><span>Approved employees · page</span><strong>{total}</strong></div><div><span>Recorded entries</span><strong>{entries.length}</strong></div><div><span>Scheduled days</span><strong>{summary.scheduled}</strong></div><div><span>Days worked</span><strong>{summary.worked}</strong></div><div><span>Paid / unpaid leave</span><strong>{summary.paid} / {summary.unpaid}</strong></div></div>
    {notice && <p role="status" className="live-notice">{notice}</p>}{error && <p role="alert" className="live-error">{error}</p>}
    <div className="table-scroll"><table className="peopleops-table"><thead><tr><th>EMPLOYEE</th><th>CONTRACT</th><th>SCHEDULED</th><th>WORKED</th><th>PAID LEAVE</th><th>UNPAID LEAVE</th><th>OTHER PAYABLE</th><th></th></tr></thead><tbody>{employees.map((person) => { const row = byEmployee.get(person.id); return <tr key={person.id}><td><strong>{person.first_name} {person.last_name}</strong><small>{person.employee_number} · {person.department}</small></td><td>{person.contract_type}</td><td>{row?.scheduled_working_days ?? '—'}</td><td>{row?.actual_days_worked ?? '—'}</td><td>{row?.paid_leave_days ?? '—'}</td><td>{row?.unpaid_leave_days ?? '—'}</td><td>{row?.other_payable_absence_days ?? '—'}</td><td><button className="ops-action" disabled={!!period && !['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(period.status)} onClick={() => openEditor(person)}>{row ? 'Correct' : 'Record'}</button></td></tr> })}</tbody></table>{loading && <div className="ops-empty">Loading attendance…</div>}{!loading && !employees.length && <div className="ops-empty">No approved employees are visible in this branch.</div>}{!loading && employees.length > 0 && !period && <div className="ops-empty">No entries yet for this month. Recording an employee creates the monthly attendance period.</div>}</div>
    <div className="peopleops-foot">Monthly entries are tenant-scoped and audited. Attendance values do not automatically reduce pay; payroll rules determine the effect. <span><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14}/></button> Page {page} <button disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}><ChevronRight size={14}/></button></span></div></section>
    {editing && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Monthly attendance entry</h2><p>{editing.first_name} {editing.last_name} · {month}</p></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Close">×</button></header><form onSubmit={save}><div className="ops-date-pair"><label>Scheduled working days<input type="number" min="0" step="0.5" required value={form.scheduled} onChange={(event) => setForm({ ...form, scheduled: event.target.value })}/></label><label>Actual days worked<input type="number" min="0" step="0.5" required value={form.worked} onChange={(event) => setForm({ ...form, worked: event.target.value })}/></label><label>Paid leave days<input type="number" min="0" step="0.5" value={form.paid} onChange={(event) => setForm({ ...form, paid: event.target.value })}/></label><label>Unpaid leave days<input type="number" min="0" step="0.5" value={form.unpaid} onChange={(event) => setForm({ ...form, unpaid: event.target.value })}/></label><label>Other payable absence<input type="number" min="0" step="0.5" value={form.other} onChange={(event) => setForm({ ...form, other: event.target.value })}/></label></div><label>Correction note<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Required context for a correction" rows={2}/></label><p><CalendarDays size={14}/> Entries are checked against scheduled days. Approved leave is summarized separately.</p><footer><button type="button" className="button-secondary" onClick={() => setEditing(null)}>Cancel</button><button className="button-primary" disabled={busy}><Check size={14}/> Save entry</button></footer></form></section></div>}
  </div>
}

