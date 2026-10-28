import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Plus, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord, type LeaveBalanceRecord, type LeavePolicyRecord, type LeaveRequestRecord } from '../../services/live-business-services'

const leaveTypes = ['Annual leave', 'Sick leave', 'Maternity leave', 'Paternity leave', 'Compassionate leave', 'Unpaid leave', 'Other']
const defaultMonth = new Date().toISOString().slice(0, 7)
const defaultMonthStart = `${defaultMonth}-01`

export function LiveLeave() {
  const { companies, activeCompanyId } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [requests, setRequests] = useState<LeaveRequestRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [policies, setPolicies] = useState<LeavePolicyRecord[]>([])
  const [balances, setBalances] = useState<LeaveBalanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showRequest, setShowRequest] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [filter, setFilter] = useState('ALL')
  const [draft, setDraft] = useState({ employeeId: '', leaveType: 'Annual leave', classification: 'PAID' as 'PAID' | 'UNPAID', start: '', end: '', days: '', reason: '' })
  const [policy, setPolicy] = useState({ leaveType: 'Annual leave', classification: 'PAID' as 'PAID' | 'UNPAID', accrual: '1.67', cap: '', effectiveFrom: defaultMonthStart })

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const [requestPage, people, leavePolicies, leaveBalances] = await Promise.all([
        services.leave.requests({ companyId, ...(branchId ? { branchId } : {}), page: 1, pageSize: 100 }),
        services.employees.list({ companyId, ...(branchId ? { branchId } : {}), approvalStatus: 'APPROVED', page: 1, pageSize: 100 }),
        services.leave.policies(companyId),
        services.leave.balances(companyId),
      ])
      setRequests(requestPage.items); setEmployees(people.items); setPolicies(leavePolicies); setBalances(leaveBalances)
      setDraft((current) => ({ ...current, employeeId: people.items.some((item) => item.id === current.employeeId) ? current.employeeId : people.items[0]?.id ?? '' }))
    } catch { setError('Live leave records could not be loaded. Check your company and branch access.') }
    finally { setLoading(false) }
  }, [companyId, branchId, setDraft])
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])

  const employeeById = useMemo(() => new Map(employees.map((item) => [item.id, item])), [employees])
  const visibleRequests = requests.filter((item) => filter === 'ALL' || item.status === filter)
  const pendingCount = requests.filter((item) => item.status === 'PENDING').length
  const paidBalanceCount = balances.filter((item) => item.pay_classification === 'PAID').length

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!company?.portfolioId || !branchId || !draft.employeeId || !draft.start || !draft.end || !Number(draft.days) || draft.end < draft.start) {
      setError('Complete the employee, branch, date range, and leave days.'); return
    }
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).leave.createRequest({
        portfolioId: company.portfolioId, companyId, branchId, employeeId: draft.employeeId,
        leaveType: draft.leaveType, payClassification: draft.classification, startDate: draft.start,
        endDate: draft.end, days: Number(draft.days), reason: draft.reason.trim(), idempotencyKey: crypto.randomUUID(),
      })
      setShowRequest(false); setNotice('Leave request saved to Supabase and added to the approval queue.'); await load()
    } catch { setError('The leave request was not saved. Check for overlapping dates, approved employee status, and branch permissions.') }
    finally { setBusy(false) }
  }

  const review = async (request: LeaveRequestRecord, decision: 'APPROVE' | 'REJECT') => {
    let reason: string | undefined
    if (decision === 'REJECT') { reason = window.prompt('Reason for rejecting this leave request:') ?? undefined; if (!reason?.trim()) return }
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).leave.reviewRequest(request.id, decision, reason)
      setNotice(decision === 'APPROVE' ? 'Leave request approved.' : 'Leave request rejected.'); await load()
    } catch { setError('The decision was not saved. Paid leave approval also requires an effective policy and sufficient accrued balance.') }
    finally { setBusy(false) }
  }

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault(); if (!company?.portfolioId) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).leave.savePolicy({
        portfolioId: company.portfolioId, companyId, leave_type: policy.leaveType,
        pay_classification: policy.classification, accrual_days_per_month: Number(policy.accrual || 0),
        maximum_balance_days: policy.cap ? Number(policy.cap) : null, effective_from: policy.effectiveFrom, effective_to: null,
      })
      setShowPolicy(false); setNotice('Effective-dated leave policy saved. This configurable policy is not a statement of legal entitlement.'); await load()
    } catch { setError('Leave policy was not saved. Check the effective dates and your leave review permission.') }
    finally { setBusy(false) }
  }

  const accrue = async (item: LeavePolicyRecord) => {
    const periodStart = window.prompt('Enter the first day of the accrual month (YYYY-MM-01):', defaultMonthStart)
    if (!periodStart) return
    setBusy(true); setError(''); setNotice('')
    try {
      const count = await createLiveBusinessServices(getSupabaseClient()).leave.accrueMonth(item.id, periodStart)
      setNotice(`Leave accrual recorded for ${count} employees. Repeating this period does not duplicate accruals.`); await load()
    } catch { setError('Accrual was not recorded. Verify the effective date and leave review permission.') }
    finally { setBusy(false) }
  }

  return <div className="peopleops-screen">
    <section className="welcome-row peopleops-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>TIME AWAY · LIVE</div><h1>Leave management</h1><p>Persistent requests, effective-dated leave policies, approvals, and ledger-based balances.</p></div><div className="welcome-actions"><button className="button-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/> Refresh</button><button className="button-secondary" onClick={() => setShowPolicy(true)}><Plus size={15}/> Configure policy</button><button className="button-primary" onClick={() => setShowRequest(true)}><Plus size={15}/> Request leave</button></div></section>
    <section className="panel peopleops-panel"><div className="peopleops-toolbar"><label>Company<select aria-label="Leave company" value={companyId} onChange={(event) => { const next = companies.find((item) => item.id === event.target.value); setCompanyId(event.target.value); setBranchId(next?.branches[0]?.id ?? '') }}>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Branch<select aria-label="Leave branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All authorized branches</option>{(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select aria-label="Leave status filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All requests</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label></div>
      <div className="peopleops-kpis"><div><span>Pending requests</span><strong>{pendingCount}</strong></div><div><span>Requests loaded</span><strong>{requests.length}</strong></div><div><span>Employees shown</span><strong>{employees.length}</strong></div><div><span>Effective policies</span><strong>{policies.length}</strong></div><div><span>Employees with paid balance</span><strong>{paidBalanceCount}</strong></div></div>
      {notice && <p role="status" className="live-notice">{notice}</p>}{error && <p role="alert" className="live-error">{error}</p>}
      <div className="leave-balance-heading"><div><div className="section-eyebrow">LIVE LEDGER BALANCES</div><h2>Paid leave balances</h2><p>Accrual values are configurable assumptions and require HR verification before use.</p></div><span className="assumption-chip">No legal entitlement implied</span></div>
      <div className="leave-balance-strip">{balances.filter((item) => item.pay_classification === 'PAID').slice(0, 8).map((item) => <div key={`${item.employee_id}-${item.leave_policy_id}`}><span className="balance-avatar">{employeeById.get(item.employee_id)?.first_name?.[0] ?? 'E'}</span><span className="balance-person"><strong>{employeeById.get(item.employee_id)?.first_name} {employeeById.get(item.employee_id)?.last_name}</strong><small>{item.leave_type}</small></span><strong>{item.available_days} <small>days</small></strong></div>)}</div>
      <div className="leave-list-heading"><div><div className="section-eyebrow">REQUEST QUEUE</div><h2>Leave requests</h2></div></div><div className="table-scroll"><table className="peopleops-table"><thead><tr><th>EMPLOYEE</th><th>TYPE / CLASS</th><th>DATES</th><th>DAYS</th><th>STATUS</th><th>DECISION</th></tr></thead><tbody>{visibleRequests.map((item) => <tr key={item.id}><td><strong>{employeeById.get(item.employee_id)?.first_name ?? 'Employee'} {employeeById.get(item.employee_id)?.last_name ?? ''}</strong><small>{item.branch_id}</small></td><td>{item.leave_type}<small>{item.pay_classification}</small></td><td>{item.start_date} – {item.end_date}</td><td>{item.leave_days}</td><td><span className={`ops-pill ops-${item.status.toLowerCase()}`}>{item.status}</span></td><td>{item.status === 'PENDING' ? <span className="leave-row-actions"><button disabled={busy} aria-label={`Approve leave for ${employeeById.get(item.employee_id)?.first_name ?? 'employee'}`} onClick={() => void review(item, 'APPROVE')}><Check size={14}/></button><button disabled={busy} aria-label={`Reject leave for ${employeeById.get(item.employee_id)?.first_name ?? 'employee'}`} onClick={() => void review(item, 'REJECT')}><X size={14}/></button></span> : '—'}</td></tr>)}</tbody></table>{loading && <div className="ops-empty">Loading live leave records…</div>}{!loading && !visibleRequests.length && <div className="ops-empty">No leave requests match this selection.</div>}</div>
      <div className="leave-list-heading"><div><div className="section-eyebrow">CONFIGURED ACCRUAL</div><h2>Leave policies</h2></div></div><div className="table-scroll"><table className="peopleops-table"><thead><tr><th>LEAVE TYPE</th><th>CLASSIFICATION</th><th>ACCRUAL / MONTH</th><th>MAX BALANCE</th><th>EFFECTIVE</th><th></th></tr></thead><tbody>{policies.map((item) => <tr key={item.id}><td>{item.leave_type}</td><td>{item.pay_classification}</td><td>{item.accrual_days_per_month} days</td><td>{item.maximum_balance_days ?? 'No cap configured'}</td><td>{item.effective_from} – {item.effective_to ?? 'Ongoing'}</td><td>{item.pay_classification === 'PAID' && Number(item.accrual_days_per_month) > 0 && <button className="ops-action" disabled={busy} onClick={() => void accrue(item)}><RotateCcw size={14}/> Accrue month</button>}</td></tr>)}</tbody></table>{!policies.length && <div className="ops-empty">No leave policy is configured for this company.</div>}</div>
      <div className="peopleops-foot">Leave requests and balance changes persist in Supabase and are tenant-scoped. <span>Showing {visibleRequests.length} of loaded {requests.length}</span></div>
    </section>
    {showRequest && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Request leave</h2><p>Requests are saved for review. Inclusive dates are a calendar-day preview; enter the approved leave-day count.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowRequest(false)}><X size={17}/></button></header><form onSubmit={submitRequest}><label>Employee<select aria-label="Leave employee" value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}>{employees.map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {item.employee_number}</option>)}</select></label><label>Leave type<select value={draft.leaveType} onChange={(event) => setDraft({ ...draft, leaveType: event.target.value })}>{leaveTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Paid or unpaid<select value={draft.classification} onChange={(event) => setDraft({ ...draft, classification: event.target.value as 'PAID' | 'UNPAID' })}><option value="PAID">Paid</option><option value="UNPAID">Unpaid</option></select></label><div className="ops-date-pair"><label>Start date<input type="date" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })}/></label><label>End date<input type="date" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })}/></label></div><label>Leave days<input type="number" min="0.5" step="0.5" required value={draft.days} onChange={(event) => setDraft({ ...draft, days: event.target.value })}/></label><label>Reason<textarea rows={2} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })}/></label><footer><button type="button" className="button-secondary" onClick={() => setShowRequest(false)}>Cancel</button><button className="button-primary" disabled={busy || !employees.length}><Check size={14}/> Submit request</button></footer></form></section></div>}
    {showPolicy && <div className="ops-backdrop"><section className="ops-dialog" role="dialog" aria-modal="true"><header><div><h2>Configure leave policy</h2><p>These are company settings, not legal entitlement guidance.</p></div><button className="icon-button" aria-label="Close" onClick={() => setShowPolicy(false)}><X size={17}/></button></header><form onSubmit={savePolicy}><label>Leave type<select value={policy.leaveType} onChange={(event) => setPolicy({ ...policy, leaveType: event.target.value })}>{leaveTypes.map((item) => <option key={item}>{item}</option>)}</select></label><label>Classification<select value={policy.classification} onChange={(event) => setPolicy({ ...policy, classification: event.target.value as 'PAID' | 'UNPAID', accrual: event.target.value === 'UNPAID' ? '0' : policy.accrual })}><option value="PAID">Paid</option><option value="UNPAID">Unpaid</option></select></label><label>Accrual days per month<input type="number" min="0" step="0.01" value={policy.accrual} onChange={(event) => setPolicy({ ...policy, accrual: event.target.value })}/></label><label>Maximum balance (optional)<input type="number" min="0.01" step="0.01" value={policy.cap} onChange={(event) => setPolicy({ ...policy, cap: event.target.value })}/></label><label>Effective from<input type="date" required value={policy.effectiveFrom} onChange={(event) => setPolicy({ ...policy, effectiveFrom: event.target.value })}/></label><footer><button type="button" className="button-secondary" onClick={() => setShowPolicy(false)}>Cancel</button><button className="button-primary" disabled={busy}><Check size={14}/> Save policy</button></footer></form></section></div>}
  </div>
}

