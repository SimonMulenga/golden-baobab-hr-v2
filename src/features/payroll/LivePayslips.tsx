import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, Mail, Printer, RefreshCw, ShieldCheck } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord, type FinalizedPayslipItemRecord, type FinalizedPayslipRunRecord } from '../../services/live-business-services'
import { formatWorkspaceDate, useWorkspace } from '../companies/WorkspaceContext'
import { buildPayslipView } from './payslip-model'
import './live-payslips.css'

const money = (value: number) => `K${value.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const period = (run: FinalizedPayslipRunRecord, preferences?: ReturnType<typeof useWorkspace>['preferences']) => formatWorkspaceDate(`${run.payroll_periods.period_start}T00:00:00Z`, preferences, { month: 'long', year: 'numeric', timeZone: 'UTC' })

export function LivePayslips() {
  const { companies, activeCompanyId, preferences } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState('all')
  const [runs, setRuns] = useState<FinalizedPayslipRunRecord[]>([])
  const [runId, setRunId] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<FinalizedPayslipItemRecord[]>([])
  const [total, setTotal] = useState(0)
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [artifactId, setArtifactId] = useState('')
  const [artifactOwner, setArtifactOwner] = useState('')
  const [signedUrl, setSignedUrl] = useState('')
  const [deliveryRows, setDeliveryRows] = useState<Array<{ id: string; status: string; attempts: number; last_error_code: string | null; created_at: string; updated_at: string; sent_at: string | null }>>([])
  const [artifactBusy, setArtifactBusy] = useState(false)
  const [deliveryClock, setDeliveryClock] = useState(0)
  const selectedRun = runs.find((run) => run.id === runId)
  const selectedRunId = selectedRun?.id
  const selectedRunVersion = selectedRun?.version
  const selectedEmployee = employees.find((employee) => employee.id === employeeId)
  const selectedItem = items.find((item) => item.employee_id === employeeId)
  const currentArtifactId = artifactOwner === `${selectedRunId ?? ''}:${selectedItem?.employee_id ?? ''}` ? artifactId : ''
  const model = useMemo(() => selectedRun && selectedItem && selectedEmployee && company
    ? buildPayslipView({ company, branch: company.branches.find((branch) => branch.id === selectedRun.branch_id), employee: selectedEmployee, run: selectedRun, item: selectedItem })
    : null, [selectedRun, selectedItem, selectedEmployee, company])
  const api = () => createLiveBusinessServices(getSupabaseClient())

  useEffect(() => {
    const timer = window.setInterval(() => setDeliveryClock(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    api().payslips.finalizedRuns(companyId, branchId === 'all' ? undefined : branchId)
      .then((result) => { if (!cancelled) { setError(''); setRuns(result); setLoadingItems(Boolean(result[0])); setRunId(result[0]?.id ?? '') } })
      .catch(() => { if (!cancelled) { setRuns([]); setError('Finalized payroll records could not be loaded for this company and access scope.') } })
      .finally(() => { if (!cancelled) setLoadingRuns(false) })
    return () => { cancelled = true }
  }, [companyId, branchId])

  useEffect(() => {
    if (!selectedRunId || selectedRunVersion == null) return
    let cancelled = false
    api().payslips.finalizedItems(selectedRunId, selectedRunVersion, page)
      .then(async (result) => {
        const employeeRows = await api().employees.byIds(result.items.map((item) => item.employee_id))
        if (cancelled) return
        setItems(result.items); setTotal(result.total); setEmployees(employeeRows); setEmployeeId(result.items[0]?.employee_id ?? '')
      })
      .catch(() => { if (!cancelled) setError('Finalized payslip lines are unavailable under the current payroll and employee permissions.') })
      .finally(() => { if (!cancelled) setLoadingItems(false) })
    return () => { cancelled = true }
  }, [selectedRunId, selectedRunVersion, page])

  const pageCount = Math.max(1, Math.ceil(total / 100))
  const print = () => { if (model) { setNotice('Use your browser print dialog to save a local copy. Secure issuance and delivery are separately audited actions.'); window.print() } }
  const issueSecurePdf = async () => {
    if (!selectedRun || !selectedItem) return
    setArtifactBusy(true); setError(''); setNotice('')
    try {
      const result = await api().payslips.issueDocument(selectedRun.id, selectedItem.employee_id)
      setArtifactId(result.documentId); setArtifactOwner(`${selectedRun.id}:${selectedItem.employee_id}`); setSignedUrl(result.signedUrl)
      setNotice('Generated from the finalized payroll snapshot. The private download link expires after 60 seconds.')
      try { setDeliveryRows(await api().payslips.deliveryHistory(result.documentId)) } catch { setDeliveryRows([]) }
    } catch { setError('The secure payslip could not be issued. Confirm payroll issuance permission and that this run remains finalized.') }
    finally { setArtifactBusy(false) }
  }
  const refreshSecureLink = async () => {
    if (!currentArtifactId) return
    setArtifactBusy(true); setError('')
    try { const result = await api().payslips.downloadDocument(currentArtifactId); setSignedUrl(result.signedUrl) }
    catch { setError('A secure download link could not be created under your current access scope.') }
    finally { setArtifactBusy(false) }
  }
  const sendSecureEmail = async () => {
    if (!currentArtifactId) return
    setArtifactBusy(true); setError(''); setNotice('')
    try {
      const result = await api().payslips.sendEmail(currentArtifactId)
      setNotice(result.status === 'SENT' ? 'The configured email provider accepted the delivery request.' : 'Delivery is recorded as queued. Provider settings and the recipient allowlist determine whether it can be sent.')
      setDeliveryRows(await api().payslips.deliveryHistory(currentArtifactId))
    } catch {
      setError('Delivery could not be queued. Check payroll issuance permissions and the employee delivery address.')
      try { setDeliveryRows(await api().payslips.deliveryHistory(currentArtifactId)) } catch { /* RLS may hide delivery history from a viewer without issuer rights. */ }
    }
    finally { setArtifactBusy(false) }
  }
  const retrySecureEmail = async (deliveryId: string) => {
    setArtifactBusy(true); setError(''); setNotice('')
    try {
      const result = await api().payslips.retryEmail(deliveryId)
      setNotice(result.status === 'SENT' ? 'The configured email provider accepted the retry.' : 'The delivery retry is queued or still processing.')
      if (currentArtifactId) setDeliveryRows(await api().payslips.deliveryHistory(currentArtifactId))
    } catch {
      setError('This delivery cannot be retried. It may have reached the attempt limit or may not be failed.')
      if (currentArtifactId) try { setDeliveryRows(await api().payslips.deliveryHistory(currentArtifactId)) } catch { /* Keep the failure generic when history is not visible. */ }
    }
    finally { setArtifactBusy(false) }
  }

  return <div className="live-payslips">
    <header className="page-heading"><div><div className="eyebrow">FINALIZED PAYROLL RECORDS</div><h1>Payslips</h1><p>View and print payslips from immutable finalized payroll lines.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> Payslip details are read through payroll and employee row-level permissions. Figures come from the finalized run version; this screen does not recalculate payroll.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-payslip-notice" role="status">{notice}</div>}
    <section className="panel live-payslip-filters" aria-label="Payslip filters">
      <label>Company<select aria-label="Payslip company" value={companyId} onChange={(event) => { setLoadingRuns(Boolean(event.target.value)); setLoadingItems(false); setRuns([]); setRunId(''); setItems([]); setEmployees([]); setCompanyId(event.target.value); setPage(1) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Branch<select aria-label="Payslip branch" value={branchId} onChange={(event) => { setLoadingRuns(true); setLoadingItems(false); setRuns([]); setRunId(''); setItems([]); setEmployees([]); setBranchId(event.target.value); setPage(1) }}><option value="all">All authorized branches</option>{company?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Finalized payroll<select aria-label="Finalized payroll run" value={runId} onChange={(event) => { setLoadingItems(Boolean(event.target.value)); setItems([]); setEmployees([]); setRunId(event.target.value); setPage(1) }}><option value="">Select a finalized run</option>{runs.map((run) => <option value={run.id} key={run.id}>{period(run, preferences)} · {company?.branches.find((branch) => branch.id === run.branch_id)?.name ?? 'Branch'} · v{run.version}</option>)}</select></label>
      <label>Employee<select aria-label="Payslip employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} disabled={!items.length}><option value="">Select employee on this page</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_number} · {employee.first_name} {employee.last_name}</option>)}</select></label>
    </section>
    {loadingRuns || loadingItems ? <div className="panel live-payslip-state" role="status"><LoaderCircle size={18}/> Loading authorized finalized records…</div>
      : !runs.length ? <div className="panel live-payslip-state"><FileText size={22}/><strong>No finalized payroll found</strong><span>Only payroll runs finalized in Supabase appear here.</span></div>
        : !model ? <div className="panel live-payslip-state"><FileText size={22}/><strong>Select an employee</strong><span>{total.toLocaleString()} finalized payslip records · 100 employees per page.</span><div className="live-payslip-pagination"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15}/> Previous</button><span>Page {page} of {pageCount}</span><button className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={15}/></button></div></div>
          : <>
            <div className="live-payslip-actions"><span>{total.toLocaleString()} employees in finalized {period(selectedRun!, preferences)} payroll · page {page}/{pageCount}</span><div className="live-payslip-pagination"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15}/> Previous</button><button className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={15}/></button><button className="button-secondary" onClick={print}><Printer size={15}/> Print / save as PDF</button><button className="button-primary" disabled={artifactBusy} onClick={() => void issueSecurePdf()}>{artifactBusy ? <LoaderCircle size={15}/> : <FileText size={15}/>} Generate secure PDF</button></div></div>
            {currentArtifactId && <section className="panel live-payslip-delivery" aria-label="Payslip document and delivery">
              <div><strong>Private finalized payslip PDF</strong><p>Generated from run {selectedRun?.id.slice(0, 8)} version {selectedRun?.version}. Signed links expire after 60 seconds.</p></div>
              <div className="live-payslip-pagination"><button className="button-secondary" onClick={() => void refreshSecureLink()} disabled={artifactBusy}><RefreshCw size={15}/> Refresh link</button>{signedUrl && <a className="button-primary" href={signedUrl} target="_blank" rel="noreferrer"><Download size={15}/> Download PDF</a>}<button className="button-secondary" onClick={() => void sendSecureEmail()} disabled={artifactBusy}><Mail size={15}/> Queue email</button></div>
              <div className="live-payslip-delivery-history"><strong>Delivery history</strong>{deliveryRows.length ? deliveryRows.map((delivery) => { const stale = delivery.status === 'SENDING' && deliveryClock > 0 && deliveryClock - Date.parse(delivery.updated_at) > 10 * 60_000; const retryable = delivery.attempts < 3 && (delivery.status === 'FAILED' || stale); return <div key={delivery.id}><span>{delivery.status}{stale ? ' · stale claim' : ''} · {delivery.attempts}/3 attempts</span><span>{delivery.last_error_code || (delivery.sent_at ? 'Provider accepted' : 'Recorded')}</span>{retryable && <button className="button-secondary" disabled={artifactBusy} onClick={() => void retrySecureEmail(delivery.id)}>Retry</button>}</div> }) : <p>No delivery recorded. History requires payroll issuance access.</p>}</div>
            </section>}
            <article className="panel live-payslip-document" aria-label={`Payslip for ${model.employeeName}`}>
              <header className="live-payslip-company"><div className="live-payslip-mark">{model.companyMark}</div><div><h2>{model.companyName}</h2><p>{model.companyAddress}</p></div><span className="live-payslip-reference">{model.reference}</span></header>
              <div className="live-payslip-title"><div><div className="section-eyebrow">SALARY STATEMENT</div><h1>{model.periodLabel} payslip</h1></div><span>FINALIZED</span></div>
              <dl className="live-payslip-employee"><div><dt>Employee</dt><dd>{model.employeeName}</dd></div><div><dt>Employee number</dt><dd>{model.employeeNumber}</dd></div><div><dt>Job title</dt><dd>{model.jobTitle}</dd></div><div><dt>Department</dt><dd>{model.department}</dd></div><div><dt>Branch</dt><dd>{model.branchName}</dd></div></dl>
              <div className="live-payslip-columns"><section><h3>Earnings</h3><table><tbody>{model.earnings.map((line, index) => <tr className={line.memoOnly ? 'memo-line' : ''} key={`${line.label}-${index}`}><td>{line.label}<small>{line.detail}</small></td><td>{line.memoOnly ? `(${money(Math.abs(line.amount))})` : money(line.amount)}</td></tr>)}</tbody><tfoot><tr><th>Total earnings</th><th>{money(model.gross)}</th></tr></tfoot></table></section><section><h3>Deductions</h3><table><tbody>{model.deductions.map((line, index) => <tr key={`${line.label}-${index}`}><td>{line.label}<small>{line.detail}</small></td><td>{money(line.amount)}</td></tr>)}</tbody><tfoot><tr><th>Total deductions</th><th>{money(model.totalDeductions)}</th></tr></tfoot></table></section></div>
              <footer className="live-payslip-net"><span>Net salary</span><strong>{money(model.net)}</strong></footer>
              <p className="live-payslip-footnote">This payslip reflects payroll version {selectedRun?.version} after finalization. It is not a bank transfer confirmation.</p>
            </article>
            <div className="live-payslip-note">The GB mark uses a company wordmark because a logo file is not currently stored. Email remains queued unless the server provider and explicit recipient allowlist are configured.</div>
          </>}
  </div>
}
