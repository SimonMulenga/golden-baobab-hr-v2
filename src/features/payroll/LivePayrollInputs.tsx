import { useEffect, useState } from 'react'
import { Check, CircleDollarSign, Download, FileCheck2, RefreshCw, Send } from 'lucide-react'
import { formatWorkspaceDate, formatWorkspaceDateTime, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type PayrollCalculationHistoryEntry, type PayrollCalculationSnapshot, type PayrollEarningInputRecord, type PayrollPreviewInputs, type PayrollPayoutInstructions, type PayrollRunRecord, type PayrollReviewAction, type PayrollPreviewItem } from '../../services/live-business-services'
import '../employees/employee-screens.css'
import './live-payroll-inputs.css'
import { estimateOvertime, type OvertimeDayType, type OvertimeDivisor } from './overtime-calculation'
import { payrollInputLoadGuidance, payrollWarningGuidance } from './payroll-input-guidance'

const currentMonth = new Date().toISOString().slice(0, 7)
const monthStart = (month: string) => `${month}-01`
const monthEnd = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}
const money = (amount: number | null | undefined) => amount == null ? '—' : `K${Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const csvCell = (value: unknown) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function LivePayrollInputs() {
  const { companies, preferences } = useWorkspace()
  const { companyId, company, setCompanyId } = useCompanySelection()
  const [branchId, setBranchId] = useState(company?.branches[0]?.id ?? '')
  const [month, setMonth] = useState(currentMonth)
  const [inputs, setInputs] = useState<PayrollPreviewInputs | null>(null)
  const [earningInputs, setEarningInputs] = useState<PayrollEarningInputRecord[]>([])
  const [earningType, setEarningType] = useState<PayrollEarningInputRecord['earning_type']>('OVERTIME')
  const [earningEmployeeId, setEarningEmployeeId] = useState('')
  const [earningAmount, setEarningAmount] = useState('')
  const [earningTaxable, setEarningTaxable] = useState(true)
  const [earningSource, setEarningSource] = useState('')
  const [earningDescription, setEarningDescription] = useState('')
  const [overtimeHours, setOvertimeHours] = useState('')
  const [overtimeDate, setOvertimeDate] = useState('')
  const [overtimeWeekStart, setOvertimeWeekStart] = useState('')
  const [overtimeWeeklyHours, setOvertimeWeeklyHours] = useState('')
  const [overtimeDayType, setOvertimeDayType] = useState<OvertimeDayType>('ORDINARY')
  const [overtimeDivisors, setOvertimeDivisors] = useState<Record<string, OvertimeDivisor>>({})
  const [overtimeOutsideNormalWeek, setOvertimeOutsideNormalWeek] = useState(false)
  const [unpaidMethods, setUnpaidMethods] = useState<Record<string, PayrollPreviewItem['unpaid_leave_deduction_method']>>({})
  const [runs, setRuns] = useState<PayrollRunRecord[]>([])
  const [runTotal, setRunTotal] = useState(0)
  const [runPage, setRunPage] = useState(1)
  const [runStatusFilter, setRunStatusFilter] = useState('')
  const [run, setRun] = useState<PayrollRunRecord | null>(null)
  const [calculation, setCalculation] = useState<PayrollCalculationSnapshot | null>(null)
  const [history, setHistory] = useState<PayrollCalculationHistoryEntry[]>([])
  const [payout, setPayout] = useState<PayrollPayoutInstructions | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (company?.branches.some((item) => item.id === branchId)) return
    setBranchId(company?.branches[0]?.id ?? '')
  }, [companyId, company, branchId])

  const services = () => createLiveBusinessServices(getSupabaseClient())
  const refreshRuns = async () => {
    if (!companyId || !branchId) return
    try {
      const result = await services().payroll.list({ companyId, branchId, page: runPage, pageSize: 25, status: runStatusFilter || undefined })
      setRuns(result.items)
      setRunTotal(result.total)
    } catch {
      setError('Payroll run history could not be loaded for the selected branch permissions.')
    }
  }
  const selectRun = async (id: string) => {
    setError(''); setNotice(''); setPayout(null)
    try {
      const api = services()
      const selected = await api.payroll.byId(id)
      setRun(selected)
      setCalculation((selected.calculations?.status === 'CALCULATED' ? selected.calculations : null) as PayrollCalculationSnapshot | null)
      setHistory(await api.payroll.listCalculationHistory(id))
    } catch {
      setError('Payroll run details could not be loaded. Check your access and try again.')
    }
  }
  const load = async () => {
    if (!companyId || !branchId || !month) return
    setBusy(true); setError(''); setNotice(''); setInputs(null); setRun(null); setCalculation(null); setPayout(null)
    try {
      const api = services()
      const result = await api.payroll.previewInputs({ companyId, branchId, periodStart: monthStart(month), periodEnd: monthEnd(month) })
      setInputs(result)
      setEarningInputs(result.earning_inputs ?? [])
      setOvertimeDivisors(Object.fromEntries(result.items.map((item) => [item.employee_id, item.overtime_monthly_hours_divisor ?? 208])))
      setUnpaidMethods(Object.fromEntries(result.items.map((item) => [item.employee_id, item.unpaid_leave_deduction_method ?? 'BLOCK'])))
    await refreshRuns()
    } catch (loadError) {
      setError(payrollInputLoadGuidance(loadError))
    } finally { setBusy(false) }
  }
  const createEarning = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!earningEmployeeId) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      if (earningType === 'OVERTIME') {
        if (!overtimeDate || !overtimeWeekStart || Number(overtimeHours) <= 0 ||
          (overtimeDayType === 'ORDINARY' && Number(overtimeWeeklyHours) <= (overtimeDivisors[earningEmployeeId] === 240 ? 60 : 48)) ||
          ((overtimeDayType !== 'ORDINARY') && !overtimeOutsideNormalWeek)) return
        await services().payroll.createOvertimeInput({ companyId, branchId, employeeId: earningEmployeeId,
          periodStart: monthStart(month), periodEnd: monthEnd(month), workDate: overtimeDate, weekStart: overtimeWeekStart,
          hours: Number(overtimeHours), dayType: overtimeDayType, weeklyHours: Number(overtimeWeeklyHours || 0),
          outsideNormalWorkWeek: overtimeOutsideNormalWeek, sourceReference: earningSource.trim(),
          description: earningDescription.trim(), idempotencyKey: crypto.randomUUID() })
      } else {
        if (!Number.isFinite(Number(earningAmount)) || Number(earningAmount) <= 0) return
        await services().payroll.createEarningInput({ companyId, branchId, employeeId: earningEmployeeId,
          periodStart: monthStart(month), periodEnd: monthEnd(month), earningType: earningType,
          amount: Number(earningAmount), taxableForPaye: earningTaxable, sourceReference: earningSource.trim(),
          description: earningDescription.trim(), idempotencyKey: crypto.randomUUID() })
      }
      setEarningAmount(''); setEarningSource(''); setEarningDescription('')
      setOvertimeHours(''); setOvertimeWeeklyHours(''); setOvertimeOutsideNormalWeek(false)
      await load()
      setNotice('Earning input submitted for separate HR approval; it is not included in payroll until approved.')
    } catch { setError('Earning input was not saved. Check the employee scope, amount, source reference and payroll input permissions.') }
    finally { setTransitioning(false) }
  }
  const reviewEarning = async (input: PayrollEarningInputRecord, decision: 'APPROVE' | 'REJECT') => {
    const reason = decision === 'REJECT' ? window.prompt('Reason for rejecting this payroll earning')?.trim() : undefined
    if (decision === 'REJECT' && !reason) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.reviewEarningInput(input.id, decision, reason)
      await load()
      setNotice(`Earning input ${decision.toLowerCase()}d. Reload payroll inputs before calculating.`)
    } catch { setError('Earning review was denied or failed. The server requires a different authorized payroll approver.') }
    finally { setTransitioning(false) }
  }
  const saveUnpaidMethod = async (item: PayrollPreviewInputs['items'][number]) => {
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.setUnpaidLeaveMethod(item.employee_id, monthStart(month), unpaidMethods[item.employee_id] ?? 'BLOCK')
      await load()
      setNotice('Unpaid-leave formula saved as a new effective compensation version and recorded in audit history.')
    } catch { setError('Unpaid-leave method was not saved. An existing payroll run, missing compensation permission, or invalid effective date may prevent this change.') }
    finally { setTransitioning(false) }
  }
  const saveOvertimeDivisor = async (item: PayrollPreviewInputs['items'][number]) => {
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.setOvertimeDivisor(item.employee_id, monthStart(month), overtimeDivisors[item.employee_id] ?? 208)
      await load()
      setNotice('Overtime divisor saved as an effective-dated compensation setting and added to audit history.')
    } catch { setError('Overtime schedule was not saved. Confirm compensation.edit access and check that this payroll period is still open.') }
    finally { setTransitioning(false) }
  }
  const createDraft = async () => {
    if (!inputs || !inputs.items.length || inputs.items.some((item) => item.input_warnings.length)) return
    setCreating(true); setError(''); setNotice('')
    try {
      const id = await services().payroll.createDraft({ companyId, branchId, periodStart: monthStart(month), periodEnd: monthEnd(month), frequency: 'MONTHLY', idempotencyKey: crypto.randomUUID() })
      await refreshRuns()
      await selectRun(id)
      setNotice('Payroll draft saved. Calculate it to create the employee payroll lines.')
    } catch {
      setError('Draft payroll was not created. Confirm payroll preparation access and check for an existing run for these dates.')
    } finally { setCreating(false) }
  }
  const calculate = async () => {
    if (!run) return
    setCalculating(true); setError(''); setNotice(''); setPayout(null)
    try {
      const api = services()
      const result = await api.payroll.calculate(run.id, crypto.randomUUID())
      setCalculation(result)
      setRun(await api.payroll.byId(run.id))
      setHistory(await api.payroll.listCalculationHistory(run.id))
      await refreshRuns()
      setNotice(`Calculation version ${result.payroll_run_version} is persisted and ready for submission.`)
    } catch {
      setError('Calculation was blocked or failed. Check payroll scope, approved inputs, supported monthly rules, and employee net-pay limits. No partial payroll items were committed.')
    } finally { setCalculating(false) }
  }
  const submit = async () => {
    if (!run) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.submitForApproval(run.id)
      await selectRun(run.id); await refreshRuns()
      setNotice('Payroll submitted. A different authorized reviewer must review this version.')
    } catch { setError('Submission was denied or failed. Confirm this user created the run and the calculated version is still open.') }
    finally { setTransitioning(false) }
  }
  const review = async (action: PayrollReviewAction, reason?: string) => {
    if (!run) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.reviewSubmission(run.id, action, run.version, reason)
      await selectRun(run.id); await refreshRuns()
      setNotice(action === 'START_REVIEW' ? 'Review started for this exact payroll version.' : `Payroll ${action.toLowerCase().replaceAll('_', ' ')} recorded.`)
    } catch { setError('Review action was denied or failed. The server enforces separation of duties, role permissions and version matching.') }
    finally { setTransitioning(false) }
  }
  const finalize = async () => {
    if (!run || !window.confirm('Finalize this approved payroll version? This posts approved deduction installments once and locks the payroll.')) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      await services().payroll.finalize(run.id)
      await selectRun(run.id); await refreshRuns()
      setNotice('Payroll finalized. Approved repayments were posted atomically. No funds were transferred.')
    } catch { setError('Finalization was denied or failed. The server requires the approved version, verified effective rules and eligible deduction schedules.') }
    finally { setTransitioning(false) }
  }
  const preparePayout = async () => {
    if (!run) return
    setTransitioning(true); setError(''); setNotice('')
    try {
      const result = await services().payroll.preparePayoutInstructions(run.id)
      setPayout(result)
      setNotice(`Payout instruction batch ${result.export_id} is prepared and audited. It has not been sent to a bank or mobile-money provider.`)
    } catch { setError('Payout instructions could not be prepared. Confirm the payroll is finalized and payment details are complete.') }
    finally { setTransitioning(false) }
  }
  const downloadPayoutCsv = () => {
    if (!payout) return
    const headers = ['Employee number','Employee name','Net pay (ZMW)','Payment method','Bank','Account name','Account number','Bank branch','Mobile money provider','Mobile money number']
    const rows = payout.instructions.map((item) => [item.employee_number,item.employee_name,item.net_pay.toFixed(2),item.payment_method,item.bank_name,item.bank_account_name,item.bank_account_number,item.bank_branch_name,item.mobile_money_provider,item.mobile_money_number])
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `payout-instructions-${payout.payroll_run_id}.csv`; anchor.click(); URL.revokeObjectURL(url)
  }

  const safeReset = (nextCompany: string, nextBranch: string) => {
    setCompanyId(nextCompany); setBranchId(nextBranch); setInputs(null); setRuns([]); setRunTotal(0); setRunPage(1); setRun(null); setCalculation(null); setHistory([]); setPayout(null); setError(''); setNotice('')
  }

  return <div className="employee-screen live-payroll-inputs">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>PAYROLL</div><h1>Payroll</h1><p>Prepare, calculate, submit, approve and finalize authorized monthly payroll.</p></div></section>
    <div className="panel live-inputs-note"><strong>2026 rules and payout controls</strong><span>The configured 2026 PAYE, NAPSA and NHIMA rules are source-reviewed and versioned. Live calculations run in PostgreSQL using approved HR inputs. Actual bank and mobile-money transfers are not connected: payout output is an auditable instruction file only.</span></div>
    <section className="panel live-inputs-filters">
      <label>Company<select value={companyId} onChange={(event) => { const next = companies.find((item) => item.id === event.target.value); safeReset(event.target.value, next?.branches[0]?.id ?? '') }}>
        {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Branch<select value={branchId} onChange={(event) => safeReset(companyId, event.target.value)}>
        {(company?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Payroll month<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setInputs(null); setRun(null); setCalculation(null); setPayout(null) }} /></label>
      <button className="primary-button" type="button" disabled={busy || !companyId || !branchId} onClick={() => void load()}>{busy ? <RefreshCw size={15} className="spin"/> : <FileCheck2 size={15}/>} Load approved inputs</button>
    </section>
    {error && <div className="panel live-inputs-error" role="alert">{error}</div>}
    {notice && <div className="panel live-inputs-note" role="status"><strong>{notice}</strong>{run && <span>Run reference: {run.id} · {run.status} · version {run.version}</span>}</div>}
    {inputs && <>
      <div className="panel live-inputs-summary"><div><small>Approved attendance</small><strong>{formatWorkspaceDateTime(inputs.attendance_approved_at, preferences)}</strong></div><div><small>Approved employees</small><strong>{inputs.items.length}</strong></div><div><small>Input warnings</small><strong>{inputs.items.reduce((sum, item) => sum + item.input_warnings.length, 0)}</strong></div></div>
      <div className="panel live-inputs-table-wrap"><table className="live-inputs-table"><thead><tr><th>Employee</th><th>Frequency</th><th>Basic pay</th><th>Allowances</th><th>Worked / scheduled</th><th>Paid / unpaid leave</th><th>Overtime divisor</th><th>Unpaid-leave rule</th><th>Due deductions</th></tr></thead><tbody>
        {inputs.items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number} · {item.contract_type}</small></td><td>{item.salary_frequency ?? 'Missing'}</td><td>{money(item.basic_pay)}</td><td>{money((item.housing_allowance ?? 0) + (item.meal_allowance ?? 0) + (item.transport_allowance ?? 0) + (item.other_allowances ?? 0))}</td><td>{item.attendance ? `${item.attendance.actual_days_worked} / ${item.attendance.scheduled_working_days}` : 'Missing'}</td><td>{item.attendance ? `${item.attendance.paid_leave_days} / ${item.attendance.unpaid_leave_days}` : 'Missing'}</td><td><select aria-label={`Overtime divisor for ${item.employee_number}`} value={overtimeDivisors[item.employee_id] ?? 208} onChange={(event) => setOvertimeDivisors((current) => ({ ...current, [item.employee_id]: Number(event.target.value) as OvertimeDivisor }))}><option value={208}>208 · Act full-time</option><option value={176}>176 · five-day schedule</option><option value={240}>240 · watchperson/guard</option></select><button className="secondary-button" type="button" disabled={transitioning} onClick={() => void saveOvertimeDivisor(item)}>Save overtime basis</button></td><td><select aria-label={`Unpaid leave rule for ${item.employee_number}`} value={unpaidMethods[item.employee_id] ?? 'BLOCK'} onChange={(event) => setUnpaidMethods((current) => ({ ...current, [item.employee_id]: event.target.value as PayrollPreviewItem['unpaid_leave_deduction_method'] }))}><option value="BLOCK">HR review required</option><option value="BASIC_PER_SCHEDULED_WORKDAY">Basic / scheduled day</option><option value="GROSS_PER_SCHEDULED_WORKDAY">Recurring gross / scheduled day</option></select><button className="secondary-button" type="button" disabled={transitioning || !item.attendance?.unpaid_leave_days} onClick={() => void saveUnpaidMethod(item)}>Save rule</button></td><td>{money(item.due_approved_deductions.reduce((sum, deduction) => sum + Number(deduction.scheduled_amount), 0))}</td></tr>)}
        {inputs.items.length === 0 && <tr><td colSpan={9} className="empty-row">No payroll inputs are available. Approve employee onboarding and ensure each employee has active status, a compensation record covering the full period and an approved attendance entry.</td></tr>}
      </tbody></table></div>
      <section className="panel live-payroll-earnings"><header><div><div className="section-eyebrow">PERIOD EARNINGS</div><h2>Overtime, bonus and other earnings</h2><p>Overtime is valued on monthly basic pay in PostgreSQL. Ordinary hours start after 48 hours (60 for watchpersons); rest-day and public-holiday work qualifies at double time only outside the normal working week.</p></div></header>
        <form className="live-earning-form" onSubmit={(event) => void createEarning(event)}>
          <label>Employee<select required value={earningEmployeeId} onChange={(event) => setEarningEmployeeId(event.target.value)}><option value="">Select employee</option>{inputs.items.map((item) => <option key={item.employee_id} value={item.employee_id}>{item.employee_number} · {item.employee_name}</option>)}</select></label>
          <label>Type<select value={earningType} onChange={(event) => setEarningType(event.target.value as PayrollEarningInputRecord['earning_type'])}><option value="OVERTIME">Overtime</option><option value="BONUS">Bonus</option><option value="COMMISSION">Commission</option><option value="OTHER_EARNING">Other earnings</option></select></label>
          {earningType === 'OVERTIME' ? <>
            <label>Work date<input type="date" required min={monthStart(month)} max={monthEnd(month)} value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)}/></label>
            <label>Week starting<input type="date" required value={overtimeWeekStart} onChange={(event) => setOvertimeWeekStart(event.target.value)}/></label>
            <label>Overtime category<select value={overtimeDayType} onChange={(event) => setOvertimeDayType(event.target.value as OvertimeDayType)}><option value="ORDINARY">Ordinary day · 150%</option><option value="REST_DAY">Weekly rest day · 200%</option><option value="PUBLIC_HOLIDAY">Public holiday · 200%</option></select></label>
            <label>Overtime hours<input required type="number" min="0.01" max="168" step="0.01" value={overtimeHours} onChange={(event) => setOvertimeHours(event.target.value)}/></label>
            <label>Total hours worked this week<input required type="number" min={overtimeDayType === 'ORDINARY' ? ((overtimeDivisors[earningEmployeeId] ?? 208) === 240 ? 60.01 : 48.01) : Number(overtimeHours) || 0.01} max="168" step="0.01" value={overtimeWeeklyHours} onChange={(event) => setOvertimeWeeklyHours(event.target.value)}/></label>
            <div className="live-inputs-note"><strong>Effective divisor: {overtimeDivisors[earningEmployeeId] ?? 208} hours</strong><span>Set and save each employee’s overtime basis above. The stored calculation uses that effective compensation version, not a browser-supplied divisor.</span></div>
            {overtimeDayType !== 'ORDINARY' && <label className="live-earning-taxable"><input type="checkbox" checked={overtimeOutsideNormalWeek} onChange={(event) => setOvertimeOutsideNormalWeek(event.target.checked)}/> Confirm work was outside the employee’s normal working week</label>}
            {(() => { const employee = inputs.items.find((item) => item.employee_id === earningEmployeeId); const divisor = overtimeDivisors[earningEmployeeId] ?? 208; const estimate = employee?.basic_pay == null || !overtimeHours ? null : estimateOvertime(employee.basic_pay, Number(overtimeHours), divisor, overtimeDayType); return estimate ? <div className="live-inputs-note"><strong>Estimate: {money(estimate.amount)} · hourly basis {money(estimate.hourlyRate)}</strong><span>Basic {money(employee?.basic_pay)} ÷ {divisor} hours × {estimate.multiplier.toFixed(2)} × {overtimeHours}. PostgreSQL calculates the stored value without rounding the intermediate hourly rate; the preview is informational.</span></div> : null })()}
          </> : <label>Approved amount (ZMW)<input required inputMode="decimal" value={earningAmount} onChange={(event) => setEarningAmount(event.target.value.replace(/[^\d.]/g,''))}/></label>}
          <label>Source reference<input required value={earningSource} onChange={(event) => setEarningSource(event.target.value)} placeholder="Approved timesheet or bonus reference"/></label>
          <label>Description<input required value={earningDescription} onChange={(event) => setEarningDescription(event.target.value)} maxLength={500}/></label>
          {earningType !== 'OVERTIME' && <label className="live-earning-taxable"><input type="checkbox" checked={earningTaxable} onChange={(event) => setEarningTaxable(event.target.checked)}/> Taxable for PAYE</label>}
          <button className="primary-button" disabled={transitioning || !inputs.items.length || (earningType === 'OVERTIME' && !inputs.items.find((item) => item.employee_id === earningEmployeeId)?.overtime_eligible)}>Submit for HR approval</button>
        </form>
        <div className="live-earning-list">{earningInputs.length ? earningInputs.map((entry) => <article key={entry.id}><div><strong>{entry.employee_number} · {entry.employee_name}</strong><span>{entry.earning_type.replaceAll('_',' ')} · {money(entry.amount)} · {entry.taxable_for_paye ? 'PAYE taxable' : 'not PAYE taxable'}</span>{entry.earning_type === 'OVERTIME' && <small>{entry.overtime_hours} hours · {entry.overtime_day_type?.replaceAll('_',' ')} · {entry.overtime_hourly_divisor} monthly hours · {entry.overtime_multiplier}× · {entry.overtime_work_date}</small>}<small>{entry.source_reference} · {entry.description}</small></div><span className={`approval-status status-${entry.status.toLowerCase()}`}>{entry.status}</span>{entry.status === 'SUBMITTED' && <div className="approval-actions"><button className="secondary-button" type="button" disabled={transitioning} onClick={() => void reviewEarning(entry,'APPROVE')}>Approve</button><button className="secondary-button" type="button" disabled={transitioning} onClick={() => void reviewEarning(entry,'REJECT')}>Reject</button></div>}</article>) : <p>No earnings adjustments recorded for this payroll period.</p>}</div>
      </section>
      {inputs.items.some((item) => item.input_warnings.length) && <div className="panel live-inputs-error"><strong>Preparation warnings</strong>{inputs.items.filter((item) => item.input_warnings.length).map((item) => <div key={item.employee_id}><strong>{item.employee_number}</strong><ul>{item.input_warnings.map((warning) => <li key={warning}>{payrollWarningGuidance(warning)}</li>)}</ul></div>)}</div>}
      <div className="live-inputs-draft-action"><span>Only approved employees, attendance, reconciled leave, approved variable earnings and approved deductions are included. Unpaid leave uses an explicit effective compensation rule; unresolved warnings block calculation.</span><button className="primary-button" type="button" disabled={creating || !inputs.items.length || inputs.items.some((item) => item.input_warnings.length)} onClick={() => void createDraft()}>{creating ? 'Creating draft…' : 'Create or open draft payroll'}</button></div>
    </>}

    <section className="panel payroll-live-runs"><header><div><div className="section-eyebrow">PERSISTENT PAYROLL RUNS</div><h2>Runs for this company and branch</h2></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshRuns()}>Refresh runs</button></header>
      <div className="payroll-run-filters"><label>Status<select aria-label="Filter payroll runs by status" value={runStatusFilter} onChange={(event) => { setRunStatusFilter(event.target.value); setRunPage(1); void services().payroll.list({ companyId, branchId, page: 1, pageSize: 25, status: event.target.value || undefined }).then((result) => { setRuns(result.items); setRunTotal(result.total) }).catch(() => setError('Payroll run history could not be loaded for the selected branch permissions.')) }}><option value="">All statuses</option>{['DRAFT','CALCULATED','SUBMITTED_FOR_APPROVAL','UNDER_REVIEW','RETURNED_FOR_CORRECTION','APPROVED','FINALIZED','REJECTED'].map((status) => <option key={status} value={status}>{status.replaceAll('_',' ')}</option>)}</select></label><span>{runTotal.toLocaleString()} runs · page {runPage} of {Math.max(1, Math.ceil(runTotal / 25))}</span></div>
      {runs.length ? <div className="payroll-live-run-list">{runs.map((item) => <button type="button" key={item.id} className={`payroll-live-run ${run?.id === item.id ? 'selected' : ''}`} onClick={() => void selectRun(item.id)}><span><strong>{item.status.replaceAll('_',' ')}</strong><small>{item.id.slice(0,8)} · Created {formatWorkspaceDate(item.created_at, preferences)}</small></span><span>v{item.version}</span></button>)}</div> : <p className="payroll-live-empty">{runStatusFilter ? 'No payroll runs match this status for the selected branch.' : 'Load approved inputs to see the authorized payroll runs for the selected branch.'}</p>}
      <footer className="payroll-run-pagination"><button className="secondary-button" disabled={runPage <= 1 || busy} onClick={() => { const nextPage = runPage - 1; setRunPage(nextPage); void services().payroll.list({ companyId, branchId, page: nextPage, pageSize: 25, status: runStatusFilter || undefined }).then((result) => { setRuns(result.items); setRunTotal(result.total) }).catch(() => setError('Payroll run history could not be loaded for the selected branch permissions.')) }}>Previous</button><button className="secondary-button" disabled={runPage >= Math.ceil(runTotal / 25) || busy} onClick={() => { const nextPage = runPage + 1; setRunPage(nextPage); void services().payroll.list({ companyId, branchId, page: nextPage, pageSize: 25, status: runStatusFilter || undefined }).then((result) => { setRuns(result.items); setRunTotal(result.total) }).catch(() => setError('Payroll run history could not be loaded for the selected branch permissions.')) }}>Next</button></footer>
    </section>

    {run && <section className="panel payroll-live-selected"><header><div><div className="section-eyebrow">{run.status.replaceAll('_',' ')}</div><h2>Payroll run</h2><p>{run.id} · calculation version {run.version}</p></div>{['DRAFT','CALCULATED','RETURNED_FOR_CORRECTION'].includes(run.status) && <button className="primary-button" type="button" disabled={calculating} onClick={() => void calculate()}>{calculating ? 'Calculating…' : calculation ? 'Recalculate payroll' : 'Calculate payroll'}</button>}</header>
      {calculation && <>
        <div className="panel live-inputs-summary payroll-live-totals"><div><small>Employees</small><strong>{calculation.totals.employee_count}</strong></div><div><small>Gross pay</small><strong>{money(calculation.totals.gross_earnings)}</strong></div><div><small>PAYE</small><strong>{money(calculation.totals.paye)}</strong></div><div><small>Employee NAPSA</small><strong>{money(calculation.totals.napsa_employee)}</strong></div><div><small>Employer NAPSA</small><strong>{money(calculation.totals.napsa_employer)}</strong></div><div><small>Employee NHIMA</small><strong>{money(calculation.totals.nhima_employee)}</strong></div><div><small>Employer NHIMA</small><strong>{money(calculation.totals.nhima_employer)}</strong></div><div><small>Net pay</small><strong>{money(calculation.totals.net_pay)}</strong></div><div><small>Total employer cost</small><strong>{money(calculation.totals.total_employer_cost)}</strong></div></div>
        <div className="panel live-inputs-table-wrap"><table className="live-inputs-table"><thead><tr><th>Employee</th><th>Basic (adjusted)</th><th>Taxable allowances</th><th>Overtime</th><th>Bonus / other earnings</th><th>Gross</th><th>Taxable income</th><th>PAYE</th><th>NAPSA EE / ER</th><th>NHIMA EE / ER</th><th>Unpaid-leave adjustment</th><th>Approved deductions</th><th>Net pay</th><th>Employer cost</th></tr></thead><tbody>{calculation.items.map((item) => <tr key={item.employee_id}><td><strong>{item.employee_name}</strong><small>{item.employee_number}</small></td><td>{money(item.basic_salary)}</td><td>{money(item.taxable_allowances)}</td><td>{money(item.overtime)}</td><td>{money(item.bonuses_and_other_earnings)}</td><td>{money(item.gross_earnings)}</td><td>{money(item.paye_taxable_income)}</td><td>{money(item.paye)}</td><td>{money(item.napsa_employee)} / {money(item.napsa_employer)}</td><td>{money(item.nhima_employee)} / {money(item.nhima_employer)}</td><td>{money(item.attendance_deduction)}</td><td>{money(item.other_approved_deductions)}</td><td>{money(item.net_pay)}</td><td>{money(item.total_employer_cost)}</td></tr>)}</tbody></table></div>
        <p className="live-trial-footnote">Rule version {calculation.calculation_rule_version_id} · source status {calculation.source_verification_status} · {calculation.rounding}.</p>
        <div className="payroll-live-actions">
          {run.status === 'CALCULATED' && <button className="primary-button" disabled={transitioning} onClick={() => void submit()}><Send size={14}/> Submit for approval</button>}
          {run.status === 'SUBMITTED_FOR_APPROVAL' && <button className="primary-button" disabled={transitioning} onClick={() => void review('START_REVIEW')}><FileCheck2 size={14}/> Start review</button>}
          {run.status === 'UNDER_REVIEW' && <><button className="primary-button" disabled={transitioning} onClick={() => void review('APPROVE')}><Check size={14}/> Approve version {run.version}</button><button className="secondary-button" disabled={transitioning} onClick={() => { const reason = window.prompt('Reason for returning this payroll for correction'); if (reason?.trim()) void review('RETURN', reason) }}>Return for correction</button><button className="secondary-button" disabled={transitioning} onClick={() => { const reason = window.prompt('Reason for rejecting this payroll'); if (reason?.trim()) void review('REJECT', reason) }}>Reject</button></>}
          {run.status === 'APPROVED' && <button className="primary-button" disabled={transitioning} onClick={() => void finalize()}><Check size={14}/> Finalize approved version</button>}
          {run.status === 'FINALIZED' && <button className="primary-button" disabled={transitioning} onClick={() => void preparePayout()}><CircleDollarSign size={14}/> Prepare payout instructions</button>}
        </div>
        <section className="live-trial-history"><h3>Calculation history</h3>{history.length ? <ol>{history.map((entry) => <li key={entry.id}><time>{formatWorkspaceDateTime(entry.created_at, preferences)}</time><span>{entry.calculation_version} · version {entry.payroll_version}</span><small>Rule {entry.calculation_rule_version_id}</small></li>)}</ol> : <p>No persisted calculations yet.</p>}</section>
      </>}
      {!calculation && <p className="payroll-live-empty">This run has no calculated payroll version yet.</p>}
    </section>}

    {payout && <section className="panel payroll-live-payout"><header><div><div className="section-eyebrow">INSTRUCTIONS PREPARED · NOT TRANSMITTED</div><h2>Payout batch</h2><p>{payout.instructions.length} recipients · manifest {payout.manifest_sha256.slice(0,16)}…</p></div><button className="primary-button" onClick={downloadPayoutCsv}><Download size={14}/> Download bank instruction CSV</button></header><p>The CSV contains sensitive payment details. Store and transmit it only through your organization's approved banking channel. Golden Baobab HR has not sent funds or contacted a payment provider.</p></section>}
  </div>
}
