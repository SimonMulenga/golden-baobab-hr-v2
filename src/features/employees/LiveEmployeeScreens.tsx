import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, History, RotateCcw, Search, ShieldCheck, UserRoundX } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord, type EmployeeReviewDecision, type EmploymentHistoryRecord } from '../../services/live-business-services'
import './live-employee-screens.css'

const PAGE_SIZE = 25

export function LiveEmployeeDirectory() {
  const { companies } = useWorkspace()
  const [records, setRecords] = useState<EmployeeDirectoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).employees.list({ page, pageSize: PAGE_SIZE, search })
      if (generation !== requestGeneration.current) return
      setRecords(result.items)
      setTotal(result.total)
    } catch {
      if (generation === requestGeneration.current) setError('Employee records could not be loaded. Check your access and try again.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [page, search])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); requestGeneration.current += 1 } }, [load])

  return <div className="employee-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> LIVE EMPLOYEE RECORDS</div><h1>Employees</h1><p>Employee directory records visible to your authenticated account.</p></div><div className="live-employee-actions"><Link className="button-secondary" to="/employee-approvals">Review submissions</Link><Link className="button-primary" to="/employees/new">Add employee</Link></div></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Personal identity, contact, banking, and compensation details are not included in this directory view.</div>
    <section className="panel employee-directory-panel">
      <div className="employee-toolbar"><div><strong>{total} employees</strong><small>Read through Supabase row-level access policies</small></div><label className="employee-search"><Search size={15}/><input value={search} onChange={(event) => { setLoading(true); setError(''); setSearch(event.target.value); setPage(1) }} placeholder="Search last name..." aria-label="Search employees"/></label></div>
      {error && <div className="auth-shell-error" role="alert">{error} <button className="button-secondary" onClick={() => { setLoading(true); setError(''); void load() }}>Retry</button></div>}
      {loading ? <div className="employee-empty" role="status">Loading authorized employee recordsâ€¦</div> : records.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>ROLE</th><th>CONTRACT</th><th>STATUS</th></tr></thead><tbody>{records.map((record) => {
        const company = companies.find((item) => item.id === record.company_id)
        const branch = company?.branches.find((item) => item.id === record.workplace_branch_id)
        return <tr key={record.id}><td><Link className="employee-profile-link" to={`/employees/${record.id}`}><strong>{record.first_name} {record.middle_name ? `${record.middle_name} ` : ''}{record.last_name}</strong><small>{record.employee_number}</small></Link></td><td><strong>{company?.name ?? 'Authorized company'}</strong><small>{branch?.name ?? 'Authorized branch'}</small></td><td><strong>{record.job_title}</strong><small>{record.department}</small></td><td><strong>{record.employment_type}</strong><small>{record.contract_type}</small></td><td><span className={`approval-status status-${record.approval_status.toLowerCase().replaceAll('_', '-')}`}>{record.approval_status.replaceAll('_', ' ')}</span>{['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(record.approval_status) && <Link className="employee-correction-link" to={`/employees/${record.id}/correct`}>{record.approval_status === 'DRAFT' ? 'Edit draft' : 'Correct and resubmit'}</Link>}</td></tr>
      })}</tbody></table></div> : <div className="employee-empty"><strong>No employee records found</strong><span>Records appear here after a permitted onboarding workflow stores them.</span></div>}
      <footer className="employee-pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div><button className="button-secondary" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}><ChevronLeft size={15}/></button><button className="button-secondary" aria-label="Next page" disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}><ChevronRight size={15}/></button></div></footer>
    </section>
  </div>
}

export function LiveEmployeeProfile() {
  const { employeeId = '' } = useParams<{ employeeId: string }>()
  const { companies } = useWorkspace()
  const [loadedProfile, setLoadedProfile] = useState<{ id: string; employee: EmployeeDirectoryRecord; history: Awaited<ReturnType<ReturnType<typeof createLiveBusinessServices>['employees']['history']>>; employmentHistory: EmploymentHistoryRecord[] } | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ id: string; message: string } | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [statusError, setStatusError] = useState('')
  const [statusNotice, setStatusNotice] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)

  useEffect(() => {
    let active = true
    const service = createLiveBusinessServices(getSupabaseClient()).employees
    void Promise.all([service.byId(employeeId), service.history(employeeId), service.employmentHistory(employeeId)])
      .then(([record, events, employmentHistory]) => { if (active) setLoadedProfile({ id: employeeId, employee: record, history: events, employmentHistory }) })
      .catch(() => { if (active) setLoadFailure({ id: employeeId, message: 'This employee profile or its history is unavailable under your current company and branch access.' }) })
    return () => { active = false }
  }, [employeeId])

  const loading = loadedProfile?.id !== employeeId && loadFailure?.id !== employeeId
  if (loading) return <section className="panel employee-empty" role="status">Loading authorized employee profileâ€¦</section>
  if (loadFailure?.id === employeeId || loadedProfile?.id !== employeeId) return <div className="employee-screen"><div className="auth-shell-error" role="alert">{loadFailure?.id === employeeId ? loadFailure.message : 'Employee profile could not be found.'}</div><Link className="button-secondary" to="/employees">Return to employee directory</Link></div>

  const { employee, history, employmentHistory } = loadedProfile

  const company = companies.find((item) => item.id === employee.company_id)
  const branch = company?.branches.find((item) => item.id === employee.workplace_branch_id)
  const changeEmploymentStatus = async (status: EmployeeDirectoryRecord['employment_status']) => {
    setStatusError(''); setStatusNotice('')
    if (!statusReason.trim()) { setStatusError('Enter a reason for this employment status change.'); return }
    setStatusBusy(true)
    try {
      const service = createLiveBusinessServices(getSupabaseClient()).employees
      await service.setEmploymentStatus(employee.id, status, statusReason.trim())
      const [updated, updatedHistory] = await Promise.all([service.byId(employee.id), service.employmentHistory(employee.id)])
      setLoadedProfile((current) => current?.id === employeeId ? { ...current, employee: updated, employmentHistory: updatedHistory } : current)
      setStatusReason(''); setStatusNotice('Employment status and audit history were updated.');
    } catch { setStatusError('Status was not changed. Verify your role, reason, and current employee state, then retry.') }
    finally { setStatusBusy(false) }
  }
  return <div className="employee-screen"><section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> AUTHORIZED EMPLOYEE RECORD</div><h1>{employee.first_name} {employee.middle_name ? `${employee.middle_name} ` : ''}{employee.last_name}</h1><p>{employee.employee_number} Â· {employee.job_title} Â· {employee.department}</p></div><div className="live-employee-actions"><Link className="button-secondary" to="/employees">Directory</Link>{['DRAFT', 'RETURNED_FOR_CORRECTION'].includes(employee.approval_status) && <Link className="button-primary" to={`/employees/${employee.id}/correct`}>{employee.approval_status === 'DRAFT' ? 'Edit draft' : 'Correct and resubmit'}</Link>}</div></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Profile fields and approval history are read through Supabase RLS. Private identifiers, banking details and compensation are intentionally excluded from this profile view.</div>
    <section className="employee-profile-grid"><article className="panel employee-profile-card"><div className="section-eyebrow">EMPLOYMENT</div><dl><div><dt>Company</dt><dd>{company?.name ?? 'Authorized company'}</dd></div><div><dt>Workplace branch</dt><dd>{branch?.name ?? 'Authorized branch'}</dd></div><div><dt>Employee number</dt><dd>{employee.employee_number}</dd></div><div><dt>Position</dt><dd>{employee.job_title}</dd></div><div><dt>Department</dt><dd>{employee.department}</dd></div><div><dt>Employment type</dt><dd>{employee.employment_type.replaceAll('_', ' ')}</dd></div><div><dt>Contract type</dt><dd>{employee.contract_type}</dd></div><div><dt>Start date</dt><dd>{employee.contract_start_date}</dd></div><div><dt>Contract end</dt><dd>{employee.contract_end_date ?? 'Not specified'}</dd></div><div><dt>Approval workflow</dt><dd><span className={`approval-status status-${employee.approval_status.toLowerCase().replaceAll('_', '-')}`}>{employee.approval_status.replaceAll('_', ' ')}</span></dd></div><div><dt>Employment status</dt><dd><span className={`approval-status status-${employee.employment_status.toLowerCase()}`}>{employee.employment_status}</span></dd></div><div><dt>Retirement age setting</dt><dd>{employee.retirement_age} years Â· {employee.retirement_status.replaceAll('_', ' ')}</dd></div><div><dt>Record created</dt><dd>{new Date(employee.created_at).toLocaleString()}</dd></div></dl>
      {employee.approval_status === 'APPROVED' && employee.employment_status !== 'TERMINATED' && <div className="employee-status-editor"><h3>Employment status</h3><p>Changes require an authorized role and are recorded in the database audit history. Termination cannot be reversed through this screen.</p><label>Reason<input value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={500} placeholder="Document the reason for this change" /></label><div className="live-employee-actions">{employee.employment_status !== 'ACTIVE' && <button className="button-secondary" disabled={statusBusy} onClick={() => void changeEmploymentStatus('ACTIVE')}>Reactivate</button>}{employee.employment_status !== 'SUSPENDED' && <button className="button-secondary" disabled={statusBusy} onClick={() => void changeEmploymentStatus('SUSPENDED')}>Suspend</button>}<button className="button-secondary" disabled={statusBusy} onClick={() => { if (window.confirm('Terminate this employee? This action is permanent in the current workflow.')) void changeEmploymentStatus('TERMINATED') }}><UserRoundX size={14}/> Terminate</button></div>{statusError && <div className="auth-shell-error" role="alert">{statusError}</div>}{statusNotice && <div className="import-success" role="status">{statusNotice}</div>}</div>}
      {employmentHistory.length > 0 && <div className="employee-history-card"><header><div className="section-eyebrow">EMPLOYMENT STATUS HISTORY</div></header><ol>{employmentHistory.map((event) => <li key={event.id}><span className="employee-history-dot"/><div><strong>{event.previous_status} â†’ {event.new_status}</strong><small>{new Date(event.occurred_at).toLocaleString()} Â· {event.actor_id.slice(0, 8)}â€¦</small><p>{event.reason}</p></div></li>)}</ol></div>}
      </article><article className="panel employee-history-card"><header><div className="section-eyebrow">REVIEW AND CHANGE HISTORY</div><History size={18}/></header>{history.length ? <ol>{history.map((event) => <li key={event.id}><span className="employee-history-dot"/><div><strong>{event.action.replaceAll('_', ' ')}</strong><small>{new Date(event.occurred_at).toLocaleString()} Â· {event.actor_id.slice(0, 8)}â€¦</small>{event.reason && <p>{event.reason}</p>}</div></li>)}</ol> : <div className="employee-empty">No history events are visible yet.</div>}</article></section>
  </div>
}

type ReviewTarget = { employee: EmployeeDirectoryRecord; decision: EmployeeReviewDecision }

export function LiveEmployeeApprovals() {
  const { companies } = useWorkspace()
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
  const requestGeneration = useRef(0)

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).employees.list({ page, pageSize: PAGE_SIZE, search, approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' })
      if (generation !== requestGeneration.current) return
      setRecords(result.items)
      setTotal(result.total)
    } catch {
      if (generation === requestGeneration.current) setError('Employee submissions could not be loaded. Check your access and try again.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }, [page, search])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => { window.clearTimeout(timer); requestGeneration.current += 1 } }, [load])

  const review = async (employee: EmployeeDirectoryRecord, decision: EmployeeReviewDecision, reviewReason?: string) => {
    setBusyId(employee.id)
    setError('')
    setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).employees.reviewSubmission(employee.id, decision, reviewReason)
      setNotice(`${employee.first_name} ${employee.last_name}: ${decision.toLowerCase()} action saved.`)
      setTarget(null)
      setReason('')
      setLoading(true)
      await load()
    } catch {
      setError('The review was not saved. Your role, branch access, or submission status may not permit this action.')
    } finally {
      setBusyId('')
    }
  }

  const submitDecision = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!target) return
    if (reason.trim().length < 3) { setError('Enter a short review reason before returning or rejecting this record.'); return }
    await review(target.employee, target.decision, reason.trim())
  }

  return <div className="employee-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> HR REVIEW QUEUE</div><h1>Employee approvals</h1><p>Review submitted employee records. Database permissions determine which actions are allowed.</p></div><Link className="button-secondary" to="/employees">Employee directory</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Approval and rejection requests are checked by trusted Supabase workflows; hiding a control is not the security boundary.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    <section className="panel employee-directory-panel">
      <div className="employee-toolbar"><div><strong>{total} awaiting HR review</strong><small>Only submissions visible under your database permissions are listed</small></div><label className="employee-search"><Search size={15}/><input value={search} onChange={(event) => { setLoading(true); setError(''); setSearch(event.target.value); setPage(1) }} placeholder="Search last name..." aria-label="Search pending employees"/></label></div>
      {loading ? <div className="employee-empty" role="status">Loading submissionsâ€¦</div> : records.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>POSITION</th><th>SUBMITTED</th><th>REVIEW</th></tr></thead><tbody>{records.map((employee) => {
        const company = companies.find((item) => item.id === employee.company_id)
        const branch = company?.branches.find((item) => item.id === employee.workplace_branch_id)
        return <tr key={employee.id}><td><strong>{employee.first_name} {employee.last_name}</strong><small>{employee.employee_number}</small></td><td><strong>{company?.name ?? 'Authorized company'}</strong><small>{branch?.name ?? 'Authorized branch'}</small></td><td><strong>{employee.job_title}</strong><small>{employee.department}</small></td><td>{employee.submitted_at ? new Date(employee.submitted_at).toLocaleDateString() : 'â€”'}</td><td><div className="approval-actions"><button className="button-primary" disabled={!!busyId} onClick={() => void review(employee, 'APPROVE')} aria-label={`Approve ${employee.first_name} ${employee.last_name}`}><Check size={14}/> Approve</button><button className="button-secondary" disabled={!!busyId} onClick={() => { setTarget({ employee, decision: 'RETURN' }); setReason(''); setError('') }}><RotateCcw size={14}/> Return</button><button className="button-secondary" disabled={!!busyId} onClick={() => { setTarget({ employee, decision: 'REJECT' }); setReason(''); setError('') }}><UserRoundX size={14}/> Reject</button></div></td></tr>
      })}</tbody></table></div> : <div className="employee-empty"><Check size={21}/><strong>No submissions need review</strong><span>New submissions will appear here when an authorized user submits them.</span></div>}
      <footer className="employee-pagination"><span>Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div><button className="button-secondary" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => Math.max(1, value - 1)) }}><ChevronLeft size={15}/></button><button className="button-secondary" aria-label="Next page" disabled={page >= Math.max(1, Math.ceil(total / PAGE_SIZE)) || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}><ChevronRight size={15}/></button></div></footer>
    </section>
    {target && <div className="modal-backdrop" role="presentation"><form className="panel review-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" onSubmit={(event) => void submitDecision(event)}><div className="section-eyebrow">HR REVIEW</div><h2 id="review-dialog-title">{target.decision === 'RETURN' ? 'Return for correction' : 'Reject submission'}</h2><p>{target.employee.first_name} {target.employee.last_name} Â· {target.employee.employee_number}</p><label className="review-reason-label">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} autoFocus required minLength={3}/></label><div className="employee-form-actions"><button type="button" className="button-secondary" disabled={!!busyId} onClick={() => setTarget(null)}>Cancel</button><button className="button-primary" disabled={!!busyId}>{busyId ? 'Savingâ€¦' : 'Confirm review'}</button></div></form></div>}
  </div>
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
  const { companies } = useWorkspace()
  const navigate = useNavigate()
  const { employeeId } = useParams<{ employeeId: string }>()
  const [draft, setDraft] = useState<OnboardingDraft>(blankOnboarding)
  const [loadingCorrection, setLoadingCorrection] = useState(Boolean(employeeId))
  const [correctionLoadFailed, setCorrectionLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
          : 'Employee draft was saved, but submission for HR approval failed. The draft remains stored and was not replaced with demo data.')
      }
    } catch {
      setError('Employee record was not saved. Check the selected company, branch, role permissions, and required fields.')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: keyof OnboardingDraft, type = 'text', required = false) => <label className="live-onboarding-field" key={key}><span>{label}{required && <i> *</i>}</span><input type={type} required={required} min={type === 'number' ? key === 'retirementAge' ? 18 : 0 : undefined} max={key === 'retirementAge' ? 100 : undefined} step={type === 'number' ? key === 'retirementAge' ? 1 : 0.01 : undefined} value={String(draft[key])} onChange={(event) => update(key, event.target.value as never)}/></label>

  return <div className="employee-screen live-onboarding"><section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> LIVE EMPLOYEE ONBOARDING</div><h1>{employeeId ? 'Correct employee record' : 'Add employee'}</h1><p>{employeeId ? 'Review the returned information, save corrections, and resubmit for HR approval.' : 'Required information is sent to Supabase over an authorized onboarding workflow.'}</p></div><Link className="button-secondary" to="/employees">Cancel</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Personal details and compensation are submitted directly to the database. They are not cached in browser storage. A branch submission remains subject to HR review.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="import-success" role="status">{notice}</div>}
    {loadingCorrection ? <section className="panel employee-empty" role="status">Loading authorized employee correction detailsâ€¦</section> : correctionLoadFailed ? <section className="panel employee-empty"><strong>Correction access unavailable</strong><span>Employee details are hidden because the correction could not be authorized.</span></section> : <form className="panel live-onboarding-form" onSubmit={(event) => void submit(event)}>
      <section><div className="section-eyebrow">01 Â· ASSIGNMENT</div><div className="live-onboarding-grid"><label className="live-onboarding-field"><span>Company *</span><select required value={draft.companyId} disabled={Boolean(employeeId)} onChange={(event) => setDraft((current) => ({ ...current, companyId: event.target.value, branchId: '' }))}><option value="">Select company</option>{companies.filter((company) => company.status === 'Active').map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="live-onboarding-field"><span>Workplace branch *</span><select required value={draft.branchId} disabled={Boolean(employeeId) || !selectedCompany} onChange={(event) => update('branchId', event.target.value)}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>{field('Employee number','employeeNumber','text',true)}</div></section>
      <section><div className="section-eyebrow">02 Â· PERSONAL DETAILS</div><div className="live-onboarding-grid">{field('First name','firstName','text',true)}{field('Middle name','middleName')}{field('Last name','lastName','text',true)}{field('Date of birth','dateOfBirth','date',true)}<label className="live-onboarding-field"><span>Gender</span><select value={draft.gender} onChange={(event) => update('gender', event.target.value)}><option value="">Select if applicable</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="NON_BINARY">Non-binary</option><option value="UNDISCLOSED">Undisclosed</option></select></label>{field('Nationality','nationality','text',true)}<label className="live-onboarding-field"><span>Identity document type *</span><select value={draft.identityType} onChange={(event) => update('identityType', event.target.value as OnboardingDraft['identityType'])}><option value="NRC">NRC</option><option value="PASSPORT">Passport</option><option value="OTHER">Other</option></select></label>{field('Identity document number','identityNumber','text',true)}{field('Residential address','address','text',true)}{field('Phone number','phone','tel',true)}{field('Email','email','email')}{field('Email unavailable reason','unavailableReason')}{field('Emergency contact','emergencyName','text',true)}{field('Relationship','emergencyRelationship','text',true)}{field('Emergency phone','emergencyPhone','tel',true)}</div></section>
      <section><div className="section-eyebrow">03 Â· EMPLOYMENT</div><div className="live-onboarding-grid">{field('Job title','jobTitle','text',true)}{field('Department','department','text',true)}<label className="live-onboarding-field"><span>Employment type *</span><select value={draft.employmentType} onChange={(event) => update('employmentType', event.target.value as OnboardingDraft['employmentType'])}><option value="PERMANENT">Permanent</option><option value="FIXED_TERM">Fixed term</option><option value="PART_TIME">Part time</option><option value="CASUAL">Casual</option><option value="DAILY_RATED">Daily rated</option></select></label>{field('Contract type','contractType','text',true)}{field('Employment start','startDate','date',true)}{field('Contract end','endDate','date',draft.employmentType === 'FIXED_TERM')}{field('Retirement age','retirementAge','number',true)}</div></section>
      <section><div className="section-eyebrow">04 Â· COMPENSATION</div><div className="live-onboarding-grid"><label className="live-onboarding-field"><span>Salary frequency *</span><select value={draft.salaryFrequency} onChange={(event) => update('salaryFrequency', event.target.value as OnboardingDraft['salaryFrequency'])}><option value="MONTHLY">Monthly</option><option value="FORTNIGHTLY">Fortnightly</option><option value="WEEKLY">Weekly</option><option value="DAILY">Daily</option></select></label>{field('Basic pay (ZMW)','basicPay','number',true)}{field('Housing allowance','housing','number')}{field('Meal allowance','meal','number')}{field('Transport allowance','transport','number')}{field('Other allowances','other','number')}<label className="live-onboarding-check"><input type="checkbox" checked={draft.overtime} onChange={(event) => update('overtime', event.target.checked)}/> Overtime eligible</label></div></section>
      <section><div className="section-eyebrow">05 Â· STATUTORY AND PAYMENT DETAILS</div><div className="live-onboarding-grid">{field('TPIN','tpin')}{field('NAPSA number','napsaNumber')}{field('NHIMA number','nhimaNumber')}<label className="live-onboarding-field"><span>Payment method *</span><select value={draft.paymentMethod} onChange={(event) => update('paymentMethod', event.target.value as OnboardingDraft['paymentMethod'])}><option value="BANK_TRANSFER">Bank transfer</option><option value="MOBILE_MONEY">Mobile money</option><option value="CASH">Cash</option></select></label>{draft.paymentMethod === 'BANK_TRANSFER' && <>{field('Bank name','bankName','text',true)}{field('Account name','bankAccountName','text',true)}{field('Account number','bankAccountNumber','text',true)}{field('Bank branch','bankBranchName')}</>}{draft.paymentMethod === 'MOBILE_MONEY' && <>{field('Mobile money provider','mobileMoneyProvider','text',true)}{field('Mobile money number','mobileMoneyNumber','tel',true)}</>}</div></section>
      <footer className="live-onboarding-footer"><span>{employeeId ? 'Saving corrections preserves the existing branch assignment; payroll eligibility still requires HR approval.' : 'Saving creates a pending employee record. Payroll eligibility follows HR approval.'}</span><button className="button-primary" disabled={busy || companies.length === 0}>{busy ? 'Saving securelyâ€¦' : employeeId ? 'Save corrections and resubmit' : 'Save and submit for review'}</button></footer>
    </form>}
  </div>
}


