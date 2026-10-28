import { useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type PayrollPreviewInputs, type PayrollTrialSnapshot } from '../../services/live-business-services'
import '../employees/employee-screens.css'
import './live-payroll-inputs.css'

const currentMonth = new Date().toISOString().slice(0, 7)
const monthStart = (month: string) => `${month}-01`
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}
const money = (amount: number | null) => amount === null ? '—' : `K${Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2 })}`

export function LivePayrollInputs() {
  const { companies, activeCompanyId } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [month, setMonth] = useState(currentMonth)
  const [snapshot, setSnapshot] = useState<PayrollPreviewInputs | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [createdRunId, setCreatedRunId] = useState('')
  const [trial, setTrial] = useState<PayrollTrialSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    if (!companyId || !branchId || !month) return
    setBusy(true); setError(''); setNotice(''); setCreatedRunId(''); setTrial(null); setSnapshot(null)
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      setSnapshot(await services.payroll.previewInputs({ companyId, branchId, periodStart: monthStart(month), periodEnd: monthEnd(month) }))
    } catch {
      setError('Inputs could not be loaded. Confirm payroll preparation access and that attendance for these exact dates has HR approval.')
    } finally { setBusy(false) }
  }

  const createDraft = async () => {
    if (!snapshot || snapshot.items.some((item) => item.input_warnings.length)) return
    setCreating(true); setError(''); setNotice('')
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const id = await services.payroll.createDraft({ companyId, branchId, periodStart: monthStart(month), periodEnd: monthEnd(month), frequency: 'MONTHLY', idempotencyKey: crypto.randomUUID() })
      setCreatedRunId(id); setNotice('Draft payroll run saved in Supabase. It has not been calculated or submitted.')
    } catch {
      setError('Draft payroll was not created. Confirm payroll preparation access and review any existing run for this period.')
    } finally { setCreating(false) }
  }

  const calculateTrial = async () => {
    if (!createdRunId) return
    setCalculating(true); setError(''); setNotice(''); setTrial(null)
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const result = await services.payroll.calculateTrial(createdRunId, crypto.randomUUID())
      setTrial(result)
      setNotice('Trial breakdown saved in Supabase. It is not authoritative, payable, submittable, or finalizable.')
    } catch {
      setError('Trial calculation could not be saved. Confirm payroll preparation access and that the draft is still open.')
    } finally { setCalculating(false) }
  }

  return <div className="employee-screen live-payroll-inputs">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>PAYROLL</div><h1>Payroll inputs</h1><p>Review approved employee, attendance, leave and repayment inputs for one company branch.</p></div></section>
    <div className="panel live-inputs-note"><strong>Trial payroll only</strong><span>Approved inputs can be saved as a draft and calculated by a trusted database function. Candidate NAPSA/NHIMA values are unverified estimates. Trial results cannot be submitted, approved, finalized, or used for payment.</span></div>
    <section className="panel live-inputs-filters">
      <label>Company<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId(companies.find((item) => item.id === event.target.value)?.branches[0]?.id ?? ''); setSnapshot(null) }}>
        {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Branch<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSnapshot(null) }}>
        {(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Payroll month<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setSnapshot(null) }} /></label>
      <button className="primary-button" type="button" disabled={busy || !companyId || !branchId} onClick={() => void load()}>{busy ? <RefreshCw size={15} className="spin"/> : <CalendarDays size={15}/>} Load approved inputs</button>
    </section>
    {error && <div className="panel live-inputs-error" role="alert">{error}</div>}
    {notice && <div className="panel live-inputs-note" role="status"><strong>{notice}</strong>{createdRunId && <span>Run reference: {createdRunId}</span>}</div>}
    {snapshot && <>
      <div className="panel live-inputs-summary"><div><small>Approved attendance</small><strong>{new Date(snapshot.attendance_approved_at).toLocaleString()}</strong></div><div><small>Included approved employees</small><strong>{snapshot.items.length}</strong></div><div><small>Input warnings</small><strong>{snapshot.items.reduce((sum, item) => sum + item.input_warnings.length, 0)}</strong></div></div>
      <div className="panel live-inputs-table-wrap"><table className="live-inputs-table"><thead><tr><th>Employee</th><th>Frequency</th><th>Basic pay</th><th>Allowances</th><th>Worked / scheduled</th><th>Paid / unpaid leave</th><th>Approved leave</th><th>Due deductions</th></tr></thead><tbody>
        {snapshot.items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number} · {item.contract_type}</small></td><td>{item.salary_frequency ?? 'Missing'}</td><td>{money(item.basic_pay)}</td><td>{money((item.housing_allowance ?? 0) + (item.meal_allowance ?? 0) + (item.transport_allowance ?? 0) + (item.other_allowances ?? 0))}</td><td>{item.attendance ? `${item.attendance.actual_days_worked} / ${item.attendance.scheduled_working_days}` : 'Missing'}</td><td>{item.attendance ? `${item.attendance.paid_leave_days} / ${item.attendance.unpaid_leave_days}` : 'Missing'}</td><td>{item.approved_leave_requests.length}</td><td>{money(item.due_approved_deductions.reduce((sum, deduction) => sum + Number(deduction.scheduled_amount), 0))}</td></tr>)}
        {snapshot.items.length === 0 && <tr><td colSpan={8} className="empty-row">No approved employees overlap this period.</td></tr>}
      </tbody></table></div>
      {snapshot.items.some((item) => item.input_warnings.length) && <div className="panel live-inputs-error"><strong>Preparation warnings</strong>{snapshot.items.filter((item) => item.input_warnings.length).map((item) => <p key={item.employee_id}>{item.employee_number}: {item.input_warnings.join(', ')}</p>)}</div>}
      <div className="live-inputs-draft-action"><span>Draft creation requires complete compensation and attendance inputs. Trial calculations are persisted separately and never alter payroll items or deduction balances.</span><button className="primary-button" type="button" disabled={creating || !snapshot.items.length || snapshot.items.some((item) => item.input_warnings.length) || Boolean(createdRunId)} onClick={() => void createDraft()}>{creating ? 'Creating draft…' : createdRunId ? 'Draft created' : 'Create draft payroll'}</button></div>
      {createdRunId && <div className="live-inputs-draft-action"><span>Run {createdRunId} · status remains DRAFT</span><button className="primary-button" type="button" disabled={calculating} onClick={() => void calculateTrial()}>{calculating ? 'Calculating trial...' : trial ? 'Recalculate trial' : 'Calculate trial payroll'}</button></div>}
      {trial && <section className="live-trial-results" aria-label="Persisted trial payroll results">
        <div className="panel live-inputs-error"><strong>Not approved for payment</strong><span>This immutable trial snapshot uses candidate statutory amounts. It did not create payroll line items, post repayments, or change the run from DRAFT.</span><ul>{trial.blockers.map((blocker) => <li key={blocker}>{blocker.replaceAll('_', ' ').toLowerCase()}</li>)}</ul></div>
        <div className="panel live-inputs-summary"><div><small>Gross candidate</small><strong>{money(trial.totals.gross_pay_candidate)}</strong></div><div><small>PAYE candidate</small><strong>{money(trial.totals.paye_candidate)}</strong></div><div><small>Employee statutory candidates</small><strong>{money(trial.totals.napsa_employee_candidate + trial.totals.nhima_employee_candidate)}</strong></div><div><small>Candidate net · not payable</small><strong>{money(trial.totals.candidate_net_pay)}</strong></div></div>
        <div className="panel live-inputs-table-wrap"><table className="live-inputs-table"><thead><tr><th>Employee</th><th>Basic</th><th>Allowances</th><th>Gross candidate</th><th>PAYE</th><th>NAPSA employee</th><th>NHIMA employee</th><th>Other deductions</th><th>Candidate net</th></tr></thead><tbody>
          {trial.items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number}</small>{item.blockers.length > 0 && <small className="live-trial-row-warning">{item.blockers.map((warning) => warning.replaceAll('_', ' ').toLowerCase()).join('; ')}</small>}</td><td>{money(item.basic_pay)}</td><td>{money((item.housing_allowance ?? 0) + (item.meal_allowance ?? 0) + (item.transport_allowance ?? 0) + (item.other_allowances ?? 0))}</td><td>{money(item.gross_pay)}</td><td>{money(item.paye_candidate)}</td><td>{money(item.napsa_employee_candidate)}</td><td>{money(item.nhima_employee_candidate)}</td><td>{money(item.approved_other_deductions)}</td><td>{money(item.candidate_net_pay)}</td></tr>)}
          {trial.items.length === 0 && <tr><td colSpan={9} className="empty-row">No approved employees were included in the trial.</td></tr>}
        </tbody></table></div>
        <p className="live-trial-footnote">Rounding uses PostgreSQL numeric amounts rounded to cents. ZRA 2026 ordinary bands are published values; NAPSA and NHIMA estimates are explicitly unverified. This trial is not a paysheet or payment instruction.</p>
      </section>}
    </>}
  </div>
}
