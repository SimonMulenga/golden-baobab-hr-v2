import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Download, History, Search, ShieldCheck, Upload, X } from 'lucide-react'
import { formatWorkspaceDate, formatWorkspaceDateTime, useWorkspace } from '../companies/WorkspaceContext'
import type { WorkspaceRole } from '../auth/workspace-access'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeChangeCapabilities, type EmployeeChangeRequestRecord, type EmployeeDirectoryRecord, type EmployeeLifecycleAction, type EmployeeLifecycleCapabilities, type EmployeeLifecycleRequestRecord, type EmployeeReviewDecision, type EmploymentHistoryRecord } from '../../services/live-business-services'
import { createLiveHrServices, type DepartmentRecord, type EmployeeDocumentRecord } from '../../services/live-hr-services'
import { downloadEmployeeTemplate } from './employee-import-template'
import { createEmployeeImportStagingService, type StagingRecord } from './employee-import-staging-service'
import { validateStagedEmployee } from './employee-import-staging'
import { LiveEmployeeImportStaging } from './LiveEmployeeImportStaging'
import { RowActionsMenu } from '../../components/RowActionsMenu'
import './live-employee-screens.css'
import './live-employee-ui.css'
import '../../module-modernization.css'

const PAGE_SIZE = 25

export function LiveEmployeeLifecycleReport() {
  const { companies, activeCompanyId } = useWorkspace()
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [status, setStatus] = useState('')
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [records, setRecords] = useState<EmployeeDirectoryRecord[]>([])
  const [movements, setMovements] = useState<Awaited<ReturnType<ReturnType<typeof createLiveBusinessServices>['employees']['lifecycleMovements']>>['items']>([])
  const [departmentOptions, setDepartmentOptions] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const companyId = activeCompanyId === 'all' ? undefined : activeCompanyId
  const scopedCompanies = useMemo(() => companyId ? companies.filter((item) => item.id === companyId) : companies, [companyId, companies])
  const branchOptions = scopedCompanies.flatMap((company) => company.branches.filter((branch) => branch.status === 'Active').map((branch) => ({ id: branch.id, label: `${company.name} · ${branch.name}` })))
  useEffect(() => {
    let active = true
    const catalog = createLiveHrServices(getSupabaseClient()).catalog
    void Promise.all(scopedCompanies.map(async (company) => {
      try { return (await catalog.departments(company.id)).filter((item) => item.status === 'ACTIVE').map((item) => ({ id: item.id, label: `${company.name} · ${item.name}` })) }
      catch { return [] }
    })).then((options) => { if (active) setDepartmentOptions(options.flat()) })
    return () => { active = false }
  }, [scopedCompanies])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const service = createLiveBusinessServices(getSupabaseClient()).employees
      const [nextSummary, nextRows, nextMovements] = await Promise.all([
        service.lifecycleSummary(companyId, branchId || undefined),
        service.list({ page: 1, pageSize: 100, ...(companyId ? { companyId } : {}), ...(branchId ? { branchId } : {}), ...(departmentId ? { departmentId } : {}), ...(status ? { lifecycleStatus: status } : {}) }),
        service.lifecycleMovements({ page: 1, pageSize: 100, ...(companyId ? { companyId } : {}), ...(branchId ? { branchId } : {}), ...(departmentId ? { departmentId } : {}), ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) }),
      ])
      setSummary(nextSummary); setRecords(nextRows.items); setMovements(nextMovements.items)
    } catch { setError('Lifecycle data could not be loaded for your authorized scope.') }
    finally { setLoading(false) }
  }, [companyId, branchId, departmentId, dateFrom, dateTo, status])
  useEffect(() => { void load() }, [load])
  const cards = [['Active', 'active'], ['Suspended', 'suspended'], ['Separated', 'separated'], ['Terminated', 'terminated'], ['Expired contracts', 'contract_expired'], ['Expiring in 60 days', 'upcoming_expiry'], ['Settlements to review', 'final_settlement_review']]
  return <div className="employee-screen"><section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> PEOPLE OPERATIONS</div><h1>Employment lifecycle</h1><p>Current employment status, contract dates and movement records in your authorized scope.</p></div><Link className="button-secondary" to="/employees">Employee directory</Link></section>
    {error && <div className="auth-shell-error" role="alert">{error}<button className="button-secondary" onClick={() => void load()}>Retry</button></div>}
    <section className="metrics-grid lifecycle-metrics" aria-label="Lifecycle summary">{cards.map(([label, key]) => <article className="metric-card" key={key}><div className="metric-label">{label}</div><div className="metric-value">{loading ? '—' : summary?.[key] ?? 0}</div></article>)}</section>
    <section className="panel employee-directory-panel"><div className="employee-toolbar lifecycle-report-filters"><div><strong>Employee lifecycle records</strong><small>Expired contracts are flagged for review and are not treated as termination.</small></div><label className="employee-department-filter"><span>Employment status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All employees</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="SEPARATED">Separated</option><option value="TERMINATED">Terminated</option><option value="CONTRACT_EXPIRED">Contract expired</option></select></label><label className="employee-department-filter"><span>Branch</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All authorized branches</option>{branchOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="employee-department-filter"><span>Department</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">All departments</option>{departmentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
      {loading ? <div className="employee-empty" role="status">Loading lifecycle records…</div> : records.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>Employee</th><th>Company</th><th>Contract</th><th>Lifecycle status</th><th>Details</th></tr></thead><tbody>{records.map((record) => { const company = companies.find((item) => item.id === record.company_id); const label = record.contract_expired ? 'CONTRACT EXPIRED' : (record.lifecycle_status ?? record.employment_status).replaceAll('_', ' '); return <tr key={record.id}><td><strong>{record.first_name} {record.last_name}</strong><small>{record.employee_number}</small></td><td>{company?.name ?? 'Authorized company'}</td><td>{record.contract_start_date} – {record.contract_end_date ?? 'Open-ended'}</td><td><span className={`approval-status status-${label.toLowerCase().replaceAll(' ', '-')}`}>{label}</span></td><td><Link className="button-secondary" to={`/employees/${record.id}`}>View history</Link></td></tr> })}</tbody></table></div> : <div className="employee-empty">No employees match this lifecycle filter.</div>}
    </section>
    <section className="panel employee-directory-panel lifecycle-movement-panel"><div className="employee-toolbar"><div><strong>Employee movement history</strong><small>Effective-dated requests and review outcomes; no private employee or compensation data.</small></div><label className="employee-date-filter"><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label className="employee-date-filter"><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button className="button-secondary" onClick={() => void load()}>Apply dates</button></div>{loading ? <div className="employee-empty" role="status">Loading movement history…</div> : movements.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>Effective</th><th>Employee</th><th>Company / Branch</th><th>Department</th><th>Action</th><th>Review status</th><th>Reason</th></tr></thead><tbody>{movements.map((movement) => { const company = companies.find((item) => item.id === movement.company_id); const branch = company?.branches.find((item) => item.id === movement.branch_id); return <tr key={movement.request_id}><td>{movement.effective_date}</td><td><strong>{movement.employee_name}</strong><small>{movement.employee_number}</small></td><td>{company?.name ?? 'Authorized company'}<small>{branch?.name ?? 'Authorized branch'}</small></td><td>{movement.department}</td><td>{movement.action.replaceAll('_', ' ')}</td><td><span className={`approval-status status-${movement.status.toLowerCase()}`}>{movement.status.replaceAll('_', ' ')}</span></td><td>{movement.reason}</td></tr> })}</tbody></table></div> : <div className="employee-empty">No lifecycle movements match this date and organization scope.</div>}</section>
  </div>
}

