import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleDollarSign, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { formatWorkspaceDate, useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLivePayoutReconciliationServices, type PayoutReconciliationBatch, type PayoutReconciliationLine, type ReconciliationStatus } from '../../services/live-payout-reconciliation-services'
import './live-payroll-reconciliation.css'

const PAGE_SIZE = 50
const money = (value: number) => `K${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
type EditTarget = { line: PayoutReconciliationLine; batchId: string }

export function LivePayrollReconciliation() {
  const { companies, activeCompanyId, preferences } = useWorkspace()
  const initialCompany = activeCompanyId !== 'all' ? activeCompanyId : companies[0]?.id ?? ''
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompany)
  const effectiveCompanyId = companies.some((item) => item.id === selectedCompanyId) ? selectedCompanyId
    : companies.some((item) => item.id === activeCompanyId) ? activeCompanyId : companies[0]?.id ?? ''
  const company = companies.find((item) => item.id === effectiveCompanyId)
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const effectiveBranchId = company?.branches.some((branch) => branch.id === branchId) ? branchId : company?.branches[0]?.id ?? ''
  const [batches, setBatches] = useState<PayoutReconciliationBatch[]>([])
  const [batchId, setBatchId] = useState('')
  const [items, setItems] = useState<PayoutReconciliationLine[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [target, setTarget] = useState<EditTarget | null>(null)
  const [status, setStatus] = useState<ReconciliationStatus>('PENDING')
  const [paidAmount, setPaidAmount] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selectedBatch = batches.find((batch) => batch.export_id === batchId)
  const [service] = useState(() => createLivePayoutReconciliationServices(getSupabaseClient()))

  const loadBatches = useCallback(async () => {
    if (!effectiveCompanyId || !effectiveBranchId) { setBatches([]); setBatchId(''); setItems([]); setTotal(0); setLoading(false); return }
    setLoading(true); setError('')
    try {
      const result = await service.batches(effectiveCompanyId, effectiveBranchId)
      setBatches(result)
      setBatchId((current) => result.some((batch) => batch.export_id === current) ? current : result[0]?.export_id ?? '')
    } catch { setBatches([]); setBatchId(''); setItems([]); setTotal(0); setError('Payout batches are unavailable under your current payroll permissions.') }
    finally { setLoading(false) }
  }, [effectiveCompanyId, effectiveBranchId, service])
  useEffect(() => { void loadBatches() }, [loadBatches])

  const loadDetail = useCallback(async () => {
    if (!batchId) { setItems([]); setTotal(0); return }
    setLoading(true); setError('')
    try { const result = await service.detail(batchId, page, PAGE_SIZE); setItems(result.items); setTotal(result.total) }
    catch { setItems([]); setTotal(0); setError('Reconciliation details are unavailable for this payout batch.') }
    finally { setLoading(false) }
  }, [batchId, page, service])
  useEffect(() => { void loadDetail() }, [loadDetail])

  const openEdit = (line: PayoutReconciliationLine) => {
    setTarget({ line, batchId })
    setStatus(line.status)
    setPaidAmount(String(line.paid_amount || line.expected_amount))
    setPaidAt(line.paid_at ?? '')
    setReference(line.provider_reference ?? '')
    setNote(line.note ?? '')
    setError(''); setNotice('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!target) return
    setBusy(true); setError(''); setNotice('')
    try {
      await service.save({
        exportId: target.batchId, employeeId: target.line.employee_id, status,
        paidAmount: status === 'PENDING' || status === 'NO_PAYMENT_DUE' || status === 'FAILED' || status === 'RETURNED' ? 0 : Number(paidAmount),
        paidAt: ['PAID', 'PARTIAL'].includes(status) ? paidAt : null,
        providerReference: ['PAID', 'PARTIAL', 'FAILED', 'RETURNED'].includes(status) ? reference.trim() || null : null,
        note: note.trim() || null,
      })
      setTarget(null)
      setNotice('Reconciliation record saved. No transfer was initiated or verified by Golden Baobab HR.')
      await Promise.all([loadBatches(), loadDetail()])
    } catch { setError('Reconciliation was not saved. Check the statement values and your branch payroll permissions.') }
    finally { setBusy(false) }
  }

  const statuses: ReconciliationStatus[] = target?.line.expected_amount === 0
    ? ['PENDING', 'NO_PAYMENT_DUE', 'FAILED', 'RETURNED']
    : ['PENDING', 'PAID', 'PARTIAL', 'FAILED', 'RETURNED']

  return <div className="live-reconciliation-screen">
    <header className="page-heading"><div><div className="eyebrow">PAYROLL OPERATIONS</div><h1>Payout reconciliation</h1><p>Record outcomes after checking a bank or mobile-money statement outside this application.</p></div><button className="button-secondary" onClick={() => void loadBatches()} disabled={loading}><RefreshCw size={14}/> Refresh</button></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> This screen records reconciliation evidence only. It does not send money, connect to a provider, or independently verify provider references. Access requires payroll finalization permission for the selected branch.</div>
    {error && <p className="live-error" role="alert">{error}</p>}{notice && <p className="live-notice" role="status">{notice}</p>}
    <section className="panel live-reconciliation-filters">
      <label>Company<select aria-label="Reconciliation company" value={effectiveCompanyId} onChange={(event) => { setSelectedCompanyId(event.target.value); setBranchId(''); setBatchId(''); setPage(1) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Branch<select aria-label="Reconciliation branch" value={effectiveBranchId} onChange={(event) => { setBranchId(event.target.value); setBatchId(''); setPage(1) }} disabled={!company}><option value="">Select branch</option>{company?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Payout instruction batch<select aria-label="Payout batch" value={batchId} onChange={(event) => { setBatchId(event.target.value); setPage(1) }} disabled={!batches.length}><option value="">Select a prepared batch</option>{batches.map((item) => <option key={item.export_id} value={item.export_id}>{formatWorkspaceDate(item.created_at, preferences)} · {item.instruction_count} recipients · v{item.payroll_version}</option>)}</select></label>
    </section>
    {selectedBatch && <section className="live-reconciliation-summary panel"><div><span>Expected batch value</span><strong>{money(selectedBatch.expected_total)}</strong></div><div><span>Recipients reconciled</span><strong>{selectedBatch.reconciled_count}/{selectedBatch.instruction_count}</strong></div><div><span>Paid</span><strong>{selectedBatch.paid_count}</strong></div><div><span>Partial / failed / returned</span><strong>{selectedBatch.partial_count} / {selectedBatch.failed_count} / {selectedBatch.returned_count}</strong></div><small>Manifest {selectedBatch.manifest_sha256.slice(0, 16)}… · payout instructions remain unchanged</small></section>}
    <section className="panel live-reconciliation-table"><div className="table-scroll"><table><thead><tr><th>EMPLOYEE</th><th>EXPECTED</th><th>OUTCOME</th><th>PAID</th><th>REFERENCE</th><th>UPDATED</th><th/></tr></thead><tbody>{items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number}</small></td><td>{money(item.expected_amount)}</td><td><span className={`reconciliation-status reconciliation-${item.status.toLowerCase().replaceAll('_','-')}`}>{item.status.replaceAll('_',' ')}</span></td><td>{money(item.paid_amount)}</td><td>{item.provider_reference ?? '—'}</td><td>{item.reconciled_at ? formatWorkspaceDate(item.reconciled_at, preferences) : '—'}</td><td><button className="button-secondary" disabled={busy} onClick={() => openEdit(item)}>{item.status === 'PENDING' ? 'Record outcome' : 'Update outcome'}</button></td></tr>)}</tbody></table></div>
      {loading && <p className="live-reconciliation-empty" role="status">Loading authorized payout records…</p>}
      {!loading && !items.length && <div className="live-reconciliation-empty"><CircleDollarSign size={20}/><strong>{batches.length ? 'No recipients in this batch' : 'No payout batches found'}</strong><span>Finalize a payroll run and prepare payout instructions before reconciliation.</span></div>}
      <footer><span>{total} payout recipients · page {page} of {pageCount}</span><div><button className="button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14}/> Previous</button><button className="button-secondary" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={14}/></button></div></footer>
    </section>
    {target && <div className="reconciliation-modal-scrim"><form className="panel reconciliation-modal" role="dialog" aria-modal="true" aria-labelledby="reconciliation-dialog-title" onSubmit={(event) => void submit(event)}><header><div><div className="section-eyebrow">STATEMENT RECONCILIATION</div><h2 id="reconciliation-dialog-title">{target.line.employee_name}</h2><p>{target.line.employee_number} · expected {money(target.line.expected_amount)}</p></div><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={() => setTarget(null)}><X size={16}/></button></header>
      <label>Statement outcome<select value={status} onChange={(event) => setStatus(event.target.value as ReconciliationStatus)}>{statuses.map((value) => <option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
      {['PAID','PARTIAL'].includes(status) && <><label>Amount shown as paid<input type="number" min="0.01" max={target.line.expected_amount} step="0.01" required value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)}/></label><label>Payment date<input type="date" required value={paidAt} onChange={(event) => setPaidAt(event.target.value)}/></label></>}
      {['PAID','PARTIAL','FAILED','RETURNED'].includes(status) && <label>Provider statement reference<input required={status === 'PAID' || status === 'PARTIAL'} maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></label>}
      <label>Internal note<textarea maxLength={1000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <p className="reconciliation-modal-note">Only enter a reference after checking the statement through your approved banking channel. Account numbers are not stored in this reconciliation record.</p>
      <footer><button type="button" className="button-secondary" disabled={busy} onClick={() => setTarget(null)}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? 'Saving…' : <><Check size={14}/> Save reconciliation</>}</button></footer>
    </form></div>}
  </div>
}
