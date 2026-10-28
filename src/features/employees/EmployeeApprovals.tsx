import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, RotateCcw, Search, ShieldCheck, UserRoundX } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { useEmployees } from './EmployeeContext'
import { reviewEmployee } from './employee-workflow'
import type { EmployeeReviewAction } from './employee-workflow'
import type { Employee } from './types'

export function EmployeeApprovals() {
  const { companies } = useWorkspace()
  const { employees, saveEmployee } = useEmployees()
  const [query, setQuery] = useState('')
  const [reviewTarget, setReviewTarget] = useState<{ employee: Employee; action: Exclude<EmployeeReviewAction, 'APPROVED'> } | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useMemo(() => employees.filter((employee) => employee.approvalStatus === 'SUBMITTED_FOR_HR_APPROVAL' && `${employee.firstName} ${employee.lastName} ${employee.employeeNumber}`.toLowerCase().includes(query.toLowerCase())), [employees, query])
  const returned = useMemo(() => employees.filter((employee) => employee.approvalStatus === 'RETURNED_FOR_CORRECTION'), [employees])

  const approve = (employee: Employee) => {
    saveEmployee(reviewEmployee(employee, 'APPROVED', 'Demo HR reviewer'))
    setNotice(`${employee.firstName} ${employee.lastName} marked approved in this demo session.`)
  }

  const submitReason = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reviewTarget) return
    try {
      saveEmployee(reviewEmployee(reviewTarget.employee, reviewTarget.action, 'Demo HR reviewer', reason))
      setNotice(`${reviewTarget.employee.firstName} ${reviewTarget.employee.lastName} updated in this demo session.`)
      setReviewTarget(null)
      setReason('')
      setError('')
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Add a reason before continuing.')
    }
  }

  return <div className="employee-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>HR REVIEW QUEUE</div><h1>Employee approvals</h1><p>Review synthetic employee submissions before they become payroll-eligible.</p></div></section>
    <div className="import-warning"><ShieldCheck size={16}/><span><strong>Demo workflow only.</strong> These review actions are local simulations and are not connected to authenticated roles or backend authorization.</span></div>
    <section className="panel employee-directory-panel">
      <div className="employee-toolbar"><div><strong>{pending.length} awaiting review</strong></div><label className="employee-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pending employees..."/></label></div>
      {pending.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>JOB DETAILS</th><th>SUBMITTED</th><th>REVIEW</th></tr></thead><tbody>{pending.map((employee) => {
        const company = companies.find((item) => item.id === employee.companyId)
        const branch = company?.branches.find((item) => item.id === employee.branchId)
        return <tr key={employee.id}><td><strong>{employee.firstName} {employee.middleName ? `${employee.middleName} ` : ''}{employee.lastName}</strong><small>{employee.employeeNumber}</small></td><td><strong>{company?.name ?? 'Unknown company'}</strong><small>{branch?.name ?? 'Unknown branch'}</small></td><td><strong>{employee.jobTitle}</strong><small>{employee.department}</small></td><td>{employee.submittedAt ? new Date(employee.submittedAt).toLocaleDateString() : 'Demo session'}</td><td><div className="approval-actions"><button className="button-primary" onClick={() => approve(employee)} aria-label={`Approve ${employee.firstName} ${employee.lastName}`}><Check size={14}/> Approve</button><button className="button-secondary" onClick={() => { setReviewTarget({ employee, action: 'RETURNED_FOR_CORRECTION' }); setReason(''); setError('') }} aria-label={`Return ${employee.firstName} ${employee.lastName}`}><RotateCcw size={14}/> Return</button><button className="button-secondary" onClick={() => { setReviewTarget({ employee, action: 'REJECTED' }); setReason(''); setError('') }} aria-label={`Reject ${employee.firstName} ${employee.lastName}`}><UserRoundX size={14}/> Reject</button></div></td></tr>
      })}</tbody></table></div> : <div className="employee-empty"><Check size={21}/><strong>No submissions need review</strong><span>New synthetic employee submissions will appear here.</span></div>}
    </section>
    {returned.length > 0 && <section className="panel employee-directory-panel"><div className="panel-heading compact"><div><div className="section-eyebrow">NEEDS CORRECTION</div><h2>Returned employee records</h2></div><span>{returned.length} records</span></div><div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>HR NOTE</th><th>ASSIGNMENT</th><th>ACTION</th></tr></thead><tbody>{returned.map((employee) => <tr key={employee.id}><td><strong>{employee.firstName} {employee.lastName}</strong><small>{employee.employeeNumber}</small></td><td>{employee.rejectionReason}</td><td>{companies.find((item) => item.id === employee.companyId)?.name ?? 'Unknown company'}<small>{companies.flatMap((item) => item.branches).find((item) => item.id === employee.branchId)?.name ?? 'Unknown branch'}</small></td><td><Link className="button-secondary" to={`/employees/${employee.id}/correct`}>Correct and resubmit</Link></td></tr>)}</tbody></table></div></section>}
    <div className="synthetic-stamp"><span>✳</span> Synthetic employee records · Reviewer: Demo HR reviewer</div>
    {notice && <div className="employee-toast" role="status">{notice}</div>}
    {reviewTarget && <div className="employee-modal-backdrop"><section className="employee-modal" role="dialog" aria-modal="true" aria-labelledby="employee-review-title"><header><h2 id="employee-review-title">{reviewTarget.action === 'REJECTED' ? 'Reject employee submission' : 'Return for correction'}</h2></header><form onSubmit={submitReason}><p>{reviewTarget.employee.firstName} {reviewTarget.employee.lastName} · {reviewTarget.employee.employeeNumber}</p><label className="review-reason">Reason<textarea autoFocus required value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Describe what needs attention"/></label>{error && <small className="field-error" role="alert">{error}</small>}<div className="employee-modal-actions"><button type="button" className="button-secondary" onClick={() => setReviewTarget(null)}>Cancel</button><button className="button-primary">Confirm {reviewTarget.action === 'REJECTED' ? 'rejection' : 'return'}</button></div></form></section></div>}
  </div>
}

