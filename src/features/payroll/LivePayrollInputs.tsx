import { useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type PayrollPreviewInputs } from '../../services/live-business-services'
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
  const [error, setError] = useState('')

  const load = async () => {
    if (!companyId || !branchId || !month) return
    setBusy(true); setError(''); setSnapshot(null)
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      setSnapshot(await services.payroll.previewInputs({ companyId, branchId, periodStart: monthStart(month), periodEnd: monthEnd(month) }))
    } catch {
      setError('Inputs could not be loaded. Confirm payroll preparation access and that attendance for these exact dates has HR approval.')
    } finally { setBusy(false) }
  }

  return <div className="employee-screen live-payroll-inputs">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>PAYROLL</div><h1>Payroll inputs</h1><p>Review approved employee, attendance, leave and repayment inputs for one company branch.</p></div></section>
    <div className="panel live-inputs-note"><strong>Input preview only</strong><span>This reads approved Supabase records. It does not calculate, save, submit, approve or finalize payroll. Leave requests are shown as supporting detail; attendance totals remain the single source for payable and unpaid leave days.</span></div>
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
    {snapshot && <>
      <div className="panel live-inputs-summary"><div><small>Approved attendance</small><strong>{new Date(snapshot.attendance_approved_at).toLocaleString()}</strong></div><div><small>Included approved employees</small><strong>{snapshot.items.length}</strong></div><div><small>Input warnings</small><strong>{snapshot.items.reduce((sum, item) => sum + item.input_warnings.length, 0)}</strong></div></div>
      <div className="panel live-inputs-table-wrap"><table className="live-inputs-table"><thead><tr><th>Employee</th><th>Frequency</th><th>Basic pay</th><th>Allowances</th><th>Worked / scheduled</th><th>Paid / unpaid leave</th><th>Approved leave</th><th>Due deductions</th></tr></thead><tbody>
        {snapshot.items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number} · {item.contract_type}</small></td><td>{item.salary_frequency ?? 'Missing'}</td><td>{money(item.basic_pay)}</td><td>{money((item.housing_allowance ?? 0) + (item.meal_allowance ?? 0) + (item.transport_allowance ?? 0) + (item.other_allowances ?? 0))}</td><td>{item.attendance ? `${item.attendance.actual_days_worked} / ${item.attendance.scheduled_working_days}` : 'Missing'}</td><td>{item.attendance ? `${item.attendance.paid_leave_days} / ${item.attendance.unpaid_leave_days}` : 'Missing'}</td><td>{item.approved_leave_requests.length}</td><td>{money(item.due_approved_deductions.reduce((sum, deduction) => sum + Number(deduction.scheduled_amount), 0))}</td></tr>)}
        {snapshot.items.length === 0 && <tr><td colSpan={8} className="empty-row">No approved employees overlap this period.</td></tr>}
      </tbody></table></div>
      {snapshot.items.some((item) => item.input_warnings.length) && <div className="panel live-inputs-error"><strong>Preparation warnings</strong>{snapshot.items.filter((item) => item.input_warnings.length).map((item) => <p key={item.employee_id}>{item.employee_number}: {item.input_warnings.join(', ')}</p>)}</div>}
    </>}
  </div>
}
