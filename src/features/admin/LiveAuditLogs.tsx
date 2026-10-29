import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock3, LoaderCircle, Search, ShieldCheck, X } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type AuditLogRecord } from '../../services/live-business-services'
import { formatWorkspaceDateTime, useWorkspace } from '../companies/WorkspaceContext'
import './live-audit-logs.css'

const timestamp = (value: string, preferences?: ReturnType<typeof useWorkspace>['preferences']) => formatWorkspaceDateTime(value, preferences, { dateStyle: 'medium', timeStyle: 'short' })

export function LiveAuditLogs() {
  const { companies, preferences, activeCompanyId: companyId, setActiveCompany: setCompanyId } = useWorkspace()
  const [branchId, setBranchId] = useState('all')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<AuditLogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<AuditLogRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const branches = companies.filter((company) => companyId === 'all' || company.id === companyId).flatMap((company) => company.branches)

  useEffect(() => {
    if (branchId !== 'all' && !branches.some((branch) => branch.id === branchId)) setBranchId('all')
  }, [companyId, branchId, branches])

  useEffect(() => {
    let cancelled = false
    createLiveBusinessServices(getSupabaseClient()).audit.list({
      page, pageSize: 50, companyId: companyId === 'all' ? undefined : companyId,
      branchId: branchId === 'all' ? undefined : branchId,
      action: action || undefined, from: from || undefined, to: to || undefined,
    }).then((result) => { if (!cancelled) { setRows(result.items); setTotal(result.total); setError('') } })
      .catch(() => { if (!cancelled) { setRows([]); setTotal(0); setError('Audit records are unavailable under the current reports permission.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, branchId, action, from, to, page])

  const applyFilters = (event: React.FormEvent) => { event.preventDefault(); setLoading(true); setPage(1) }
  const pageCount = Math.max(1, Math.ceil(total / 50))

  return <div className="live-audit-screen">
    <header className="page-heading"><div><div className="eyebrow">CONTROL & TRACEABILITY</div><h1>Audit logs</h1><p>Read-only history of authorized changes in your company scope.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> Events are read from the protected audit log. Browser users cannot edit or delete audit entries.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}
    <form className="panel live-audit-filters" onSubmit={applyFilters}>
      <label>Company<select aria-label="Audit company" value={companyId} onChange={(event) => { setLoading(true); setCompanyId(event.target.value); setBranchId('all'); setPage(1) }}><option value="all">All companies</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label>Branch<select aria-label="Audit branch" value={branchId} onChange={(event) => { setLoading(true); setBranchId(event.target.value); setPage(1) }}><option value="all">All branches</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label>Action contains<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="e.g. PAYROLL_FINALIZED" /></label>
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button-primary"><Search size={14}/> Apply filters</button>
    </form>
    <section className="panel live-audit-table">
      <header><div><div className="section-eyebrow">COMPANY HISTORY</div><h2>{total.toLocaleString()} matching events</h2></div><span>Page {page} of {pageCount}</span></header>
      {loading ? <div className="live-audit-empty" role="status"><LoaderCircle size={18}/> Loading audit history…</div>
        : rows.length ? <div className="table-scroll"><table><thead><tr><th>TIME</th><th>ACTION</th><th>MODULE</th><th>COMPANY / BRANCH</th><th>ACTOR</th><th>RECORD</th><th/></tr></thead><tbody>{rows.map((row) => { const company = companies.find((item) => item.id === row.company_id); const branch = company?.branches.find((item) => item.id === row.branch_id); return <tr key={row.id}><td>{timestamp(row.occurred_at, preferences)}</td><td><strong>{row.action.replaceAll('_', ' ')}</strong></td><td>{row.module}</td><td>{company?.name ?? 'Portfolio event'}{branch ? <small>{branch.name}</small> : null}</td><td><span className="audit-actor-id">{row.actor_id}</span></td><td>{row.record_id}</td><td><button className="admin-link" onClick={() => setSelected(row)}>View details</button></td></tr> })}</tbody></table></div>
        : <div className="live-audit-empty"><Clock3 size={20}/><strong>No audit events found</strong><span>Try a wider date range or another company.</span></div>}
      <footer><span>Records are returned in reverse chronological order.</span><div><button className="button-secondary" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => value - 1) }}><ChevronLeft size={14}/> Previous</button><button className="button-secondary" disabled={page >= pageCount || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}>Next <ChevronRight size={14}/></button></div></footer>
    </section>
    {selected && <div className="live-audit-scrim" role="presentation" onClick={() => setSelected(null)}><section className="panel live-audit-drawer" role="dialog" aria-modal="true" aria-labelledby="audit-event-title" onClick={(event) => event.stopPropagation()}><header><div><div className="section-eyebrow">EVENT DETAILS</div><h2 id="audit-event-title">{selected.action.replaceAll('_', ' ')}</h2></div><button className="icon-button subtle" aria-label="Close event details" onClick={() => setSelected(null)}><X size={17}/></button></header><dl><div><dt>Time</dt><dd>{timestamp(selected.occurred_at, preferences)}</dd></div><div><dt>Actor account</dt><dd>{selected.actor_id}</dd></div><div><dt>Record reference</dt><dd>{selected.record_id}</dd></div></dl><h3>Recorded details</h3><pre>{JSON.stringify(selected.details, null, 2)}</pre></section></div>}
  </div>
}