export function LiveEmployeeDirectory() {
  const { companies } = useWorkspace()
  const navigate = useNavigate()
  const [records, setRecords] = useState<EmployeeDirectoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [lifecycleStatus, setLifecycleStatus] = useState('')
  const [departmentOptions, setDepartmentOptions] = useState<{ id: string; label: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestGeneration = useRef(0)

  useEffect(() => {
    let active = true
    const service = createLiveHrServices(getSupabaseClient()).catalog
    void Promise.all(companies.map(async (company) => {
      try { return (await service.departments(company.id)).map((department) => ({ id: department.id, label: `${company.name} · ${department.name}` })) }
      catch { return [] }
    })).then((options) => { if (active) setDepartmentOptions(options.flat()) })
    return () => { active = false }
  }, [companies])

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).employees.list({ page, pageSize: PAGE_SIZE, search, ...(departmentId ? { departmentId } : {}), ...(lifecycleStatus ? { lifecycleStatus } : {}) })
      if (generation !== requestGeneration.current) return
      setRecords(result.items)
      setTotal(result.total)
    } catch {
      if (generation === requestGeneration.current) setError('Employee records could not be loaded. Check your access and try again.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [page, search, departmentId, lifecycleStatus])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); requestGeneration.current += 1 } }, [load])

  return <div className="employee-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> PEOPLE DIRECTORY</div><h1>Employees</h1><p>Employee records available to your account.</p></div><div className="live-employee-actions"><button className="button-secondary" type="button" onClick={downloadEmployeeTemplate}><Download size={15}/> Employee Template</button><Link className="button-secondary" to="/employee-approvals">Review submissions</Link><Link className="button-secondary" to="/employees/import"><Upload size={15}/> Bulk Upload Employees</Link><Link className="button-primary" to="/employees/new">Add employee</Link></div></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Personal identity, contact, banking, and compensation details are not included in this directory view.</div>
    <div className="live-employee-actions"><Link className="button-secondary" to="/employees/lifecycle">Employment lifecycle report</Link></div>
    <section className="panel employee-directory-panel">
      <div className="employee-toolbar"><div><strong>{total} employees</strong><small>Current employee records in your authorized scope</small></div><label className="employee-department-filter"><span>Department</span><select aria-label="Filter employees by department" value={departmentId} onChange={(event) => { setLoading(true); setError(''); setDepartmentId(event.target.value); setPage(1) }}><option value="">All departments</option>{departmentOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label className="employee-department-filter"><span>Employment status</span><select aria-label="Filter employees by lifecycle status" value={lifecycleStatus} onChange={(event) => { setLoading(true); setError(''); setLifecycleStatus(event.target.value); setPage(1) }}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="SEPARATED">Separated</option><option value="TERMINATED">Terminated</option><option value="CONTRACT_EXPIRED">Contract expired</option></select></label><label className="employee-search"><Search size={15}/><input value={search} onChange={(event) => { setLoading(true); setError(''); setSearch(event.target.value); setPage(1) }} placeholder="Search last name..." aria-label="Search employees"/></label></div>
      {error && <div className="auth-shell-error" role="alert">{error} <button className="button-secondary" onClick={() => { setLoading(true); setError(''); void load() }}>Retry</button></div>}
      {loading ? <div className="employee-empty" role="status">Loading employee records…</div> : records.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>ROLE</th><th>CONTRACT</th><th>STATUS</th><th>Actions</th></tr></thead><tbody>{records.map((record) => {
        const company = companies.find((item) => item.id === record.company_id)
        const branch = company?.branches.find((item) => item.id === record.workplace_branch_id)
        const status = record.contract_expired ? 'CONTRACT EXPIRED' : (record.lifecycle_status ?? record.employment_status).replaceAll('_', ' ')
        const lifecycle = record.lifecycle_status ?? record.employment_status
        const actions = [
          { label: 'View Employee', onSelect: () => navigate(`/employees/${record.id}`) },
          { label: 'Edit Employee', onSelect: () => navigate(`/employees/${record.id}`) },
          { label: 'View Employment History', onSelect: () => navigate(`/employees/${record.id}#employment-history`) },
          ...(record.can_manage_lifecycle && lifecycle === 'ACTIVE' ? [
            { label: 'Suspend Employee', onSelect: () => navigate(`/employees/${record.id}?lifecycle=SUSPENSION`) },
            { label: 'Separate Employee', onSelect: () => navigate(`/employees/${record.id}?lifecycle=SEPARATION`) },
            { label: 'Terminate Employment', onSelect: () => navigate(`/employees/${record.id}?lifecycle=TERMINATION`) },
          ] : []),
          ...(record.can_manage_lifecycle && lifecycle === 'SUSPENDED' ? [
            { label: 'Lift Suspension', onSelect: () => navigate(`/employees/${record.id}?lifecycle=SUSPENSION_LIFTED`) },
            { label: 'Separate Employee', onSelect: () => navigate(`/employees/${record.id}?lifecycle=SEPARATION`) },
            { label: 'Terminate Employment', onSelect: () => navigate(`/employees/${record.id}?lifecycle=TERMINATION`) },
          ] : []),
          ...(record.can_manage_lifecycle && ['SEPARATED', 'TERMINATED'].includes(lifecycle) ? [
            { label: 'Reactivate Employee', onSelect: () => navigate(`/employees/${record.id}?lifecycle=REACTIVATION`) },
          ] : []),
          ...(record.can_manage_lifecycle && record.contract_expired ? [
            { label: 'Review Contract Expiry', onSelect: () => navigate(`/employees/${record.id}?lifecycle=CONTRACT_RENEWAL`) },
          ] : []),
        ]
        return <tr key={record.id}><td><Link className="employee-profile-link" to={`/employees/${record.id}`}><strong>{record.first_name} {record.middle_name ? `${record.middle_name} ` : ''}{record.last_name}</strong><small>{record.employee_number}</small></Link></td><td><strong>{company?.name ?? 'Company unavailable'}</strong><small>{branch?.name ?? 'Branch unavailable'}</small></td><td><strong>{record.job_title}</strong><small>{record.department}</small></td><td><strong>{record.employment_type}</strong><small>{record.contract_type}</small></td><td><span className={`approval-status status-${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>{['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(record.approval_status) && <Link className="employee-correction-link" to={`/employees/${record.id}/correct`}>{record.approval_status === 'DRAFT' ? 'Edit draft' : 'Correct and resubmit'}</Link>}</td><td><RowActionsMenu label={`${record.employee_number} employee actions`} actions={actions}/></td></tr>
      })}</tbody></table></div> : <div className="employee-empty"><strong>No employee records found</strong><span>Records appear here after a permitted onboarding workflow stores them.</span></div>}
      <footer className="employee-pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div><button className="button-secondary" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}><ChevronLeft size={15}/></button><button className="button-secondary" aria-label="Next page" disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}><ChevronRight size={15}/></button></div></footer>
    </section>
  </div>
}

export function LiveEmployeeProfile() {
  const { employeeId = '' } = useParams<{ employeeId: string }>()
  const [searchParams] = useSearchParams()
  const { companies, preferences } = useWorkspace()
  const [loadedProfile, setLoadedProfile] = useState<{ id: string; employee: EmployeeDirectoryRecord; history: Awaited<ReturnType<ReturnType<typeof createLiveBusinessServices>['employees']['history']>>; employmentHistory: EmploymentHistoryRecord[] } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    let active = true
    const service = createLiveBusinessServices(getSupabaseClient()).employees
    void Promise.all([service.byId(employeeId), service.history(employeeId), service.employmentHistory(employeeId)])
      .then(([record, events, employmentHistory]) => { if (active) setLoadedProfile({ id: employeeId, employee: record, history: events, employmentHistory }) })
      .catch(() => { if (active) setLoadFailure({ id: employeeId, message: 'This employee profile or its history is unavailable under your current company and branch access.' }) })
    return () => { active = false }
  }, [employeeId])

  const loading = loadedProfile?.id !== employeeId && loadFailure?.id !== employeeId
  if (loading) return <section className="panel employee-empty" role="status">Loading employee profile…</section>
  if (loadFailure?.id === employeeId || loadedProfile?.id !== employeeId) return <div className="employee-screen"><div className="auth-shell-error" role="alert">{loadFailure?.id === employeeId ? loadFailure.message : 'Employee profile could not be found.'}</div><Link className="button-secondary" to="/employees">Return to employee directory</Link></div>

  const { employee, history, employmentHistory } = loadedProfile

  const company = companies.find((item) => item.id === employee.company_id)
  const branch = company?.branches.find((item) => item.id === employee.workplace_branch_id)
  return <div className="employee-screen"><section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> AUTHORIZED EMPLOYEE RECORD</div><h1>{employee.first_name} {employee.middle_name ? `${employee.middle_name} ` : ''}{employee.last_name}</h1><p>{employee.employee_number} · {employee.job_title} · {employee.department}</p></div><div className="live-employee-actions"><Link className="button-secondary" to="/employees">Directory</Link>{['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(employee.approval_status) && <Link className="button-primary" to={`/employees/${employee.id}/correct`}>{employee.approval_status === 'DRAFT' ? 'Edit draft' : 'Correct and resubmit'}</Link>}</div></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Private identifiers, banking details and compensation are available only in their designated secure workflows.</div>
    <section className="employee-profile-grid"><article className="panel employee-profile-card"><div className="section-eyebrow">EMPLOYMENT</div><dl><div><dt>Company</dt><dd>{company?.name ?? 'Company unavailable'}</dd></div><div><dt>Workplace branch</dt><dd>{branch?.name ?? 'Branch unavailable'}</dd></div><div><dt>Employee number</dt><dd>{employee.employee_number}</dd></div><div><dt>Position</dt><dd>{employee.job_title}</dd></div><div><dt>Department</dt><dd>{employee.department}</dd></div><div><dt>Employment type</dt><dd>{employee.employment_type.replaceAll('_', ' ')}</dd></div><div><dt>Contract type</dt><dd>{employee.contract_type}</dd></div><div><dt>Start date</dt><dd>{formatWorkspaceDate(employee.contract_start_date, preferences)}</dd></div><div><dt>Contract end</dt><dd>{employee.contract_end_date ? formatWorkspaceDate(employee.contract_end_date, preferences) : 'Not specified'}</dd></div><div><dt>Approval workflow</dt><dd><span className={`approval-status status-${employee.approval_status.toLowerCase().replaceAll('_', '-')}`}>{employee.approval_status.replaceAll('_', ' ')}</span></dd></div><div><dt>Employment status</dt><dd><span className={`approval-status status-${employee.employment_status.toLowerCase()}`}>{employee.employment_status}</span></dd></div><div><dt>Retirement age setting</dt><dd>{employee.retirement_age} years · {employee.retirement_status.replaceAll('_', ' ')}</dd></div><div><dt>Record created</dt><dd>{formatWorkspaceDateTime(employee.created_at, preferences)}</dd></div></dl>
      {employmentHistory.length > 0 && <div id="employment-history" className="employee-history-card"><header><div className="section-eyebrow">EMPLOYMENT STATUS HISTORY</div></header><ol>{employmentHistory.map((event) => <li key={event.id}><span className="employee-history-dot"/><div><strong>{event.action?.replaceAll('_', ' ') ?? `${event.previous_status} → ${event.new_status}`}</strong><small>{formatWorkspaceDate(event.effective_date ?? event.occurred_at, preferences)} · recorded {formatWorkspaceDateTime(event.occurred_at, preferences)}</small><p>{event.reason}</p></div></li>)}</ol></div>}
      </article><article className="panel employee-history-card"><header><div className="section-eyebrow">REVIEW AND CHANGE HISTORY</div><History size={18}/></header>{history.length ? <ol>{history.map((event) => <li key={event.id}><span className="employee-history-dot"/><div><strong>{event.action.replaceAll('_', ' ')}</strong><small>{formatWorkspaceDateTime(event.occurred_at, preferences)} · {event.actor_id.slice(0, 8)}…</small>{event.reason && <p>{event.reason}</p>}</div></li>)}</ol> : <div className="employee-empty">No history events are visible yet.</div>}</article></section>
    <EmployeeDocuments employee={employee}/>
    {employee.approval_status === 'APPROVED' && <EmployeeLifecyclePanel employee={employee} initialAction={searchParams.get('lifecycle')} />}
    {employee.approval_status === 'APPROVED' && <ApprovedChangeRequestPanel employee={employee} />}
  </div>
}

function EmployeeLifecyclePanel({ employee, initialAction }: { employee: EmployeeDirectoryRecord; initialAction: string | null }) {
  const service = useMemo(() => createLiveBusinessServices(getSupabaseClient()).employees, [])
  const [capabilities, setCapabilities] = useState<EmployeeLifecycleCapabilities | null>(null)
  const [requests, setRequests] = useState<EmployeeLifecycleRequestRecord[]>([])
  const lifecycleActions: EmployeeLifecycleAction[] = ['SUSPENSION', 'SUSPENSION_LIFTED', 'SEPARATION', 'TERMINATION', 'REACTIVATION', 'CONTRACT_RENEWAL']
  const [action, setAction] = useState<EmployeeLifecycleAction>(() => lifecycleActions.includes(initialAction as EmployeeLifecycleAction) ? initialAction as EmployeeLifecycleAction : 'SUSPENSION')
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [separationType, setSeparationType] = useState('RESIGNATION')
  const [payClassification, setPayClassification] = useState<'PAID' | 'UNPAID'>('UNPAID')
  const [expectedReturnDate, setExpectedReturnDate] = useState('')
  const [lastWorkingDay, setLastWorkingDay] = useState('')
  const [noticeDetails, setNoticeDetails] = useState('')
  const [settlementNotes, setSettlementNotes] = useState('')
  const [hrNotes, setHrNotes] = useState('')
  const [contractType, setContractType] = useState(employee.contract_type)
  const [contractStartDate, setContractStartDate] = useState('')
  const [contractEndDate, setContractEndDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    const [nextCapabilities, nextRequests] = await Promise.all([
      service.lifecycleCapabilities(employee.id), service.lifecycleRequests(employee.id),
    ])
    setCapabilities(nextCapabilities)
    setRequests(nextRequests)
  }, [employee.id, service])

  useEffect(() => { void refresh().catch(() => setError('Lifecycle details are unavailable for your current access.')) }, [refresh])

  const availableActions = useMemo<EmployeeLifecycleAction[]>(() => capabilities?.status === 'ACTIVE'
    ? ['SUSPENSION', 'SEPARATION', 'TERMINATION', 'CONTRACT_RENEWAL']
    : capabilities?.status === 'SUSPENDED'
      ? ['SUSPENSION_LIFTED', 'SEPARATION', 'TERMINATION', 'CONTRACT_RENEWAL']
      : ['REACTIVATION', 'CONTRACT_RENEWAL'], [capabilities?.status])
  useEffect(() => {
    if (capabilities && !availableActions.includes(action)) setAction(availableActions[0])
  }, [action, availableActions, capabilities])
  const labels: Record<EmployeeLifecycleAction, string> = {
    SUSPENSION: 'Suspend employee', SUSPENSION_LIFTED: 'Lift suspension', SEPARATION: 'Separate employee',
    TERMINATION: 'Terminate employment', REACTIVATION: 'Reactivate employee', CONTRACT_RENEWAL: 'Renew or extend contract',
  }
  const actionNeedsContract = action === 'CONTRACT_RENEWAL' || (action === 'REACTIVATION' && capabilities?.contract_expired)

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('')
    if (!reason.trim()) { setError('Enter the reason for this lifecycle request.'); return }
    setBusy(true)
    try {
      await service.createLifecycleRequest(employee.id, {
        action, effective_date: effectiveDate, reason: reason.trim(),
        ...(action === 'SEPARATION' ? { separation_type: separationType } : {}),
        ...(action === 'SUSPENSION' ? { pay_classification: payClassification, expected_return_date: expectedReturnDate } : {}),
        ...(['SEPARATION', 'TERMINATION'].includes(action) ? { last_working_day: lastWorkingDay, notice_details: noticeDetails } : {}),
        ...(actionNeedsContract ? { contract_type: contractType, contract_start_date: contractStartDate, contract_end_date: contractEndDate } : {}),
        settlement_notes: settlementNotes, hr_notes: hrNotes,
      })
      setReason(''); setNotice('Lifecycle request submitted for separate authorized review.')
      await refresh()
    } catch { setError('The request was not saved. Check your permission, dates, reason and any pending lifecycle request, then retry.') }
    finally { setBusy(false) }
  }

  const review = async (requestId: string, decision: 'APPROVE' | 'REJECT') => {
    const reviewReason = decision === 'REJECT' ? window.prompt('Enter the reason for rejecting this request:') : undefined
    if (decision === 'REJECT' && !reviewReason?.trim()) return
    if (decision === 'APPROVE' && !window.confirm('Approve this effective-dated employee lifecycle request? Payroll drafts that overlap may require recalculation.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await service.reviewLifecycleRequest(requestId, decision, reviewReason?.trim())
      setNotice(decision === 'APPROVE' ? 'Lifecycle request approved and recorded.' : 'Lifecycle request rejected and retained in history.')
      await refresh()
    } catch { setError('The lifecycle decision was not recorded. Verify your approval permission and request status.') }
    finally { setBusy(false) }
  }

  return <section className="panel employee-status-editor" aria-labelledby="employee-lifecycle-heading">
    <div className="section-eyebrow">EMPLOYMENT LIFECYCLE</div><h2 id="employee-lifecycle-heading">Status, contracts and history</h2>
    <p>Effective status: <strong>{capabilities?.status?.replaceAll('_', ' ') ?? 'Loading'}</strong>. Requests are effective-dated and require a different authorized reviewer. Expired contracts are flagged for review; they do not terminate employment automatically.</p>
    {capabilities?.contract_expired && <div className="auth-shell-error" role="status">Contract expired on {capabilities.contract_end_date}. Review or record an authorized renewal before future payroll eligibility.</div>}
    {capabilities ? capabilities.can_request ? <form className="employee-form-grid employee-lifecycle-form" onSubmit={(event) => void submitRequest(event)}>
      <label>Lifecycle action<select value={action} onChange={(event) => setAction(event.target.value as EmployeeLifecycleAction)}>{availableActions.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <label>Effective date<input required type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
      {action === 'SUSPENSION' && <><label>Suspension pay classification<select value={payClassification} onChange={(event) => setPayClassification(event.target.value as 'PAID' | 'UNPAID')}><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select></label><label>Expected return date (optional)<input type="date" value={expectedReturnDate} onChange={(event) => setExpectedReturnDate(event.target.value)} /></label><p className="form-hint">Paid suspension payroll remains blocked until an approved company pay policy is configured.</p></>}
      {action === 'SEPARATION' && <label>Separation type<select value={separationType} onChange={(event) => setSeparationType(event.target.value)}><option value="RESIGNATION">Resignation</option><option value="RETIREMENT">Retirement</option><option value="MUTUAL_SEPARATION">Mutual separation</option><option value="REDUNDANCY">Redundancy</option><option value="CONTRACT_COMPLETION">Contract completion</option><option value="OTHER">Other</option></select></label>}
      {['SEPARATION', 'TERMINATION'].includes(action) && <><label>Last working day<input required type="date" value={lastWorkingDay} onChange={(event) => setLastWorkingDay(event.target.value)} /></label><label>Notice period details<textarea value={noticeDetails} onChange={(event) => setNoticeDetails(event.target.value)} rows={2} maxLength={1000} /></label></>}
      {actionNeedsContract && <><label>Contract type<input required value={contractType} onChange={(event) => setContractType(event.target.value)} maxLength={100} /></label><label>Contract start date<input required type="date" value={contractStartDate} onChange={(event) => setContractStartDate(event.target.value)} /></label><label>Contract end date (optional)<input type="date" value={contractEndDate} onChange={(event) => setContractEndDate(event.target.value)} /></label></>}
      <label className="full-width">Reason<textarea required value={reason} onChange={(event) => setReason(event.target.value)} rows={3} minLength={3} maxLength={2000} /></label>
      <label className="full-width">Final settlement notes (review only; no amount is calculated here)<textarea value={settlementNotes} onChange={(event) => setSettlementNotes(event.target.value)} rows={2} maxLength={2000} /></label>
      <label className="full-width">Additional HR notes<textarea value={hrNotes} onChange={(event) => setHrNotes(event.target.value)} rows={2} maxLength={2000} /></label>
      <div className="live-employee-actions full-width"><button className="button-primary" type="submit" disabled={busy || !capabilities}>Submit for approval</button></div>
    </form> : <p>You may view lifecycle history. A user with employee status management permission is required to submit changes.</p> : <p role="status">Checking lifecycle permissions…</p>}
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    <h3>Lifecycle requests</h3>{requests.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>Action</th><th>Effective date</th><th>Status</th><th>Requested</th><th>Review</th></tr></thead><tbody>{requests.map((request) => { const mayReview = request.status === 'PENDING_APPROVAL' && request.requested_by !== capabilities?.current_user_id; return <tr key={request.id}><td>{labels[request.action]}{request.separation_type && <small>{request.separation_type.replaceAll('_', ' ')}</small>}<small>{request.reason}</small></td><td>{request.effective_date}{request.last_working_day && <small>Last day {request.last_working_day}</small>}</td><td><span className={`approval-status status-${request.status.toLowerCase()}`}>{request.status.replaceAll('_', ' ')}</span>{request.final_settlement_status && <small>Settlement: {request.final_settlement_status.replaceAll('_', ' ')}</small>}</td><td>{request.created_at.slice(0, 10)}</td><td>{mayReview && capabilities?.can_approve && <button className="button-secondary" disabled={busy} onClick={() => void review(request.id, 'APPROVE')}>Approve</button>}{mayReview && capabilities?.can_reject && <button className="button-secondary" disabled={busy} onClick={() => void review(request.id, 'REJECT')}>Reject</button>}{request.review_reason && <small>{request.review_reason}</small>}</td></tr> })}</tbody></table></div> : <div className="employee-empty">No lifecycle requests recorded.</div>}
  </section>
}

function ApprovedChangeRequestPanel({ employee }: { employee: EmployeeDirectoryRecord }) {
  const [capabilities, setCapabilities] = useState<EmployeeChangeCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState('')
  const [nationality, setNationality] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [emailUnavailableReason, setEmailUnavailableReason] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyRelationship, setEmergencyRelationship] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [contractType, setContractType] = useState('')
  const [contractStartDate, setContractStartDate] = useState('')
  const [contractEndDate, setContractEndDate] = useState('')
  const [clearContractEndDate, setClearContractEndDate] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [salaryFrequency, setSalaryFrequency] = useState('')
  const [overtimeEligible, setOvertimeEligible] = useState('')
  const [basicPay, setBasicPay] = useState('')
  const [housingAllowance, setHousingAllowance] = useState('')
  const [mealAllowance, setMealAllowance] = useState('')
  const [transportAllowance, setTransportAllowance] = useState('')
  const [otherAllowances, setOtherAllowances] = useState('')
  const [allowanceProrationRules, setAllowanceProrationRules] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void createLiveBusinessServices(getSupabaseClient()).employees.changeCapabilities(employee.id)
      .then((value) => { if (active) setCapabilities(value) })
      .catch(() => { if (active) setCapabilityError(true) })
    return () => { active = false }
  }, [employee.id])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('')
    const employmentChanges: Record<string, unknown> = {}
    if (firstName.trim()) employmentChanges.first_name = firstName.trim()
    if (middleName.trim()) employmentChanges.middle_name = middleName.trim()
    if (lastName.trim()) employmentChanges.last_name = lastName.trim()
    if (dateOfBirth) employmentChanges.date_of_birth = dateOfBirth
    if (gender) employmentChanges.gender = gender
    if (nationality.trim()) employmentChanges.nationality = nationality.trim()
    const privateDetails: Record<string, string> = {}
    if (address.trim()) privateDetails.residential_address = address.trim()
    if (phone.trim()) privateDetails.phone = phone.trim()
    if (email.trim() || emailUnavailableReason.trim()) {
      privateDetails.email = email.trim()
      privateDetails.email_unavailable_reason = email.trim() ? '' : emailUnavailableReason.trim()
    }
    if (emergencyName.trim()) privateDetails.emergency_contact_name = emergencyName.trim()
    if (emergencyRelationship.trim()) privateDetails.emergency_contact_relationship = emergencyRelationship.trim()
    if (emergencyPhone.trim()) privateDetails.emergency_contact_phone = emergencyPhone.trim()
    if (Object.keys(privateDetails).length) employmentChanges.private_details = privateDetails
    if (jobTitle.trim()) employmentChanges.job_title = jobTitle.trim()
    if (department.trim()) employmentChanges.department = department.trim()
    if (employmentType) employmentChanges.employment_type = employmentType
    if (contractType.trim()) employmentChanges.contract_type = contractType.trim()
    if (contractStartDate) employmentChanges.contract_start_date = contractStartDate
    if (contractEndDate) employmentChanges.contract_end_date = contractEndDate
    else if (clearContractEndDate) employmentChanges.contract_end_date = ''
    const compensationChange: Record<string, unknown> = {}
    if (effectiveFrom && ([basicPay, housingAllowance, mealAllowance, transportAllowance, otherAllowances].some((value) => value !== '') || salaryFrequency !== '' || overtimeEligible !== '' || Object.values(allowanceProrationRules).some(Boolean))) {
      compensationChange.effective_from = effectiveFrom
      if (salaryFrequency) compensationChange.salary_frequency = salaryFrequency
      if (overtimeEligible !== '') compensationChange.overtime_eligible = overtimeEligible === 'true'
      if (basicPay !== '') compensationChange.basic_pay = Number(basicPay)
      if (housingAllowance !== '') compensationChange.housing_allowance = Number(housingAllowance)
      if (mealAllowance !== '') compensationChange.meal_allowance = Number(mealAllowance)
      if (transportAllowance !== '') compensationChange.transport_allowance = Number(transportAllowance)
      if (otherAllowances !== '') compensationChange.other_allowances = Number(otherAllowances)
      const selectedAllowanceRules = Object.fromEntries(Object.entries(allowanceProrationRules).filter(([, enabled]) => enabled).map(([key]) => [key, 'SCHEDULED_DAYS']))
      if (Object.keys(selectedAllowanceRules).length) compensationChange.allowance_proration_rules = selectedAllowanceRules
    }
    if (!Object.keys(employmentChanges).length && !Object.keys(compensationChange).length) {
      setError('Enter at least one employment change or a compensation change with an effective date.'); return
    }
    if (!reason.trim()) { setError('Enter a reason for this change request.'); return }
    setBusy(true)
    try {
      await createLiveBusinessServices(getSupabaseClient()).employees.requestApprovedChange(employee.id, employmentChanges, compensationChange, reason.trim())
      setFirstName(''); setMiddleName(''); setLastName(''); setDateOfBirth(''); setGender(''); setNationality('')
      setAddress(''); setPhone(''); setEmail(''); setEmailUnavailableReason(''); setEmergencyName(''); setEmergencyRelationship(''); setEmergencyPhone('')
      setJobTitle(''); setDepartment(''); setEmploymentType(''); setContractType(''); setContractStartDate(''); setContractEndDate(''); setClearContractEndDate(false)
      setEffectiveFrom(''); setSalaryFrequency(''); setOvertimeEligible(''); setBasicPay(''); setHousingAllowance(''); setMealAllowance(''); setTransportAllowance(''); setOtherAllowances(''); setAllowanceProrationRules({}); setReason('')
      setNotice('Change request submitted for independent review. The approved record has not been changed yet.')
    } catch {
      setError('The request was not saved. Check your employee or compensation permissions, the effective date, and whether another request is awaiting review.')
    } finally { setBusy(false) }
  }

  if (!capabilities && !capabilityError) return null
  if (capabilityError) return <section className="panel employee-status-editor"><h3>Approved employee changes</h3><p>This workflow is not available in the current workspace yet.</p></section>
  if (capabilities?.has_pending_request) return <section className="panel employee-status-editor" role="status"><h3>Change request awaiting review</h3><p>This employee already has a pending change request. Resolve it before submitting another.</p></section>
  if (!capabilities?.can_request_employee && !capabilities?.can_request_compensation) return null

  return <section className="panel employee-status-editor employee-change-request-panel">
    <h3>Edit employee or request a salary change</h3>
    <p>Changes remain pending until an authorized reviewer approves them. Compensation changes create a new effective-dated version.</p>
    {capabilities.latest_request && <p role="status">Latest request: {capabilities.latest_request.status.replaceAll('_', ' ')}{capabilities.latest_request.review_reason ? ` · ${capabilities.latest_request.review_reason}` : ''}</p>}
    <form onSubmit={(event) => void submit(event)}>
      {capabilities.can_request_employee && <fieldset><legend>Edit employee information</legend><div className="employee-change-form-grid">
        <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={120} /></label>
        <label>Middle name<input value={middleName} onChange={(event) => setMiddleName(event.target.value)} maxLength={120} /></label>
        <label>Surname<input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={120} /></label>
        <label>Date of birth<input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
        <label>Gender<select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">Keep current</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label>
        <label>Nationality<input value={nationality} onChange={(event) => setNationality(event.target.value)} maxLength={80} /></label>
      </div></fieldset>}
      {capabilities.can_request_employee && <fieldset><legend>Private contact corrections</legend><p>Enter only the private contact values to change. Existing identifiers and banking details are not shown or changed here.</p><div className="employee-change-form-grid">
        <label>Residential address<input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} /></label>
        <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={80} /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} /></label>
        <label>Reason email is unavailable<input value={emailUnavailableReason} onChange={(event) => setEmailUnavailableReason(event.target.value)} maxLength={250} /></label>
        <label>Emergency contact name<input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} maxLength={160} /></label>
        <label>Emergency contact relationship<input value={emergencyRelationship} onChange={(event) => setEmergencyRelationship(event.target.value)} maxLength={100} /></label>
        <label>Emergency contact phone<input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} maxLength={80} /></label>
      </div></fieldset>}
      {capabilities.can_request_employee && <fieldset><legend>Employment details</legend><div className="employee-change-form-grid">
        <label>New job title<input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} maxLength={120} /></label>
        <label>New department<input value={department} onChange={(event) => setDepartment(event.target.value)} maxLength={120} /></label>
        <label>Employment type<select value={employmentType} onChange={(event) => setEmploymentType(event.target.value)}><option value="">Keep current</option><option value="PERMANENT">Permanent</option><option value="FIXED_TERM">Fixed term</option><option value="PART_TIME">Part time</option><option value="CASUAL">Casual</option><option value="DAILY_RATED">Daily rated</option></select></label>
        <label>New contract type<input value={contractType} onChange={(event) => setContractType(event.target.value)} maxLength={80} /></label>
        <label>Contract start date<input type="date" value={contractStartDate} onChange={(event) => setContractStartDate(event.target.value)} /></label>
        <label>Contract end date<input type="date" value={contractEndDate} onChange={(event) => { setContractEndDate(event.target.value); if (event.target.value) setClearContractEndDate(false) }} /></label>
        <label><input type="checkbox" checked={clearContractEndDate} onChange={(event) => { setClearContractEndDate(event.target.checked); if (event.target.checked) setContractEndDate('') }} /> Remove contract end date</label>
      </div></fieldset>}
      {capabilities.can_request_compensation && <fieldset><legend>Request salary change</legend><div className="employee-change-form-grid">
        <label>Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
        <label>Pay frequency<select value={salaryFrequency} onChange={(event) => setSalaryFrequency(event.target.value)}><option value="">Keep current</option><option value="MONTHLY">Monthly</option><option value="FORTNIGHTLY">Fortnightly</option><option value="WEEKLY">Weekly</option><option value="DAILY">Daily</option></select></label>
        <label>Overtime eligible<select value={overtimeEligible} onChange={(event) => setOvertimeEligible(event.target.value)}><option value="">Keep current</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Basic pay (ZMW)<input type="number" min="0" step="0.01" value={basicPay} onChange={(event) => setBasicPay(event.target.value)} /></label>
        <label>Housing allowance (ZMW)<input type="number" min="0" step="0.01" value={housingAllowance} onChange={(event) => setHousingAllowance(event.target.value)} /></label>
        <label>Meal allowance (ZMW)<input type="number" min="0" step="0.01" value={mealAllowance} onChange={(event) => setMealAllowance(event.target.value)} /></label>
        <label>Transport allowance (ZMW)<input type="number" min="0" step="0.01" value={transportAllowance} onChange={(event) => setTransportAllowance(event.target.value)} /></label>
        <label>Other allowances (ZMW)<input type="number" min="0" step="0.01" value={otherAllowances} onChange={(event) => setOtherAllowances(event.target.value)} /></label>
        <div className="employee-change-proration-rules"><strong>Allowance proration</strong><p>Choose scheduled-days proration explicitly for any allowance that should be prorated in a partial month.</p>{[['housing_allowance','Housing allowance'],['meal_allowance','Meal allowance'],['transport_allowance','Transport allowance'],['other_allowances','Other allowances']].map(([key,label]) => <label key={key}><input type="checkbox" checked={allowanceProrationRules[key] ?? false} onChange={(event) => setAllowanceProrationRules((current) => ({ ...current, [key]: event.target.checked }))} /> Prorate {label.toLowerCase()} by scheduled days</label>)}</div>
      </div></fieldset>}
      <label>Reason for change<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} rows={3} /></label>
      {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
      <button className="button-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for independent review'}</button>
    </form>
  </section>
}

function EmployeeDocuments({ employee }: { employee: EmployeeDirectoryRecord }) {
  const { preferences } = useWorkspace()
  const [documents, setDocuments] = useState<EmployeeDocumentRecord[]>([])
  const [kind, setKind] = useState<EmployeeDocumentRecord['document_type']>('CONTRACT')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try { setDocuments(await createLiveHrServices(getSupabaseClient()).employeeDocuments.list(employee.id)); setError('') }
    catch { setError('Private documents are not available under the current employee-document permission.') }
    finally { setLoading(false) }
  }, [employee.id])
  useEffect(() => { void load() }, [load])
  const upload = async (file?: File) => {
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createLiveHrServices(getSupabaseClient()).employeeDocuments.upload({ employee: { id: employee.id, portfolio_id: employee.portfolio_id, company_id: employee.company_id, workplace_branch_id: employee.workplace_branch_id }, file, type: kind })
      setNotice('Document uploaded to private company storage and registered in the audit log.'); await load()
    } catch { setError('The document was not saved. Use PDF, JPEG or PNG under 15 MB and verify employee document permission.') }
    finally { setBusy(false) }
  }
  const download = async (document: EmployeeDocumentRecord) => {
    setBusy(true); setError('')
    try { const url = await createLiveHrServices(getSupabaseClient()).employeeDocuments.signedDownload(document.storage_path); window.open(url, '_blank', 'noopener,noreferrer') }
    catch { setError('A private download link could not be created under your current permission.') }
    finally { setBusy(false) }
  }
  return <section className="panel employee-history-card employee-documents"><header><div><div className="section-eyebrow">PRIVATE EMPLOYEE DOCUMENTS</div><p>Files are kept in private company storage. Download links expire after one minute.</p></div></header>
    <div className="employee-document-toolbar"><label>Document type<select value={kind} onChange={(event) => setKind(event.target.value as EmployeeDocumentRecord['document_type'])}>{['IDENTITY','CONTRACT','CERTIFICATE','TAX','OTHER'].map((value) => <option key={value}>{value}</option>)}</select></label><label className="button-secondary employee-document-upload"><Upload size={14}/> Upload document<input aria-label="Upload employee document" type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = '' }}/></label></div>
    {notice && <p role="status" className="import-success">{notice}</p>}{error && <p role="alert" className="auth-shell-error">{error}</p>}{loading ? <p role="status">Loading private documents…</p> : documents.length ? <ul>{documents.map((item) => <li key={item.id}><span><strong>{item.file_name}</strong><small>{item.document_type} · {(item.byte_size / 1024).toFixed(0)} KB · {formatWorkspaceDate(item.created_at, preferences)}</small></span><button className="button-secondary" disabled={busy} onClick={() => void download(item)}><Download size={14}/> Download</button></li>)}</ul> : !error && <p>No private documents are registered for this employee.</p>}
  </section>
}

type ReviewTarget = { employee: EmployeeDirectoryRecord; decision: EmployeeReviewDecision }

function employeeReviewErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (code === '42501') return 'Your account does not have employee review permission for this company and branch.'
  if (code === '40001') return 'Another reviewer changed this submission. The queue has been refreshed; choose an available submission.'
  if (code === '22023') return 'The selected review action is invalid. Add a reason when returning or rejecting a submission.'
  return 'The review could not be saved. Refresh the queue and try again, or contact an administrator if this continues.'
}

export function LiveEmployeeApprovals({ roles = [] }: { roles?: WorkspaceRole[] }) {
  const { companies, activeCompanyId } = useWorkspace()
  const location = useLocation()
  const [records, setRecords] = useState<EmployeeDirectoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [target, setTarget] = useState<ReviewTarget | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [summary, setSummary] = useState({ total_pending: 0, ready_for_approval: 0, needs_correction: 0, approved: 0, rejected: 0, approval_eligible: 0, rejection_eligible: 0 })
  const [stagedRecords, setStagedRecords] = useState<StagingRecord[]>([])
  const [bulkAction, setBulkAction] = useState<'APPROVE' | 'REJECT' | null>(null)
  const [bulkMode, setBulkMode] = useState<'ALL' | 'SELECTED'>('ALL')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResults, setBulkResults] = useState<{ employee_id: string; label: string; success: boolean; status: string; message?: string }[]>([])
  const [editingImportId, setEditingImportId] = useState<string | null>(null)
  const [rejectingImport, setRejectingImport] = useState<StagingRecord | null>(null)
  const [importRejectReason, setImportRejectReason] = useState('')
  const [importDecisionBusy, setImportDecisionBusy] = useState(false)
  const [branchFilter, setBranchFilter] = useState('ALL')
  const [importStatusFilter, setImportStatusFilter] = useState('ALL')
  const canApprove = roles.some((role) => ['PORTFOLIO_ADMIN','PORTFOLIO_COMPANY_ADMIN','OVERALL_HR_MANAGER','COMPANY_ADMIN'].includes(role))
  const eligibleStagedRecords = stagedRecords.filter((record) => {
    const company = companies.find((item) => item.id === record.company_id)
    const branch = company?.branches.find((item) => item.id === record.branch_id)
    return !record.resulting_employee_id
      && ['PENDING_REVIEW','NEEDS_INFORMATION','READY_FOR_APPROVAL'].includes(record.review_status)
      && record.validation_errors.length === 0
      && record.duplicate_warnings.length === 0
      && validateStagedEmployee(record.current_data, record.company_id ?? '', record.branch_id ?? '').length === 0
      && branch?.status.toLowerCase() === 'active'
  })
  const visibleStagedRecords = stagedRecords.filter((record) => {
    const query = search.trim().toLowerCase()
    const name = [record.current_data.first_name, record.current_data.middle_name, record.current_data.last_name].filter(Boolean).join(' ')
    return (!query || `${name} ${record.current_data.employee_number ?? ''} ${record.source_sheet} ${record.source_row}`.toLowerCase().includes(query))
      && (branchFilter === 'ALL' || record.branch_id === branchFilter)
      && (importStatusFilter === 'ALL' || record.review_status === importStatusFilter)
      && (activeCompanyId === 'all' || record.company_id === activeCompanyId)
  })
  const requestGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).employees.list({ page, pageSize: PAGE_SIZE, search, approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' })
      if (generation !== requestGeneration.current) return
      setRecords(result.items)
      setTotal(result.total)
      setSelectedIds((current) => current.filter((id) => result.items.some((item) => item.id === id)))
      const companyId = activeCompanyId && activeCompanyId !== 'all' ? activeCompanyId : undefined
      const summary = await createLiveBusinessServices(getSupabaseClient()).employees.approvalQueueSummary(companyId)
      setSummary(summary)
      const portfolioIds = [...new Set(companies.map((company) => company.portfolioId).filter((id): id is string => Boolean(id)))]
      try { setStagedRecords(await createEmployeeImportStagingService(getSupabaseClient()).listPendingReviewRecords(portfolioIds, companyId)) }
      catch { setStagedRecords([]) } // Import-review permission is separate from final employee approval.
    } catch {
      if (generation === requestGeneration.current) setError('Employee submissions could not be loaded. Check your access and try again.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [page, search, activeCompanyId, companies])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); requestGeneration.current += 1 } }, [load])
  useEffect(() => {
    window.addEventListener('gbhr-employee-approvals-changed', load)
    return () => window.removeEventListener('gbhr-employee-approvals-changed', load)
  }, [load])
  useEffect(() => {
    const state = location.state as { employeeImportNotice?: string } | null
    if (state?.employeeImportNotice) {
      setNotice(state.employeeImportNotice)
      window.history.replaceState(null, document.title)
    }
  }, [location.state])

  const runBulk = async () => {
    const stagePrefix = 'stage:'
    const employeeIds = selectedIds.filter((id) => !id.startsWith(stagePrefix))
    const selectedStageIds = selectedIds.filter((id) => id.startsWith(stagePrefix)).map((id) => id.slice(stagePrefix.length))
    if (bulkMode === 'SELECTED' && selectedIds.length === 0) return
    if (bulkAction === 'REJECT' && bulkReason.trim().length < 3) { setError('Enter a rejection reason of at least 3 characters.'); return }
    setBulkBusy(true); setError(''); setNotice(''); setBulkResults([])
    try {
      const outcomes: typeof bulkResults = []
      const employeeScope = bulkMode === 'ALL' ? null : employeeIds
      if (bulkMode === 'ALL' || employeeIds.length > 0) {
        try {
          const results = await createLiveBusinessServices(getSupabaseClient()).employees.reviewSubmissions(employeeScope, bulkAction!, bulkReason.trim() || undefined, activeCompanyId !== 'all' ? activeCompanyId : undefined)
          outcomes.push(...results.map((item) => {
            const employee = records.find((record) => record.id === item.employee_id)
            return { ...item, label: employee ? `${employee.first_name} ${employee.last_name} (${employee.employee_number})` : item.employee_id }
          }))
        } catch (reason) {
          outcomes.push({ employee_id: 'employee-scope', label: 'Employee submissions', success: false, status: 'FAILED', message: employeeReviewErrorMessage(reason) })
        }
      }
      const pendingStaged = stagedRecords.filter((record) => !record.resulting_employee_id && ['PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL'].includes(record.review_status)
        && (activeCompanyId === 'all' || record.company_id === activeCompanyId)
        && (branchFilter === 'ALL' || record.branch_id === branchFilter)
        && (importStatusFilter === 'ALL' || record.review_status === importStatusFilter))
      const selectedStages = bulkMode === 'ALL' ? pendingStaged : pendingStaged.filter((record) => selectedStageIds.includes(record.id))
      const stagedService = createEmployeeImportStagingService(getSupabaseClient())
      for (const record of selectedStages) {
        const label = `${record.current_data.first_name ?? ''} ${record.current_data.last_name ?? ''} (${record.current_data.employee_number ?? record.id})`.trim()
        if (bulkAction === 'APPROVE') {
          if (!eligibleStagedRecords.some((item) => item.id === record.id)) {
            outcomes.push({ employee_id: `${stagePrefix}${record.id}`, label, success: false, status: 'NEEDS_CORRECTION', message: 'Complete the required fields, resolve duplicates, and assign an active branch.' })
            continue
          }
          try {
            await stagedService.review({ recordId: record.id, companyId: record.company_id, branchId: record.branch_id, currentData: record.current_data, payrollData: record.payroll_data, decision: 'MARK_READY' })
            const keyName = `gbhr-staged-submit:${record.id}`
            let idempotencyKey: string
            try { idempotencyKey = sessionStorage.getItem(keyName) ?? crypto.randomUUID(); sessionStorage.setItem(keyName, idempotencyKey) }
            catch { idempotencyKey = `staged:${record.id}:${crypto.randomUUID()}` }
            const submitted = await stagedService.submit(record.id, idempotencyKey)
            if (submitted.status !== 'SUBMITTED_FOR_APPROVAL' || !submitted.employee_id) throw new Error('The existing employee submission workflow did not return a pending employee draft.')
            await stagedService.approve(submitted.employee_id)
            outcomes.push({ employee_id: `${stagePrefix}${record.id}`, label, success: true, status: 'APPROVED' })
          } catch (reason) {
            outcomes.push({ employee_id: `${stagePrefix}${record.id}`, label, success: false, status: 'FAILED', message: reason instanceof Error ? reason.message : 'The database rejected this approval.' })
          }
        } else {
          try {
            await stagedService.review({ recordId: record.id, companyId: record.company_id, branchId: record.branch_id, currentData: record.current_data, payrollData: record.payroll_data, decision: 'REJECT', reason: bulkReason.trim() })
            outcomes.push({ employee_id: `${stagePrefix}${record.id}`, label, success: true, status: 'REJECTED' })
          } catch (reason) {
            outcomes.push({ employee_id: `${stagePrefix}${record.id}`, label, success: false, status: 'FAILED', message: reason instanceof Error ? reason.message : 'The database rejected this decision.' })
          }
        }
      }
      setBulkResults(outcomes)
      const succeeded = outcomes.filter((item) => item.success).length
      const failed = outcomes.length - succeeded
      const verb = bulkAction === 'APPROVE' ? 'approved' : 'rejected'
      setNotice(`${succeeded} employee${succeeded === 1 ? '' : 's'} ${verb}${failed ? `; ${failed} remain pending, need correction, or require follow-up` : ''}.`)
      setSelectedIds([]); setBulkAction(null); setBulkReason('')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      setLoading(true); await load()
    } catch (bulkError) { setError(employeeReviewErrorMessage(bulkError)) }
    finally { setBulkBusy(false) }
  }

  const approveImportedRecord = async (record: StagingRecord) => {
    if (!canApprove || importDecisionBusy) return
    const issues = validateStagedEmployee(record.current_data, record.company_id ?? '', record.branch_id ?? '')
    const company = companies.find((item) => item.id === record.company_id)
    const branch = company?.branches.find((item) => item.id === record.branch_id)
    if (issues.length || record.validation_errors.length || record.duplicate_warnings.length || branch?.status.toLowerCase() !== 'active') {
      setError(`This employee still needs correction: ${[...issues, ...record.validation_errors.map((item)=>item.message), ...record.duplicate_warnings.map((item)=>item.message), branch?.status.toLowerCase() !== 'active' ? 'Select an active workplace branch' : ''].filter(Boolean).join('; ')}`)
      return
    }
    const employeeName = `${record.current_data.first_name ?? ''} ${record.current_data.last_name ?? ''}`.trim() || record.current_data.employee_number
    if (!window.confirm(`Validate and approve ${employeeName} using the existing HR approval workflow?`)) return
    setImportDecisionBusy(true); setError(''); setNotice('')
    const service = createEmployeeImportStagingService(getSupabaseClient())
    try {
      await service.review({ recordId: record.id, companyId: record.company_id, branchId: record.branch_id, currentData: record.current_data, payrollData: record.payroll_data, decision: 'MARK_READY' })
      const keyName = `gbhr-staged-submit:${record.id}`
      let idempotencyKey: string
      try { idempotencyKey = sessionStorage.getItem(keyName) ?? crypto.randomUUID(); sessionStorage.setItem(keyName, idempotencyKey) }
      catch { idempotencyKey = `staged:${record.id}:${crypto.randomUUID()}` }
      const submitted = await service.submit(record.id, idempotencyKey)
      if (submitted.status !== 'SUBMITTED_FOR_APPROVAL' || !submitted.employee_id) throw new Error('The existing employee submission workflow did not return a pending employee draft.')
      await service.approve(submitted.employee_id)
      setNotice(`${employeeName} was approved through the existing HR workflow and added to the employee register.`)
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval failed. Refresh the queue and review the record state.')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await load()
    } finally { setImportDecisionBusy(false) }
  }

  const rejectImportedRecord = async (event: FormEvent) => {
    event.preventDefault()
    if (!rejectingImport || importRejectReason.trim().length < 3 || importDecisionBusy) return
    setImportDecisionBusy(true); setError(''); setNotice('')
    try {
      await createEmployeeImportStagingService(getSupabaseClient()).review({ recordId: rejectingImport.id, companyId: rejectingImport.company_id, branchId: rejectingImport.branch_id, currentData: rejectingImport.current_data, payrollData: rejectingImport.payroll_data, decision: 'REJECT', reason: importRejectReason.trim() })
      setNotice('Imported employee rejected. The reason and reviewer are recorded in the audit history.')
      setRejectingImport(null); setImportRejectReason('')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The imported employee could not be rejected.') }
    finally { setImportDecisionBusy(false) }
  }

  const review = async (employee: EmployeeDirectoryRecord, decision: EmployeeReviewDecision, reviewReason?: string) => {
    setBusyId(employee.id)
    setError('')
    setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).employees.reviewSubmission(employee.id, decision, reviewReason)
      setNotice(`${employee.first_name} ${employee.last_name}: ${decision.toLowerCase()} action saved.`)
      setTarget(null)
      setReason('')
      setRecords((current) => current.filter((record) => record.id !== employee.id))
      setTotal((current) => Math.max(0, current - 1))
      setLoading(true)
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await load()
    } catch (reviewError) {
      setError(employeeReviewErrorMessage(reviewError))
    } finally {
      setBusyId('')
    }
  }

  const submitDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!target) return
    if (reason.trim().length < 3) { setError('Enter a short review reason before returning or rejecting this record.'); return }
    await review(target.employee, target.decision, reason.trim())
  }

  const pendingImports = visibleStagedRecords.filter((record) => !record.resulting_employee_id)
  const eligibleTotal = summary.approval_eligible + eligibleStagedRecords.filter((record) => pendingImports.some((item) => item.id === record.id)).length
  const rejectionTotal = summary.rejection_eligible + pendingImports.length
  return <div className="employee-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> HR REVIEW QUEUE</div><h1>AWAITING FINAL HR APPROVAL</h1><p>Review imported employee candidates and submitted employee drafts in your authorized company scope.</p></div><Link className="button-secondary" to="/employees">Employee directory</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Approval and rejection decisions use the existing authorized HR workflow and are recorded with your account.</div>
    {(error || notice) && <div className={`employee-review-toast ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}><span>{error || notice}</span>{error && <button type="button" className="button-secondary" onClick={() => { setError(''); setLoading(true); void load() }}>Refresh queue</button>}<button type="button" className="icon-button" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice('') }}><X size={16}/></button></div>}
    {bulkResults.length>0&&<details className="panel employee-bulk-results"><summary>Bulk decision results ({bulkResults.filter((item)=>item.success).length} succeeded · {bulkResults.filter((item)=>!item.success).length} require follow-up)</summary><ul>{bulkResults.map((item)=><li key={item.employee_id}><strong>{item.label}</strong><span>{item.success?item.status.replaceAll('_',' '):`${item.status.replaceAll('_',' ')}${item.message?`: ${item.message}`:''}`}</span></li>)}</ul></details>}
    <section className="employee-approval-summary" aria-label="Approval queue summary">{[['Total Pending',summary.total_pending],['Ready for Approval',summary.ready_for_approval + eligibleStagedRecords.length],['Needs Correction',summary.needs_correction + pendingImports.filter((record)=>!eligibleStagedRecords.some((item)=>item.id===record.id)).length],['Approved',summary.approved],['Rejected',summary.rejected]].map(([label,value])=><article className="panel" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="panel employee-directory-panel">
      <div className="employee-toolbar"><div><strong>{total + pendingImports.length} awaiting action</strong><small>Incomplete records remain pending for correction and cannot be approved.</small></div><label className="employee-search"><Search size={15}/><input value={search} onChange={(event) => { setLoading(true); setError(''); setSearch(event.target.value); setPage(1) }} placeholder="Search employee..." aria-label="Search pending employees"/></label></div>
      <div className="employee-approval-filters"><label>Workplace branch<select value={branchFilter} onChange={(event)=>setBranchFilter(event.target.value)}><option value="ALL">All branches</option>{companies.filter((company)=>activeCompanyId==='all'||company.id===activeCompanyId).flatMap((company)=>company.branches.map((branch)=><option value={branch.id} key={branch.id}>{company.name} · {branch.name}</option>))}</select></label><label>Import status<select value={importStatusFilter} onChange={(event)=>setImportStatusFilter(event.target.value)}><option value="ALL">All pending statuses</option>{['PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL','SUBMITTED_FOR_APPROVAL'].map((value)=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label></div>
      {canApprove && <div className="employee-bulk-actions"><button className="button-primary" disabled={bulkBusy || eligibleTotal===0} onClick={()=>{setBulkMode('ALL');setBulkAction('APPROVE');setBulkReason('')}}>Approve All ({eligibleTotal} eligible)</button><button className="button-secondary" disabled={bulkBusy || rejectionTotal===0} onClick={()=>{setBulkMode('ALL');setBulkAction('REJECT');setBulkReason('')}}>Reject All ({rejectionTotal})</button><button className="button-secondary" disabled={bulkBusy || selectedIds.length===0} onClick={()=>{setBulkMode('SELECTED');setBulkAction('APPROVE');setBulkReason('')}}>Approve Selected ({selectedIds.length})</button><span>Scope: {activeCompanyId==='all'?'all companies where you have approval permission':companies.find((company)=>company.id===activeCompanyId)?.name??'selected company'}</span></div>}
      {loading ? <div className="employee-empty" role="status">Loading submissions·</div> : <>
        {records.length>0&&<div className="table-scroll"><table className="employee-table"><thead><tr><th>Select</th><th>Employee Number</th><th>Employee Name</th><th>Company</th><th>Workplace Branch</th><th>Department</th><th>Job Title</th><th>Basic Salary</th><th>Validation Status</th><th>Actions</th></tr></thead><tbody>{records.map((employee)=>{const company=companies.find((item)=>item.id===employee.company_id);const branch=company?.branches.find((item)=>item.id===employee.workplace_branch_id);return <tr key={employee.id}><td><input type="checkbox" aria-label={`Select ${employee.first_name} ${employee.last_name}`} checked={selectedIds.includes(employee.id)} onChange={(event)=>setSelectedIds((current)=>event.target.checked?[...current,employee.id]:current.filter((id)=>id!==employee.id))}/></td><td className="import-nowrap">{employee.employee_number}</td><td>{employee.first_name} {employee.last_name}</td><td>{company?.name??'Company unavailable'}</td><td>{branch?.name??'Branch unavailable'}</td><td>{employee.department}</td><td>{employee.job_title}</td><td>·</td><td><span className="approval-status status-ready">Pending final approval</span></td><td><div className="approval-actions"><Link className="button-secondary" to={`/employees/${employee.id}`}>View / Edit</Link><button className="button-primary" disabled={!canApprove||!!busyId} onClick={()=>void review(employee,'APPROVE')}>Approve</button><button className="button-secondary" disabled={!canApprove||!!busyId} onClick={()=>{setTarget({employee,decision:'REJECT'});setReason('')}}>Reject</button></div></td></tr>})}</tbody></table></div>}
        {visibleStagedRecords.length>0&&<div className="table-scroll"><table className="employee-table employee-import-approval-table"><thead><tr><th>Select</th><th>Employee Number</th><th>Employee Name</th><th>Company</th><th>Workplace Branch</th><th>Department</th><th>Job Title</th><th>Basic Salary</th><th>Validation Status</th><th>Actions</th></tr></thead><tbody>{visibleStagedRecords.map((record)=>{const company=companies.find((item)=>item.id===record.company_id);const branch=company?.branches.find((item)=>item.id===record.branch_id);const name=[record.current_data.first_name,record.current_data.middle_name,record.current_data.last_name].filter(Boolean).join(' ')||record.current_data.full_name||'Name needs review';const issues=[...validateStagedEmployee(record.current_data,record.company_id??'',record.branch_id??''),...record.validation_errors.map((item)=>item.message),...record.duplicate_warnings.map((item)=>item.message)];const selectedId=`stage:${record.id}`;return <tr key={record.id}><td><input type="checkbox" aria-label={`Select ${name}`} checked={selectedIds.includes(selectedId)} onChange={(event)=>setSelectedIds((current)=>event.target.checked?[...current,selectedId]:current.filter((id)=>id!==selectedId))}/></td><td className="import-nowrap">{record.current_data.employee_number||'·'}</td><td>{name}</td><td>{company?.name??'Company unavailable'}</td><td>{branch?.name??(record.current_data.branch_name||'Branch needs assignment')}</td><td>{record.current_data.department||'Needs review'}</td><td>{record.current_data.job_title||'·'}</td><td className="import-nowrap">{record.current_data.basic_pay?`ZMW ${Number(record.current_data.basic_pay).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:'Not provided'}</td><td><span className={`approval-status ${issues.length?'status-needs-information':'status-ready'}`}>{record.resulting_employee_id?'Pending final approval':issues.length?`${issues.length} corrections needed`:'Ready for approval'}</span>{issues.length>0&&<details><summary>View issues</summary><ul>{issues.map((item,index)=><li key={`${index}:${item}`}>{item}</li>)}</ul></details>}</td><td><div className="approval-actions"><button className="button-secondary" onClick={()=>setEditingImportId(record.id)}>View / Edit</button><button className="button-primary" disabled={!canApprove||importDecisionBusy||!eligibleStagedRecords.some((item)=>item.id===record.id)} onClick={()=>void approveImportedRecord(record)}>Approve</button><button className="button-secondary" disabled={!canApprove||importDecisionBusy||Boolean(record.resulting_employee_id)} onClick={()=>{setRejectingImport(record);setImportRejectReason('')}}>Reject</button></div></td></tr>})}</tbody></table></div>}
        {records.length===0&&visibleStagedRecords.length===0&&<div className="employee-empty"><Check size={21}/><strong>No employees are awaiting action</strong><span>New submissions will appear here after they are saved to the authorized import queue.</span></div>}
      </>}
      <footer className="employee-pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div><button className="button-secondary" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}><ChevronLeft size={15}/></button><button className="button-secondary" aria-label="Next page" disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}><ChevronRight size={15}/></button></div></footer>
    </section>
    {bulkAction && <div className="modal-backdrop" role="presentation"><form className="panel review-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-review-title" onSubmit={(event)=>{event.preventDefault();void runBulk()}}><div className="section-eyebrow">BULK HR DECISION</div><h2 id="bulk-review-title">{bulkAction==='APPROVE'?'Confirm employee approval':'Reject pending employees'}</h2><p>{bulkMode==='ALL'?`${bulkAction==='APPROVE'?summary.approval_eligible:summary.rejection_eligible} pending employee submission(s) will be processed within ${activeCompanyId==='all'?'all companies where you have permission':companies.find((company)=>company.id===activeCompanyId)?.name??'the selected company'}.`:`This applies only to ${selectedIds.length} selected employee submission(s).`} The database rechecks authorization and validation for each record. Invalid or changed records remain pending.</p>{bulkAction==='REJECT'&&<label className="review-reason-label">Rejection reason<textarea value={bulkReason} onChange={(event)=>setBulkReason(event.target.value)} rows={3} required minLength={3}/></label>}<div className="employee-form-actions"><button type="button" className="button-secondary" disabled={bulkBusy} onClick={()=>setBulkAction(null)}>Cancel</button><button className="button-primary" disabled={bulkBusy||(bulkAction==='REJECT'&&bulkReason.trim().length<3)}>{bulkBusy?'Processing…':bulkAction==='APPROVE'?'Confirm Approve':'Confirm Reject'}</button></div></form></div>}
    {editingImportId && <LiveEmployeeImportStaging approvalRecordId={editingImportId} canApprove={canApprove} onClose={()=>setEditingImportId(null)} onChanged={()=>{setLoading(true);window.dispatchEvent(new CustomEvent("gbhr-employee-approvals-changed"))}} />}
    {rejectingImport && <div className="modal-backdrop" role="presentation"><form className="panel review-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="import-reject-title" onSubmit={(event)=>void rejectImportedRecord(event)}><h2 id="import-reject-title">Reject imported employee</h2><p>{rejectingImport.current_data.first_name} {rejectingImport.current_data.last_name} · {rejectingImport.current_data.employee_number}</p><label className="review-reason-label">Rejection reason<textarea value={importRejectReason} onChange={(event)=>setImportRejectReason(event.target.value)} rows={4} required minLength={3}/></label><div className="employee-form-actions"><button type="button" className="button-secondary" disabled={importDecisionBusy} onClick={()=>setRejectingImport(null)}>Cancel</button><button className="button-primary" disabled={importDecisionBusy||importRejectReason.trim().length<3}>Confirm Reject</button></div></form></div>}
    {target && <div className="modal-backdrop" role="presentation"><form className="panel review-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" onSubmit={(event) => void submitDecision(event)}><div className="section-eyebrow">HR REVIEW</div><h2 id="review-dialog-title">{target.decision === 'RETURN' ? 'Return for correction' : 'Reject submission'}</h2><p>{target.employee.first_name} {target.employee.last_name} · {target.employee.employee_number}</p><label className="review-reason-label">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} autoFocus required minLength={3}/></label><div className="employee-form-actions"><button type="button" className="button-secondary" disabled={!!busyId} onClick={() => setTarget(null)}>Cancel</button><button className="button-primary" disabled={!!busyId}>{busyId ? 'Saving…' : 'Confirm review'}</button></div></form></div>}
    <EmployeeChangeReviewQueue />
  </div>
}

function EmployeeChangeReviewQueue() {
  const { companies, preferences } = useWorkspace()
  const [requests, setRequests] = useState<EmployeeChangeRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRequests(await createLiveBusinessServices(getSupabaseClient()).employees.pendingChangeRequests()); setUnavailable(false) }
    catch { setUnavailable(true); setRequests([]) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const review = async (request: EmployeeChangeRequestRecord, decision: 'APPROVE' | 'RETURN' | 'REJECT') => {
    const reason = decision === 'APPROVE' ? null : window.prompt(decision === 'RETURN' ? 'Reason for returning this change request:' : 'Reason for rejecting this change request:')
    if (decision !== 'APPROVE' && !reason?.trim()) return
    if (decision === 'APPROVE' && !window.confirm(`Approve the requested changes for ${request.first_name} ${request.last_name}?`)) return
    setBusyId(request.id); setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).employees.reviewChangeRequest(request.id, decision, reason?.trim())
      const decisionLabel = { APPROVE: 'approved', RETURN: 'returned', REJECT: 'rejected' }[decision]
      setNotice(`${request.first_name} ${request.last_name}: change request ${decisionLabel}.`)
      await load()
    } catch { setError('The change review was not saved. Verify your review access and that the employee and compensation records have not changed.') }
    finally { setBusyId('') }
  }

  const labels: Record<string, string> = {
    first_name: 'First name', middle_name: 'Middle name', last_name: 'Surname', date_of_birth: 'Date of birth', gender: 'Gender', nationality: 'Nationality',
    residential_address: 'Residential address', phone: 'Phone', email: 'Email', email_unavailable_reason: 'Email unavailable reason',
    emergency_contact_name: 'Emergency contact', emergency_contact_relationship: 'Emergency contact relationship', emergency_contact_phone: 'Emergency contact phone',
    job_title: 'Job title', department: 'Department', contract_type: 'Contract type',
    contract_start_date: 'Contract start', contract_end_date: 'Contract end', effective_from: 'Effective from',
    salary_frequency: 'Pay frequency', basic_pay: 'Basic pay', housing_allowance: 'Housing allowance',
    meal_allowance: 'Meal allowance', transport_allowance: 'Transport allowance', other_allowances: 'Other allowances',
  }
  const renderChanges = (changes: Record<string, unknown>, money: boolean) => Object.entries(changes).flatMap(([key, value]) => {
    if (key === 'private_details' && value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).map(([privateKey, privateValue]) => <span className="employee-change-value" key={`private-${privateKey}`}><strong>{labels[privateKey] ?? privateKey}:</strong> {String(privateValue ?? '—')}</span>)
    }
    return [<span className="employee-change-value" key={key}><strong>{labels[key] ?? key}:</strong> {money && key !== 'effective_from' && key !== 'salary_frequency' && typeof value === 'number' ? `ZMW ${value.toLocaleString('en-ZM', { minimumFractionDigits: 2 })}` : String(value ?? '—')}</span>]
  })

  return <section className="panel employee-history-card employee-change-queue">
    <header><div><div className="section-eyebrow">APPROVED-RECORD CHANGES</div><h2>Change requests awaiting review</h2><p>Requests are visible only within your approved company and branch scope.</p></div></header>
    {unavailable ? <div className="employee-empty"><strong>Change requests are not available yet</strong><span>The approved employee change workflow is unavailable in this workspace.</span></div>
      : loading ? <div className="employee-empty" role="status">Loading change requests…</div>
      : requests.length ? <div className="employee-change-review-list">{requests.map((request) => {
        const company = companies.find((item) => item.id === request.company_id)
        const branch = company?.branches.find((item) => item.id === request.branch_id)
        return <article className="employee-change-review-item" key={request.id}>
          <div><strong>{request.first_name} {request.last_name} <small>{request.employee_number}</small></strong><span>{company?.name ?? 'Authorized company'} · {branch?.name ?? 'Authorized branch'}</span></div>
          <p>Requested {formatWorkspaceDateTime(request.requested_at, preferences)} · {request.reason}</p>
          <div className="employee-change-values">{renderChanges(request.employment_changes, false)}{renderChanges(request.compensation_change, true)}</div>
          {request.has_compensation_change && !Object.keys(request.compensation_change).length && <p>Compensation details require additional permission; this request cannot be reviewed from this account.</p>}
          <div className="approval-actions"><button className="button-primary" disabled={!!busyId || (request.has_compensation_change && !Object.keys(request.compensation_change).length)} onClick={() => void review(request, 'APPROVE')}>Approve</button><button className="button-secondary" disabled={!!busyId} onClick={() => void review(request, 'RETURN')}>Return</button><button className="button-secondary" disabled={!!busyId} onClick={() => void review(request, 'REJECT')}>Reject</button></div>
        </article>
      })}</div> : <div className="employee-empty"><strong>No approved-record changes need review</strong><span>New requests will appear here when authorized users submit them.</span></div>}
    {error && <p role="alert" className="auth-shell-error">{error}</p>}{notice && <p role="status" className="import-success">{notice}</p>}
    {!unavailable && <button className="button-secondary" disabled={loading} onClick={() => void load()}>Refresh requests</button>}
  </section>
}

type OnboardingDraft = {
  companyId: string; branchId: string; employeeNumber: string; firstName: string; middleName: string; lastName: string;
  dateOfBirth: string; gender: string; nationality: string; identityType: 'NRC' | 'PASSPORT' | 'OTHER'; identityNumber: string; address: string; phone: string;
  email: string; unavailableReason: string; emergencyName: string; emergencyRelationship: string; emergencyPhone: string;
  tpin: string; napsaNumber: string; nhimaNumber: string; paymentMethod: 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CASH';
  bankName: string; bankAccountName: string; bankAccountNumber: string; bankBranchName: string;
  mobileMoneyProvider: string; mobileMoneyNumber: string; department: string; jobTitle: string;
  employmentType: 'PERMANENT' | 'FIXED_TERM' | 'PART_TIME' | 'CASUAL' | 'DAILY_RATED';
  contractType: string; startDate: string; endDate: string; retirementAge: string; salaryFrequency: 'MONTHLY' | 'FORTNIGHTLY' | 'WEEKLY' | 'DAILY';
  basicPay: string; housing: string; meal: string; transport: string; other: string; overtime: boolean;
}

const blankOnboarding: OnboardingDraft = {
  companyId: '', branchId: '', employeeNumber: '', firstName: '', middleName: '', lastName: '', dateOfBirth: '', gender: '',
  nationality: '', identityType: 'NRC', identityNumber: '', address: '', phone: '', email: '', unavailableReason: '', emergencyName: '',
  emergencyRelationship: '', emergencyPhone: '', tpin: '', napsaNumber: '', nhimaNumber: '', paymentMethod: 'BANK_TRANSFER',
  bankName: '', bankAccountName: '', bankAccountNumber: '', bankBranchName: '', mobileMoneyProvider: '', mobileMoneyNumber: '',
  department: '', jobTitle: '', employmentType: 'PERMANENT', contractType: 'PERMANENT', startDate: '', endDate: '',
  retirementAge: '65', salaryFrequency: 'MONTHLY', basicPay: '', housing: '0', meal: '0', transport: '0', other: '0', overtime: false,
}

function draftFromCorrection(details: Awaited<ReturnType<ReturnType<typeof createLiveBusinessServices>['employees']['correctionDetails']>>): OnboardingDraft {
  const employee = details.employee
  const personal = details.private_details
  const compensation = details.compensation
  const text = (value: unknown) => value == null ? '' : String(value)
  return {
    ...blankOnboarding,
    companyId: details.company_id,
    branchId: details.branch_id,
    employeeNumber: text(employee.employee_number), firstName: text(employee.first_name), middleName: text(employee.middle_name), lastName: text(employee.last_name),
    dateOfBirth: text(employee.date_of_birth), gender: text(employee.gender), nationality: text(employee.nationality),
    identityType: (text(personal.identity_document_type) || 'NRC') as OnboardingDraft['identityType'], identityNumber: text(personal.identity_document_number),
    address: text(personal.residential_address), phone: text(personal.phone), email: text(personal.email), unavailableReason: text(personal.email_unavailable_reason),
    emergencyName: text(personal.emergency_contact_name), emergencyRelationship: text(personal.emergency_contact_relationship), emergencyPhone: text(personal.emergency_contact_phone),
    tpin: text(personal.tpin), napsaNumber: text(personal.napsa_number), nhimaNumber: text(personal.nhima_number),
    paymentMethod: (text(personal.payment_method) || 'BANK_TRANSFER') as OnboardingDraft['paymentMethod'],
    bankName: text(personal.bank_name), bankAccountName: text(personal.bank_account_name), bankAccountNumber: text(personal.bank_account_number), bankBranchName: text(personal.bank_branch_name),
    mobileMoneyProvider: text(personal.mobile_money_provider), mobileMoneyNumber: text(personal.mobile_money_number),
    department: text(employee.department), jobTitle: text(employee.job_title), employmentType: text(employee.employment_type) as OnboardingDraft['employmentType'],
    contractType: text(employee.contract_type), startDate: text(employee.contract_start_date), endDate: text(employee.contract_end_date), retirementAge: text(employee.retirement_age || 65),
    salaryFrequency: text(compensation.salary_frequency) as OnboardingDraft['salaryFrequency'],
    basicPay: text(compensation.basic_pay), housing: text(compensation.housing_allowance ?? 0), meal: text(compensation.meal_allowance ?? 0),
    transport: text(compensation.transport_allowance ?? 0), other: text(compensation.other_allowances ?? 0), overtime: Boolean(compensation.overtime_eligible),
  }
}

export function LiveEmployeeForm() {
  const { companies, activeCompanyId, setActiveCompany } = useWorkspace()
  const navigate = useNavigate()
  const { employeeId } = useParams<{ employeeId: string }>()
  const [draft, setDraft] = useState<OnboardingDraft>(blankOnboarding)
  const [loadingCorrection, setLoadingCorrection] = useState(Boolean(employeeId))
  const [correctionLoadFailed, setCorrectionLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [allowanceProrationRules, setAllowanceProrationRules] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!employeeId && activeCompanyId !== 'all') setDraft((current) => current.companyId ? current : { ...current, companyId: activeCompanyId })
  }, [activeCompanyId, employeeId])
  useEffect(() => {
    if (!employeeId) return
    let active = true
    void createLiveBusinessServices(getSupabaseClient()).employees.correctionDetails(employeeId)
      .then((details) => { if (active) setDraft(draftFromCorrection(details)) })
      .catch(() => { if (active) { setCorrectionLoadFailed(true); setError('This employee record is unavailable for correction under your current access, or it is no longer awaiting changes.') } })
      .finally(() => { if (active) setLoadingCorrection(false) })
    return () => { active = false }
  }, [employeeId])
  const selectedCompany = companies.find((company) => company.id === draft.companyId)
  const branches = selectedCompany?.branches.filter((branch) => branch.status === 'Active') ?? []
  useEffect(() => {
    if (!draft.companyId) { setDepartments([]); return }
    let active = true
    void createLiveHrServices(getSupabaseClient()).catalog.departments(draft.companyId, false)
      .then((departmentRows) => { if (active) { setDepartments(departmentRows); setCatalogError('') } })
      .catch(() => { if (active) { setDepartments([]); setCatalogError('Department options could not be loaded. Refresh or check your company setup permissions.') } })
    return () => { active = false }
  }, [draft.companyId])

  const update = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!selectedCompany?.portfolioId || !draft.branchId) { setError('Choose an active company and branch with an authorized portfolio before continuing.'); return }
    if (!draft.email.trim() && !draft.unavailableReason.trim()) { setError('Enter an employee email or explain why it is unavailable.'); return }
    if (draft.paymentMethod === 'BANK_TRANSFER' && (!draft.bankName.trim() || !draft.bankAccountName.trim() || !draft.bankAccountNumber.trim())) { setError('Complete the required bank details for bank transfer.'); return }
    if (draft.paymentMethod === 'MOBILE_MONEY' && (!draft.mobileMoneyProvider.trim() || !draft.mobileMoneyNumber.trim())) { setError('Complete the required mobile money details.'); return }

    setBusy(true)
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const input = {
        portfolioId: selectedCompany.portfolioId,
        companyId: selectedCompany.id,
        branchId: draft.branchId,
        employee: {
          employee_number: draft.employeeNumber.trim(), first_name: draft.firstName.trim(), middle_name: draft.middleName.trim(), last_name: draft.lastName.trim(),
          date_of_birth: draft.dateOfBirth, gender: draft.gender, nationality: draft.nationality.trim(), job_title: draft.jobTitle.trim(), department: draft.department.trim(),
          employment_type: draft.employmentType, contract_type: draft.contractType.trim(), contract_start_date: draft.startDate, contract_end_date: draft.endDate,
          retirement_age: Number(draft.retirementAge),
        },
        privateDetails: {
          identity_document_type: draft.identityType, identity_document_number: draft.identityNumber.trim(), residential_address: draft.address.trim(),
          phone: draft.phone.trim(), email: draft.email.trim(), email_unavailable_reason: draft.email ? '' : draft.unavailableReason.trim(),
          emergency_contact_name: draft.emergencyName.trim(), emergency_contact_relationship: draft.emergencyRelationship.trim(), emergency_contact_phone: draft.emergencyPhone.trim(),
          tpin: draft.tpin.trim(), napsa_number: draft.napsaNumber.trim(), nhima_number: draft.nhimaNumber.trim(), payment_method: draft.paymentMethod,
          bank_name: draft.bankName.trim(), bank_account_name: draft.bankAccountName.trim(), bank_account_number: draft.bankAccountNumber.trim(), bank_branch_name: draft.bankBranchName.trim(),
          mobile_money_provider: draft.mobileMoneyProvider.trim(), mobile_money_number: draft.mobileMoneyNumber.trim(),
        },
        compensation: {
          effective_from: draft.startDate, effective_to: '', salary_frequency: draft.salaryFrequency, basic_pay: Number(draft.basicPay),
          housing_allowance: Number(draft.housing || 0), meal_allowance: Number(draft.meal || 0), transport_allowance: Number(draft.transport || 0),
          other_allowances: Number(draft.other || 0), overtime_eligible: draft.overtime, payment_method: draft.paymentMethod,
          allowance_proration_rules: Object.fromEntries(Object.entries(allowanceProrationRules).filter(([, enabled]) => enabled).map(([key]) => [key, 'SCHEDULED_DAYS'])),
        },
      }
      const savedEmployeeId = employeeId
        ? await services.employees.updateDraft(employeeId, input)
        : await services.employees.createDraft(input)
      try {
        await services.employees.submitForHrApproval(savedEmployeeId)
        setNotice(employeeId ? 'Corrections saved and resubmitted for HR approval.' : 'Employee record saved and submitted for HR approval.')
        window.setTimeout(() => navigate('/employees'), 900)
      } catch {
        setNotice(employeeId
          ? 'Corrections were saved, but resubmission failed. The record remains stored and can be resubmitted after resolving access or validation issues.'
          : 'The employee draft was saved, but we could not submit it for HR review. Reload the employee before trying again.')
      }
    } catch {
      setError('Employee record was not saved. Check the selected company, branch, role permissions, and required fields.')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: keyof OnboardingDraft, type = 'text', required = false) => <label className="live-onboarding-field" key={key}><span>{label}{required && <i> *</i>}</span><input type={type} required={required} min={type === 'number' ? key === 'retirementAge' ? 18 : 0 : undefined} max={key === 'retirementAge' ? 100 : undefined} step={type === 'number' ? key === 'retirementAge' ? 1 : 0.01 : undefined} value={String(draft[key])} onChange={(event) => update(key, event.target.value as never)}/></label>

  return <div className="employee-screen live-onboarding"><section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> EMPLOYEE ONBOARDING</div><h1>{employeeId ? 'Correct employee record' : 'Add employee'}</h1><p>{employeeId ? 'Review the returned information, save corrections, and resubmit for HR approval.' : 'Complete the employee details and submit them for HR review.'}</p></div><Link className="button-secondary" to="/employees">Cancel</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Personal and pay details are handled securely. Employee submissions require HR review.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    {loadingCorrection ? <section className="panel employee-empty" role="status">Loading employee correction details…</section> : correctionLoadFailed ? <section className="panel employee-empty"><strong>Correction access unavailable</strong><span>Employee details are hidden because the correction could not be authorized.</span></section> : <form className="panel live-onboarding-form" onSubmit={(event) => void submit(event)}>
      <section><div className="section-eyebrow">01 · ASSIGNMENT</div><div className="live-onboarding-grid"><label className="live-onboarding-field"><span>Company *</span><select required value={draft.companyId} disabled={Boolean(employeeId)} onChange={(event) => { const companyId = event.target.value; setActiveCompany(companyId || 'all'); setDraft((current) => ({ ...current, companyId, branchId: '' })) }}><option value="">Select company</option>{companies.filter((company) => company.status === 'Active').map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="live-onboarding-field"><span>Workplace branch *</span><select required value={draft.branchId} disabled={Boolean(employeeId) || !selectedCompany} onChange={(event) => update('branchId', event.target.value)}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{field('Employee number','employeeNumber','text',true)}</div></section>
      <section><div className="section-eyebrow">02 · PERSONAL DETAILS</div><div className="live-onboarding-grid">{field('First name','firstName','text',true)}{field('Middle name','middleName')}{field('Last name','lastName','text',true)}{field('Date of birth','dateOfBirth','date',true)}<label className="live-onboarding-field"><span>Gender</span><select value={['MALE','FEMALE'].includes(draft.gender.toUpperCase()) ? draft.gender.toUpperCase() : ''} onChange={(event) => update('gender', event.target.value)}><option value="">Select if applicable</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select>{draft.gender && !['MALE','FEMALE'].includes(draft.gender.toUpperCase()) && <small>An existing value is retained unless you select Male or Female.</small>}</label>{field('Nationality','nationality','text',true)}<label className="live-onboarding-field"><span>Identity document type *</span><select value={draft.identityType} onChange={(event) => update('identityType', event.target.value as OnboardingDraft['identityType'])}><option value="NRC">NRC</option><option value="PASSPORT">Passport</option><option value="OTHER">Other</option></select></label>{field('Identity document number','identityNumber','text',true)}{field('Residential address','address','text',true)}{field('Phone number','phone','tel',true)}{field('Email','email','email')}{field('Email unavailable reason','unavailableReason')}{field('Emergency contact','emergencyName','text',true)}{field('Relationship','emergencyRelationship','text',true)}{field('Emergency phone','emergencyPhone','tel',true)}</div></section>
      <section><div className="section-eyebrow">03 · EMPLOYMENT</div>{catalogError && <p className="live-form-hint" role="status">{catalogError}</p>}<div className="live-onboarding-grid"><label className="live-onboarding-field"><span>Department *</span><select required value={draft.department} onChange={(event) => update('department', event.target.value)}><option value="">Select department</option>{draft.department && !departments.some((item) => item.name === draft.department) && <option value={draft.department}>Existing value: {draft.department}</option>}{departments.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>{field('Job title','jobTitle','text',true)}<label className="live-onboarding-field"><span>Employment type *</span><select value={draft.employmentType} onChange={(event) => update('employmentType', event.target.value as OnboardingDraft['employmentType'])}><option value="PERMANENT">Permanent</option><option value="FIXED_TERM">Fixed term</option><option value="PART_TIME">Part time</option><option value="CASUAL">Casual</option><option value="DAILY_RATED">Daily rated</option></select></label>{field('Contract type','contractType','text',true)}{field('Employment start','startDate','date',true)}{field('Contract end','endDate','date',draft.employmentType === 'FIXED_TERM')}{field('Retirement age','retirementAge','number',true)}</div></section>
      <section><div className="section-eyebrow">04 · COMPENSATION</div><div className="live-onboarding-grid"><label className="live-onboarding-field"><span>Salary frequency *</span><select value={draft.salaryFrequency} onChange={(event) => update('salaryFrequency', event.target.value as OnboardingDraft['salaryFrequency'])}><option value="MONTHLY">Monthly</option><option value="FORTNIGHTLY">Fortnightly</option><option value="WEEKLY">Weekly</option><option value="DAILY">Daily</option></select></label>{field('Basic pay (ZMW)','basicPay','number',true)}{field('Housing allowance','housing','number')}{field('Meal allowance','meal','number')}{field('Transport allowance','transport','number')}{field('Other allowances','other','number')}<label className="live-onboarding-check"><input type="checkbox" checked={draft.overtime} onChange={(event) => update('overtime', event.target.checked)}/> Overtime eligible</label><div className="employee-change-proration-rules"><strong>Partial-month allowance treatment</strong><p>Basic salary uses approved scheduled-working days. Select only allowances that should also be prorated.</p>{[['housing_allowance','Housing allowance'],['meal_allowance','Meal allowance'],['transport_allowance','Transport allowance'],['other_allowances','Other allowances']].map(([key,label]) => <label key={key}><input type="checkbox" checked={allowanceProrationRules[key] ?? false} onChange={(event) => setAllowanceProrationRules((current) => ({ ...current, [key]: event.target.checked }))} /> Prorate {label.toLowerCase()} by scheduled days</label>)}</div></div></section>
      <section><div className="section-eyebrow">05 · STATUTORY AND PAYMENT DETAILS</div><div className="live-onboarding-grid">{field('TPIN','tpin')}{field('NAPSA number','napsaNumber')}{field('NHIMA number','nhimaNumber')}<label className="live-onboarding-field"><span>Payment method *</span><select value={draft.paymentMethod} onChange={(event) => update('paymentMethod', event.target.value as OnboardingDraft['paymentMethod'])}><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option><option value="CASH">Cash</option></select></label>{draft.paymentMethod === 'BANK_TRANSFER' && <>{field('Bank name','bankName','text',true)}{field('Account name','bankAccountName','text',true)}{field('Account number','bankAccountNumber','text',true)}{field('Bank branch','bankBranchName')}</>}{draft.paymentMethod === 'MOBILE_MONEY' && <>{field('Mobile money provider','mobileMoneyProvider','text',true)}{field('Mobile money number','mobileMoneyNumber','tel',true)}</>}</div></section>
      <footer className="live-onboarding-footer"><span>{employeeId ? 'Saving corrections preserves the existing branch assignment; payroll eligibility still requires HR approval.' : 'Saving creates a pending employee record. Payroll eligibility follows HR approval.'}</span><button className="button-primary" disabled={busy || companies.length === 0}>{busy ? 'Saving securely…' : employeeId ? 'Save corrections and resubmit' : 'Save and submit for review'}</button></footer>
    </form>}
  </div>
}

