import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileCheck2, LoaderCircle, ShieldCheck, X } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type FinalizedPayslipRunRecord } from '../../services/live-business-services'
import { createLiveStatutoryFilingServices, type FilingAuthority, type FilingStatus, type RemittanceStatus, type StatutoryFilingRecord } from '../../services/live-statutory-filing-services'
import { formatWorkspaceDate, useWorkspace } from '../companies/WorkspaceContext'
import { LivePayrollReports } from './LivePayrollReports'
import './live-statutory-filings.css'
import { napsaRemittanceDeadline } from './napsa-remittance-date'

const PAGE_SIZE = 25
const authorities: FilingAuthority[] = ['PAYE', 'NAPSA', 'NHIMA']
const money = (value: number) => `K${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const csv = (value: unknown) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

type EditDraft = {
  filingStatus: FilingStatus; submittedAt: string; submissionReference: string; remittanceStatus: RemittanceStatus
  remittedAmount: string; remittedAt: string; remittanceReference: string; note: string
}

export function LiveStatutoryFilings() {
  const { companies, activeCompanyId, preferences } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [runs, setRuns] = useState<FinalizedPayslipRunRecord[]>([])
  const [records, setRecords] = useState<StatutoryFilingRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [runId, setRunId] = useState('')
  const [authority, setAuthority] = useState<FilingAuthority>('PAYE')
  const [dueDate, setDueDate] = useState('')
  const [target, setTarget] = useState<StatutoryFilingRecord | null>(null)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [loading, setLoading] = useState(Boolean(companyId && branchId))
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!companyId || !branchId) return
    let cancelled = false
    createLiveBusinessServices(getSupabaseClient()).payslips.finalizedRuns(companyId, branchId)
      .then((value) => { if (!cancelled) setRuns(value) })
      .catch(() => { if (!cancelled) setRuns([]) })
    return () => { cancelled = true }
  }, [companyId, branchId])

  useEffect(() => {
    if (!companyId || !branchId) return
    let cancelled = false
    createLiveStatutoryFilingServices(getSupabaseClient()).list(companyId, branchId, page, PAGE_SIZE)
      .then((result) => { if (!cancelled) { setRecords(result.items); setTotal(result.total) } })
      .catch(() => { if (!cancelled) { setRecords([]); setTotal(0); setError('Statutory filing records are unavailable for your current branch permissions.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, branchId, page, refreshKey])

  const prepare = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!runId || !dueDate) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveStatutoryFilingServices(getSupabaseClient()).prepare(runId, authority, dueDate)
      setPage(1); setRefreshKey((value) => value + 1)
      setNotice(`${authority} filing record created from the selected finalized payroll version. No return was submitted.`)
    } catch { setError('Filing record was not created. Confirm finalized payroll and branch filing permissions.') }
    finally { setBusy(false) }
  }

  const openEdit = (record: StatutoryFilingRecord) => {
    setTarget(record)
    setDraft({
      filingStatus: record.filing_status, submittedAt: record.submitted_at?.slice(0, 10) ?? '', submissionReference: record.submission_reference ?? '',
      remittanceStatus: record.remittance_status, remittedAmount: String(record.remitted_amount),
      remittedAt: record.remitted_at?.slice(0, 10) ?? '', remittanceReference: record.remittance_reference ?? '', note: record.note ?? '',
    })
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!target || !draft) return
    const submittedAt = ['SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(draft.filingStatus) && draft.submittedAt ? `${draft.submittedAt}T12:00:00.000Z` : null
    const remitted = Number(draft.remittedAmount)
    const remittedAt = draft.remittanceStatus === 'UNPAID' || !draft.remittedAt ? null : `${draft.remittedAt}T12:00:00.000Z`
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveStatutoryFilingServices(getSupabaseClient()).update(target.id, {
        filingStatus: draft.filingStatus, submittedAt,
        submissionReference: ['SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(draft.filingStatus) ? draft.submissionReference.trim() || null : null,
        remittanceStatus: draft.remittanceStatus, remittedAmount: Number.isFinite(remitted) ? remitted : 0,
        remittedAt, remittanceReference: draft.remittanceStatus !== 'UNPAID' ? draft.remittanceReference.trim() || null : null,
        note: draft.note.trim() || null,
      })
      setTarget(null); setDraft(null); setRefreshKey((value) => value + 1)
      setNotice(`${target.authority} filing and remittance status updated and audited.`)
    } catch { setError('Filing update failed. Check the filing reference, status and remitted total against the finalized liability.') }
    finally { setBusy(false) }
  }

  const exportCsv = () => {
    if (!records.length) return
    const columns: (keyof StatutoryFilingRecord)[] = ['authority','period_start','period_end','due_date','liability_amount','filing_status','submission_reference','remittance_status','remitted_amount','remittance_reference']
    const text = [columns.map(csv).join(','), ...records.map((record) => columns.map((key) => csv(record[key])).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `statutory-filings-${companyId}-${branchId}-page-${page}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selectedRun = runs.find((run) => run.id === runId)

  useEffect(() => {
    if (authority === 'NAPSA' && selectedRun) {
      setDueDate(napsaRemittanceDeadline(selectedRun.payroll_periods.period_end))
    }
  }, [authority, selectedRun?.payroll_periods.period_end])

  return <div className="live-statutory-workspace">
    <LivePayrollReports mode="statutory" />
    <section className="live-statutory-filings">
      <header className="page-heading"><div><div className="eyebrow">STATUTORY OPERATIONS</div><h1>Filing and remittance tracking</h1><p>Track manual submission and payment evidence against finalized payroll.</p></div></header>
      <div className="live-data-notice"><ShieldCheck size={15}/> Liabilities use the finalized payroll record and cannot be edited here. NAPSA contributions relate to the last day of the payroll month; the 10th of the following month is the remittance deadline. This workspace does not file returns or transfer/remit funds.</div>
      {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
      <section className="panel statutory-filing-filters" aria-label="Statutory filing filters">
        <label>Company<select aria-label="Filing company" value={companyId} onChange={(event) => { const next = companies.find((item) => item.id === event.target.value); setCompanyId(event.target.value); setBranchId(next?.branches[0]?.id ?? ''); setPage(1); setRuns([]); setRecords([]); setError(''); setLoading(Boolean(next?.branches[0])) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Branch<select aria-label="Filing branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPage(1); setRecords([]); setRuns([]); setError(''); setLoading(Boolean(event.target.value)) }} disabled={!company}><option value="">Select branch</option>{company?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <form className="statutory-filing-prepare" onSubmit={(event) => void prepare(event)}>
          <label>Finalized run<select required value={runId} onChange={(event) => setRunId(event.target.value)}><option value="">Select finalized payroll</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.payroll_periods.period_start} · version {run.version}</option>)}</select></label>
          <label>Authority<select value={authority} onChange={(event) => setAuthority(event.target.value as FilingAuthority)}>{authorities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>{authority === 'NAPSA' ? 'Remittance deadline (10th of following month)' : 'Due date from approved calendar'}<input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <button className="button-primary" disabled={busy || !selectedRun || !dueDate}>{busy ? <LoaderCircle size={15}/> : <FileCheck2 size={15}/>} Prepare filing record</button>
        </form>
      </section>
      {selectedRun && <p className="statutory-source-note">Source: finalized payroll {selectedRun.id.slice(0,8)}, version {selectedRun.version}, period {formatWorkspaceDate(`${selectedRun.payroll_periods.period_start}T00:00:00Z`, preferences, { timeZone: 'UTC' })}.</p>}
      <section className="panel statutory-filing-table">
        <header><div><div className="section-eyebrow">AUTHORIZED BRANCH RECORDS</div><h2>Filing register</h2><p>{total.toLocaleString()} records · page {page} of {pageCount}</p></div><button className="button-secondary" disabled={!records.length} onClick={exportCsv}><Download size={14}/> Export current page</button></header>
        {loading ? <div className="statutory-state" role="status"><LoaderCircle size={18}/> Loading filings…</div> : !records.length ? <div className="statutory-state"><FileCheck2 size={20}/><strong>No filings tracked yet</strong><span>Prepare a filing record from a finalized payroll version.</span></div> : <div className="table-scroll"><table><thead><tr><th>PERIOD / AUTHORITY</th><th>DUE</th><th>LIABILITY</th><th>FILING</th><th>REMITTANCE</th><th>REMITTED</th><th/></tr></thead><tbody>{records.map((item) => <tr key={item.id}><td><strong>{item.authority}</strong><small>{item.period_start} – {item.period_end} · v{item.payroll_version}</small></td><td>{formatWorkspaceDate(`${item.due_date}T00:00:00Z`, preferences, { timeZone: 'UTC' })}</td><td>{money(item.liability_amount)}</td><td><span className={`filing-badge filing-${item.filing_status.toLowerCase()}`}>{item.filing_status.replaceAll('_',' ')}</span>{item.submission_reference && <small>{item.submission_reference}</small>}</td><td>{item.remittance_status}</td><td>{money(item.remitted_amount)}{item.remittance_reference && <small>{item.remittance_reference}</small>}</td><td><button className="button-secondary" onClick={() => openEdit(item)}>Update status</button></td></tr>)}</tbody></table></div>}
        <footer><button className="button-secondary" disabled={loading || page<=1} onClick={() => { setLoading(true); setPage((value) => value-1) }}><ChevronLeft size={14}/> Previous</button><span>{total.toLocaleString()} records · page {page}/{pageCount}</span><button className="button-secondary" disabled={loading || page>=pageCount} onClick={() => { setLoading(true); setPage((value) => value+1) }}>Next <ChevronRight size={14}/></button></footer>
      </section>
    </section>
    {target && draft && <div className="filing-dialog-scrim"><form className="panel filing-dialog" role="dialog" aria-modal="true" aria-labelledby="filing-dialog-title" onSubmit={(event) => void save(event)}>
      <header><div><div className="section-eyebrow">MANUAL FILING EVIDENCE</div><h2 id="filing-dialog-title">{target.authority} · {money(target.liability_amount)}</h2><p>Finalized payroll version {target.payroll_version}</p></div><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={() => { setTarget(null); setDraft(null) }}><X size={16}/></button></header>
      <label>Return status<select value={draft.filingStatus} onChange={(event) => setDraft({ ...draft, filingStatus: event.target.value as FilingStatus })}><option value="NOT_STARTED">Not started</option><option value="SUBMITTED">Submitted</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected / returned</option></select></label>
      {['SUBMITTED','ACCEPTED','REJECTED'].includes(draft.filingStatus) && <><label>Submission date<input required type="date" value={draft.submittedAt} onChange={(event) => setDraft({ ...draft, submittedAt: event.target.value })}/></label><label>Submission reference<input required maxLength={160} value={draft.submissionReference} onChange={(event) => setDraft({ ...draft, submissionReference: event.target.value })}/></label></>}
      {draft.filingStatus === 'REJECTED' && <p className="live-error">Add a note explaining the rejection or return.</p>}
      <label>Remittance status<select value={draft.remittanceStatus} onChange={(event) => setDraft({ ...draft, remittanceStatus: event.target.value as RemittanceStatus, remittedAmount: event.target.value === 'PAID' ? String(target.liability_amount) : event.target.value === 'UNPAID' ? '0' : draft.remittedAmount })}><option value="UNPAID">Unpaid</option><option value="PARTIAL">Partially remitted</option><option value="PAID">Paid in full</option></select></label>
      {draft.remittanceStatus !== 'UNPAID' && <><label>Remitted amount (liability {money(target.liability_amount)})<input required type="number" min={target.liability_amount === 0 ? 0 : 0.01} max={target.liability_amount} step="0.01" value={draft.remittedAmount} onChange={(event) => setDraft({ ...draft, remittedAmount: event.target.value })}/></label><label>Remittance date<input required type="date" value={draft.remittedAt} onChange={(event) => setDraft({ ...draft, remittedAt: event.target.value })}/></label><label>Remittance reference<input required maxLength={160} value={draft.remittanceReference} onChange={(event) => setDraft({ ...draft, remittanceReference: event.target.value })}/></label></>}
      <label>Internal note<textarea rows={3} maxLength={1000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })}/></label>
      <p className="filing-dialog-note">Only record a status after checking the authorized external agency or banking channel. This save does not contact the agency or bank.</p>
      <footer><button type="button" className="button-secondary" disabled={busy} onClick={() => { setTarget(null); setDraft(null) }}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save filing status'}</button></footer>
    </form></div>}
  </div>
}
