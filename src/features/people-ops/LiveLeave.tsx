import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw, RotateCcw, X } from 'lucide-react'
import { formatWorkspaceDate, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord } from '../../services/live-business-services'
import { createLiveHrServices, type LeaveBalanceRecord, type LeaveCalendarExceptionRecord, type LeavePolicyRecord, type LeaveRequestHistoryRecord, type LeaveRequestRecord } from '../../services/live-hr-services'
import { countRequestedLeaveDays } from './leave-days'
import './people-ops.css'

const PAGE_SIZE = 25
const defaultMonthStart = `${new Date().toISOString().slice(0, 7)}-01`

export function LiveLeave() {
  const { companies, preferences, setActiveCompany } = useWorkspace()
  const { companyId, company } = useCompanySelection()
  const setCompanyId = (id: string) => setActiveCompany(id || 'all')
  const [branchId, setBranchId] = useState('')
  const [page, setPage] = useState(1)
  const [balancePage, setBalancePage] = useState(1)
  const [filter, setFilter] = useState('')
  const [requests, setRequests] = useState<LeaveRequestRecord[]>([])
  const [total, setTotal] = useState(0)
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [policies, setPolicies] = useState<LeavePolicyRecord[]>([])
  const [balances, setBalances] = useState<LeaveBalanceRecord[]>([])
  const [calendar, setCalendar] = useState<LeaveCalendarExceptionRecord[]>([])
  const [historyRequest, setHistoryRequest] = useState<string | null>(null)
  const [requestHistory, setRequestHistory] = useState<LeaveRequestHistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showRequest, setShowRequest] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [draft, setDraft] = useState({ employeeId: '', policyId: '', start: '', end: '', reason: '' })
  const [policyDraft, setPolicyDraft] = useState({ leaveType: 'Annual leave', classification: 'PAID' as 'PAID' | 'UNPAID', accrual: '1.67', maximum: '', effectiveFrom: defaultMonthStart, method: 'WORKING_DAYS' as 'WORKING_DAYS' | 'CALENDAR_DAYS', carry: '' })
  const [calendarDraft, setCalendarDraft] = useState({ date: '', working: false, label: '' })

  useEffect(() => {
    if (branchId && !company?.branches.some((item) => item.id === branchId)) setBranchId('')
  }, [companyId, company, branchId])

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); setRequests([]); setEmployees([]); setPolicies([]); setBalances([]); setCalendar([]); return }
    setLoading(true); setError('')
    try {
      const hr = createLiveHrServices(getSupabaseClient()).leave
      const business = createLiveBusinessServices(getSupabaseClient())
      const [requestPage, people, leavePolicies, leaveBalances, exceptions] = await Promise.all([
        hr.requests({ companyId, ...(branchId ? { branchId } : {}), page, pageSize: PAGE_SIZE, ...(filter ? { status: filter } : {}) }),
        business.employees.list({ companyId, ...(branchId ? { branchId } : {}), approvalStatus: 'APPROVED', page: 1, pageSize: 100 }),
        hr.policies(companyId), hr.balances(companyId), hr.calendar(companyId),
      ])
      setRequests(requestPage.items); setTotal(requestPage.total); setEmployees(people.items); setPolicies(leavePolicies); setBalances(leaveBalances); setCalendar(exceptions)
      setDraft((current) => ({ ...current, employeeId: people.items.some((item) => item.id === current.employeeId) ? current.employeeId : people.items[0]?.id ?? '', policyId: leavePolicies.some((item) => item.id === current.policyId) ? current.policyId : leavePolicies[0]?.id ?? '' }))
    } catch { setError('Live leave records could not be loaded. Check your company and branch access.') }
    finally { setLoading(false) }
  }, [companyId, branchId, page, filter])
  useEffect(() => { void load() }, [load])

  const employeeById = useMemo(() => new Map(employees.map((item) => [item.id, item])), [employees])
  const paidBalances = useMemo(() => balances.filter((item) => item.pay_classification === 'PAID'), [balances])
  const visibleBalances = paidBalances.slice((balancePage - 1) * 12, balancePage * 12)
  const selectedPolicy = policies.find((item) => item.id === draft.policyId)
  const previewDays = selectedPolicy ? countRequestedLeaveDays(draft.start, draft.end, selectedPolicy.day_count_method, calendar) : 0
  const mutate = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(success); await load() }
    catch { setError('The leave change was not saved. Check current status, company and branch permissions, policy, balance, and overlapping dates.') }
    finally { setBusy(false) }
  }
  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!company?.portfolioId || !branchId || !draft.employeeId || !selectedPolicy || !draft.start || !draft.end || previewDays < 1) { setError('Choose an authorized branch, employee, effective policy and valid dates containing at least one leave day.'); return }
    await mutate(async () => {
      await createLiveHrServices(getSupabaseClient()).leave.createRequest({ portfolioId: company.portfolioId!, companyId, branchId, employeeId: draft.employeeId, policyId: selectedPolicy.id, startDate: draft.start, endDate: draft.end, reason: draft.reason.trim(), idempotencyKey: crypto.randomUUID() })
      setShowRequest(false)
    }, 'Leave request submitted. Leave days and date conflicts were checked against the selected policy and company calendar.')
  }
  const transition = async (item: LeaveRequestRecord, decision: 'APPROVE' | 'REJECT' | 'RETURN' | 'SUBMIT' | 'CANCEL') => {
    const reason = decision === 'APPROVE' ? '' : window.prompt(decision === 'CANCEL' ? 'Reason for canceling this request:' : 'Reason for this decision:')
    if (decision !== 'APPROVE' && !reason?.trim()) return
    await mutate(() => createLiveHrServices(getSupabaseClient()).leave.transition(item.id, decision, reason?.trim()), `Leave request ${decision.toLowerCase()}d and recorded in its history.`)
  }
  const showHistory = async (request: LeaveRequestRecord) => {
    setHistoryRequest(request.id); setRequestHistory([]); setHistoryLoading(true); setError('')
    try { setRequestHistory(await createLiveHrServices(getSupabaseClient()).leave.history(request.id)) }
    catch { setError('Approval history could not be loaded for this leave request.') }
    finally { setHistoryLoading(false) }
  }
  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault(); if (!companyId) return
    await mutate(async () => { await createLiveHrServices(getSupabaseClient()).leave.savePolicy({ companyId, leaveType: policyDraft.leaveType.trim(), classification: policyDraft.classification, accrualPerMonth: Number(policyDraft.accrual), cap: policyDraft.maximum ? Number(policyDraft.maximum) : null, effectiveFrom: policyDraft.effectiveFrom, effectiveTo: null, dayCountMethod: policyDraft.method, carryForwardLimit: policyDraft.carry ? Number(policyDraft.carry) : null }); setShowPolicy(false) }, 'Effective dated company leave policy saved.')
  }
  const saveCalendar = async (event: React.FormEvent) => {
    event.preventDefault(); if (!companyId) return
    await mutate(async () => { await createLiveHrServices(getSupabaseClient()).leave.saveCalendarException({ companyId, date: calendarDraft.date, isWorkingDay: calendarDraft.working, label: calendarDraft.label.trim() }); setCalendarDraft({ date: '', working: false, label: '' }) }, 'Company working calendar updated.')
  }
  const accrue = async (item: LeavePolicyRecord) => {
    const period = window.prompt('Enter the first day of the accrual month (YYYY-MM-01):', defaultMonthStart)
    if (!period) return
    await mutate(() => createLiveHrServices(getSupabaseClient()).leave.accrueMonth(item.id, period), 'Monthly accrual and configured carry-forward limits were applied idempotently.')
  }

  return <div className="peopleops-screen">
    <section className="welcome-row peopleops-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>TIME AWAY</div><h1>Leave management</h1><p>Company policies, validated requests, approval history and leave balances.</p></div><div className="welcome-actions"><button className="button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={15}/> Refresh</button><button className="button-secondary" disabled={!companyId} onClick={() => setShowCalendar(true)}>Working calendar</button><button className="button-secondary" disabled={!companyId} onClick={() => setShowPolicy(true)}>Configure policy</button><button className="button-primary" disabled={!companyId || !employees.length || !policies.length || !branchId} onClick={() => setShowRequest(true)}><Plus size={15}/> Request leave</button></div></section>
    <section className="panel peopleops-panel"><div className="peopleops-toolbar"><label>Company<select aria-label="Leave company" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId(''); setPage(1); setBalancePage(1) }}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Branch<select aria-label="Leave branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1) }}><option value="">All authorized branches</option>{(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select aria-label="Leave status filter" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}><option value="">All requests</option>{['PENDING','APPROVED','REJECTED','RETURNED_FOR_CORRECTION','CANCELED'].map((status) => <option key={status}>{status}</option>)}</select></label></div>
      {notice && <p role="status" className="live-notice">{notice}</p>}{error && <p role="alert" className="live-error">{error}</p>}
      <div className="peopleops-kpis"><div><span>Requests in page</span><strong>{requests.length}</strong></div><div><span>Total requests</span><strong>{total}</strong></div><div><span>Employees</span><strong>{employees.length}</strong></div><div><span>Effective policies</span><strong>{policies.length}</strong></div><div><span>Calendar exceptions</span><strong>{calendar.length}</strong></div></div>
      <div className="leave-balance-heading"><div><div className="section-eyebrow">LEAVE BALANCES</div><h2>Paid leave balances</h2></div></div><div className="leave-balance-strip">{visibleBalances.map((item) => <div key={`${item.employee_id}-${item.leave_policy_id}`}><span className="balance-avatar">{employeeById.get(item.employee_id)?.first_name?.[0] ?? 'E'}</span><span className="balance-person"><strong>{employeeById.get(item.employee_id)?.first_name ?? 'Employee'} {employeeById.get(item.employee_id)?.last_name ?? ''}</strong><small>{item.leave_type}</small></span><strong>{item.available_days} <small>days</small></strong></div>)}{!loading && !paidBalances.length && <div className="ops-empty">No paid leave balances are available in this company.</div>}</div>{paidBalances.length > 12 && <div className="peopleops-foot" aria-label="Leave balance pagination"><span>Showing {(balancePage - 1) * 12 + 1}–{Math.min(balancePage * 12, paidBalances.length)} of {paidBalances.length} balances</span><span><button disabled={balancePage <= 1} onClick={() => setBalancePage((value) => value - 1)}>Previous</button><button disabled={balancePage >= Math.ceil(paidBalances.length / 12)} onClick={() => setBalancePage((value) => value + 1)}>Next</button></span></div>}
      <div className="leave-list-heading"><div><div className="section-eyebrow">REQUEST QUEUE</div><h2>Leave requests</h2></div></div><div className="table-scroll"><table className="peopleops-table"><thead><tr><th>EMPLOYEE</th><th>TYPE / CLASS</th><th>DATES</th><th>DAYS</th><th>STATUS</th><th>DECISION / HISTORY</th></tr></thead><tbody>{requests.map((item) => <tr key={item.id}><td><strong>{employeeById.get(item.employee_id)?.first_name ?? 'Employee'} {employeeById.get(item.employee_id)?.last_name ?? ''}</strong><small>{company?.branches.find((branchItem) => branchItem.id === item.branch_id)?.name ?? 'Branch unavailable'}</small></td><td>{item.leave_type}<small>{item.pay_classification}</small></td><td>{formatWorkspaceDate(item.start_date, preferences)} – {formatWorkspaceDate(item.end_date, preferences)}</td><td>{item.leave_days}</td><td><span className={`ops-pill ops-${item.status.toLowerCase()}`}>{item.status.replaceAll('_', ' ')}</span></td><td><div className="leave-row-actions">{item.status === 'PENDING' ? <><button disabled={busy} aria-label="Approve leave request" onClick={() => void transition(item, 'APPROVE')}><Check size={14}/></button><button disabled={busy} aria-label="Reject leave request" onClick={() => void transition(item, 'REJECT')}><X size={14}/></button><button disabled={busy} aria-label="Return leave request" onClick={() => void transition(item, 'RETURN')}><RotateCcw size={14}/></button></> : ['APPROVED','RETURNED_FOR_CORRECTION'].includes(item.status) ? <button className="ops-action" disabled={busy} onClick={() => void transition(item, item.status === 'APPROVED' ? 'CANCEL' : 'SUBMIT')}>{item.status === 'APPROVED' ? 'Cancel' : 'Resubmit'}</button> : null}<button className="ops-action" disabled={historyLoading && historyRequest === item.id} onClick={() => void showHistory(item)}>History</button></div></td></tr>)}</tbody></table>{loading && <div className="ops-empty" role="status">Loading live leave records…</div>}{!loading && !requests.length && <div className="ops-empty">No leave requests match this selection.</div>}</div>
      {historyRequest && <section className="leave-request-history" aria-label="Leave approval history"><div className="leave-list-heading"><div><div className="section-eyebrow">AUDIT TRAIL</div><h2>Approval history</h2><p>Request {historyRequest}</p></div><button className="button-secondary" onClick={() => { setHistoryRequest(null); setRequestHistory([]) }}>Close history</button></div>{historyLoading ? <div className="ops-empty" role="status">Loading approval history…</div> : requestHistory.length ? <ol className="attendance-history">{requestHistory.map((item) => <li key={item.id}><strong>{item.previous_status ?? 'Created'} → {item.new_status}</strong><span>{item.action} · {formatWorkspaceDate(item.occurred_at.slice(0, 10), preferences)}</span>{item.reason && <p>{item.reason}</p>}</li>)}</ol> : <div className="ops-empty">No review actions are recorded for this request yet.</div>}</section>}
      <div className="leave-list-heading"><div><div className="section-eyebrow">CONFIGURED ACCRUAL</div><h2>Leave policies</h2></div></div><div className="table-scroll"><table className="peopleops-table"><thead><tr><th>TYPE</th><th>CLASS</th><th>ACCRUAL / MONTH</th><th>METHOD</th><th>CARRY-FORWARD CAP</th><th>EFFECTIVE</th><th></th></tr></thead><tbody>{policies.map((item) => <tr key={item.id}><td>{item.leave_type}</td><td>{item.pay_classification}</td><td>{item.accrual_days_per_month}</td><td>{item.day_count_method.replace('_', ' ')}</td><td>{item.carry_forward_limit_days ?? 'Uncapped'}</td><td>{item.effective_from} – {item.effective_to ?? 'Ongoing'}</td><td>{item.pay_classification === 'PAID' && Number(item.accrual_days_per_month) > 0 && <button className="ops-action" disabled={busy} onClick={() => void accrue(item)}><RotateCcw size={14}/> Accrue month</button>}</td></tr>)}</tbody></table>{!policies.length && <div className="ops-empty">No leave policy is configured for this company.</div>}</div>
      <div className="peopleops-foot">Leave balances follow company policy and recorded approvals. <span><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14}/></button> Page {page} · {total} total <button disabled={page * PAGE_SIZE >= total || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight size={14}/></button></span></div>
    </section>
    {showRequest && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Request leave</h2><p>Leave days follow the selected policy and company calendar.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowRequest(false)}><X size={17}/></button></header><form onSubmit={(event) => void submitRequest(event)}><label>Employee<select required value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}>{employees.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {item.employee_number}</option>)}</select></label><label>Leave policy<select required value={draft.policyId} onChange={(event) => setDraft({ ...draft, policyId: event.target.value })}>{policies.map((item) => <option key={item.id} value={item.id}>{item.leave_type} · {item.pay_classification} · {item.day_count_method.replace('_', ' ')}</option>)}</select></label><div className="ops-date-pair"><label>Start date<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })}/></label><label>End date<input type="date" required value={draft.end} min={draft.start} onChange={(event) => setDraft({ ...draft, end: event.target.value })}/></label></div><p className="days-preview">Calculated preview: <strong>{previewDays} {previewDays === 1 ? 'day' : 'days'}</strong> · checked against the selected policy and calendar</p><label>Reason<textarea rows={2} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}/></label><footer><button type="button" className="button-secondary" onClick={() => setShowRequest(false)}>Cancel</button><button className="button-primary" disabled={busy || !previewDays}><Check size={14}/> Submit request</button></footer></form></section></div>}
    {showPolicy && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Configure leave policy</h2><p>Set the company's leave calculation, accrual and carry-forward rules.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowPolicy(false)}><X size={17}/></button></header><form onSubmit={(event) => void savePolicy(event)}><label>Leave category<input required maxLength={80} value={policyDraft.leaveType} onChange={(event) => setPolicyDraft({ ...policyDraft, leaveType: event.target.value })} placeholder="Annual, sick, maternity, compassionate, etc."/></label><label>Classification<select value={policyDraft.classification} onChange={(event) => setPolicyDraft({ ...policyDraft, classification: event.target.value as 'PAID' | 'UNPAID', accrual: event.target.value === 'UNPAID' ? '0' : policyDraft.accrual })}><option value="PAID">Paid</option><option value="UNPAID">Unpaid</option></select></label><label>Accrual days per month<input type="number" min="0" step="0.01" value={policyDraft.accrual} onChange={(event) => setPolicyDraft({ ...policyDraft, accrual: event.target.value })}/></label><label>Maximum balance<input type="number" min="0.01" step="0.01" value={policyDraft.maximum} onChange={(event) => setPolicyDraft({ ...policyDraft, maximum: event.target.value })}/></label><label>Days per request<select value={policyDraft.method} onChange={(event) => setPolicyDraft({ ...policyDraft, method: event.target.value as 'WORKING_DAYS' | 'CALENDAR_DAYS' })}><option value="WORKING_DAYS">Working days</option><option value="CALENDAR_DAYS">Calendar days</option></select></label><label>Carry-forward limit<input type="number" min="0" step="0.01" value={policyDraft.carry} onChange={(event) => setPolicyDraft({ ...policyDraft, carry: event.target.value })}/></label><label>Effective from<input type="date" required value={policyDraft.effectiveFrom} onChange={(event) => setPolicyDraft({ ...policyDraft, effectiveFrom: event.target.value })}/></label><footer><button type="button" className="button-secondary" onClick={() => setShowPolicy(false)}>Cancel</button><button className="button-primary" disabled={busy}><Check size={14}/> Save policy</button></footer></form></section></div>}
    {showCalendar && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Company working calendar</h2><p>Overrides default Monday–Friday working days for leave calculations.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowCalendar(false)}><X size={17}/></button></header><form onSubmit={(event) => void saveCalendar(event)}><label>Date<input type="date" required value={calendarDraft.date} onChange={(event) => setCalendarDraft({ ...calendarDraft, date: event.target.value })}/></label><label>Day behavior<select value={String(calendarDraft.working)} onChange={(event) => setCalendarDraft({ ...calendarDraft, working: event.target.value === 'true' })}><option value="false">Non-working day</option><option value="true">Working day</option></select></label><label>Label<input required maxLength={120} value={calendarDraft.label} onChange={(event) => setCalendarDraft({ ...calendarDraft, label: event.target.value })}/></label><button className="button-primary" disabled={busy}>Save calendar date</button></form><div className="table-scroll"><table className="peopleops-table"><tbody>{calendar.map((item) => <tr key={item.id}><td>{item.calendar_date}</td><td>{item.label}</td><td>{item.is_working_day ? 'Working day' : 'Non-working'}</td><td><button className="ops-action" disabled={busy} onClick={() => void mutate(() => createLiveHrServices(getSupabaseClient()).leave.removeCalendarException(item.id), 'Calendar exception removed.')}>Remove</button></td></tr>)}</tbody></table></div></section></div>}
  </div>
}
