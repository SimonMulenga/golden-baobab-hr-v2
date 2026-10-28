import { useMemo, useState } from 'react'
import { Check, CircleHelp, Plus, ShieldCheck } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { useEmployees } from '../employees/EmployeeContext'
import { isPayrollEligible } from '../employees/employee-workflow'
import { usePayroll, type DemoPayrollRun } from './PayrollContext'
import { calculateZambiaIllustrativePayroll } from './zambia-payroll'
import { summarizeMonthlyAttendance } from '../people-ops/monthly-attendance'
import './payroll-screens.css'

const money = (cents: number) => `ZMW ${(cents / 100).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const periodDate = (period: string) => `${period}-01`
const payPeriodOptions = ['2026-10', '2026-11', '2026-12', '2027-01']
const demoBranchAssignments = ['br-kitwe']
const periodLabel = (value: string) => new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const cents = (value: number) => Math.round(value * 100)
const nowIso = () => new Date().toISOString()
function attendanceSnapshot(period: string, scheduledCount: number, workedCount: number) {
  const [year, month] = period.split('-').map(Number)
  const monthLength = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const scheduledDates = Array.from({ length: Math.min(scheduledCount, monthLength) }, (_, index) => new Date(Date.UTC(year, month - 1, index + 1)).toISOString().slice(0, 10))
  const entries = scheduledDates.slice(0, Math.min(workedCount, scheduledDates.length)).map((date) => ({ date, status: 'WORKED' as const }))
  return { scheduledDates, entries }
}

export function IntegratedPayrollScreen() {
  const { companies, activeCompanyId } = useWorkspace()
  const { employees } = useEmployees()
  const { deductions, runs, saveRun, finalizeRun } = usePayroll()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? '' : activeCompanyId)
  const [branchId, setBranchId] = useState('all')
  const [period, setPeriod] = useState('2026-11')
  const [role, setRole] = useState<'BRANCH_MANAGER' | 'OVERALL_HR_MANAGER'>('OVERALL_HR_MANAGER')
  const [scheduledDays, setScheduledDays] = useState(22)
  const [actualDays, setActualDays] = useState(22)
  const [unpaidAdjustment, setUnpaidAdjustment] = useState('0.00')
  const [notice, setNotice] = useState('')
  const selectedCompany = companies.find((item) => item.id === companyId)
  const scoped = useMemo(() => employees.filter((item) => item.companyId === companyId && (branchId === 'all' || item.branchId === branchId) && (role !== 'BRANCH_MANAGER' || demoBranchAssignments.includes(item.branchId)) && item.salaryFrequency.toLowerCase() === 'monthly' && isPayrollEligible(item)), [employees, companyId, branchId, role])
  const totals = useMemo(() => scoped.reduce((acc, employee) => {
    const monthly = employee.salaryFrequency.toLowerCase() === 'monthly'
    const basic = cents(monthly ? employee.basicSalary : 0)
    const attendance = attendanceSnapshot(period, scheduledDays, actualDays)
    const summary = summarizeMonthlyAttendance({ contract: employee.contractType === 'Fixed term' ? 'FIXED_TERM_MONTHLY' : 'MONTHLY_SALARIED', scheduledDates: attendance.scheduledDates, entries: attendance.entries, monthlyBaseCents: basic })
    const payableBasic = Math.max(0, (summary.payableBasicCents ?? basic) - cents(Number(unpaidAdjustment) || 0))
    const allowances = cents((employee.housingAllowance ?? 0) + (employee.mealAllowance ?? 0) + (employee.transportAllowance ?? 0) + (employee.otherAllowances ?? 0))
    acc.grossCents += payableBasic + allowances
    acc.basicCents += payableBasic
    return acc
  }, { grossCents: 0, basicCents: 0 }), [scoped, unpaidAdjustment, period, scheduledDays, actualDays])
  const proposedDeductions = deductions.filter((deduction) => deduction.status === 'ACTIVE' && deduction.companyId === companyId && (branchId === 'all' || deduction.branchId === branchId) && scoped.some((employee) => employee.id === deduction.employeeId) && deduction.schedule.some((item) => item.periodStart === periodDate(period)))
  const voluntaryCents = proposedDeductions.reduce((sum, item) => sum + Math.min(item.schedule.find((entry) => entry.periodStart === periodDate(period))?.amountCents ?? 0, item.balanceCents), 0)
  const employeeBreakdowns = scoped.map((employee) => {
    const allowanceCents = cents((employee.housingAllowance ?? 0) + (employee.mealAllowance ?? 0) + (employee.transportAllowance ?? 0) + (employee.otherAllowances ?? 0))
    const attendance = attendanceSnapshot(period, scheduledDays, actualDays)
    const attendanceSummary = summarizeMonthlyAttendance({ contract: employee.contractType === 'Fixed term' ? 'FIXED_TERM_MONTHLY' : 'MONTHLY_SALARIED', scheduledDates: attendance.scheduledDates, entries: attendance.entries, monthlyBaseCents: cents(employee.basicSalary) })
    const adjustedBasic = Math.max(0, (attendanceSummary.payableBasicCents ?? cents(employee.basicSalary)) - cents(Number(unpaidAdjustment) || 0))
    const calculation = calculateZambiaIllustrativePayroll({ basicCents: adjustedBasic, taxableAllowanceCents: allowanceCents })
    const employeeVoluntary = proposedDeductions.filter((item) => item.employeeId === employee.id).reduce((sum, item) => sum + Math.min(item.schedule.find((entry) => entry.periodStart === periodDate(period))?.amountCents ?? 0, item.balanceCents), 0)
    return { employeeId: employee.id, employeeName: `${employee.firstName} ${employee.lastName}`, grossCents: calculation.grossCents, payeCents: calculation.payeCents, napsaCents: calculation.napsaEmployeeCents, nhimaCents: calculation.nhimaEmployeeCents, netCents: Math.max(0, calculation.netPayCents - employeeVoluntary) }
  })
  const statutoryDeductionCents = employeeBreakdowns.reduce((sum, item) => sum + item.payeCents + item.napsaCents + item.nhimaCents, 0)
  const createRun = () => {
    if (!companyId || !scoped.length || (role === 'BRANCH_MANAGER' && (branchId === 'all' || !demoBranchAssignments.includes(branchId)))) { setNotice('Select a company, monthly-pay employees, and one branch assigned to the demo branch manager.'); return }
    if (voluntaryCents + statutoryDeductionCents > totals.grossCents) { setNotice('Deductions exceed gross pay. The demo preview blocks this run and creates no negative net pay. Review the scheduled amount and selected employees.'); return }
    const id = `demo-run-${Date.now()}`
    const run: DemoPayrollRun = {
      id, companyId, branchId, period: periodDate(period), createdBy: role === 'BRANCH_MANAGER' ? 'Demo branch manager' : 'Demo Overall HR',
      status: 'SUBMITTED_FOR_APPROVAL', version: 1, employeeCount: scoped.length,
      grossCents: totals.grossCents, deductionCents: voluntaryCents + statutoryDeductionCents, netCents: Math.max(0, totals.grossCents - voluntaryCents - statutoryDeductionCents),
      statutoryDeductionCents, employeeBreakdowns,
      warnings: ['Statutory inputs are unverified; any figures are a synthetic workflow preview and cannot represent production payroll.'],
      events: [{ type: 'SUBMITTED_FOR_APPROVAL', at: nowIso() }], postedDeductionIds: proposedDeductions.map((item) => item.id),
    }
    saveRun(run)
    setNotice('Synthetic payroll submission created for Overall HR review.')
  }
  const transition = (run: DemoPayrollRun, action: 'UNDER_REVIEW' | 'RETURNED_FOR_CORRECTION' | 'REJECTED' | 'APPROVED') => {
    if (run.createdBy === 'Demo Overall HR') { setNotice('The preparer cannot review or approve their own payroll submission.'); return }
    const reason = action === 'RETURNED_FOR_CORRECTION' || action === 'REJECTED' ? window.prompt('Enter a reason for this decision:')?.trim() : ''
    if ((action === 'RETURNED_FOR_CORRECTION' || action === 'REJECTED') && !reason) { setNotice('A reason is required for return or rejection.'); return }
    const event = { type: action, at: nowIso(), ...(reason ? { reason } : {}) }
    saveRun({ ...run, status: action, events: [...run.events, event] })
    setNotice(`Demo workflow moved to ${action.replaceAll('_', ' ').toLowerCase()}.`)
  }
  const correctAndResubmit = (run: DemoPayrollRun) => saveRun({ ...run, status: 'SUBMITTED_FOR_APPROVAL', version: run.version + 1, events: [...run.events, { type: 'CORRECTED_AND_RESUBMITTED', at: nowIso() }] })
  const finalize = (run: DemoPayrollRun) => {
    if (run.status !== 'APPROVED') return
    if (!window.confirm('Finalize this synthetic demo run and post its scheduled demo deductions? No payment or filing will occur.')) return
    finalizeRun(run.id)
    setNotice('Demo run finalized. Matching approved demo repayments were posted once to the local ledger.')
  }
  const companyRuns = runs.filter((run) => activeCompanyId === 'all' || run.companyId === activeCompanyId)
  return <div className="payroll-screen">
    <section className="welcome-row payroll-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>PAYROLL WORKSPACE</div><h1>Payroll</h1><p>Build a branch-scoped synthetic preview from approved employees, compensation, attendance assumptions, and active deductions.</p></div></section>
    <div className="payroll-warning"><CircleHelp size={15}/><span><strong>Mock workflow only.</strong> Role and branch controls are demonstrations, not authorization. Statutory bases/rules are unverified. No live payroll, filing, or payment occurs.</span></div>
    <div className="panel payroll-wizard-content payroll-integrated-controls"><label>Company<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId('all') }}><option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Branch scope<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All branches</option>{selectedCompany?.branches.filter((branch) => role !== 'BRANCH_MANAGER' || demoBranchAssignments.includes(branch.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Payroll period<select value={period} onChange={(event) => setPeriod(event.target.value)}>{payPeriodOptions.map((item) => <option key={item} value={item}>{periodLabel(item)}</option>)}</select></label><label>Simulated preparer role<select value={role} onChange={(event) => { setRole(event.target.value as typeof role); setBranchId('all') }}><option value="OVERALL_HR_MANAGER">Overall HR</option><option value="BRANCH_MANAGER">Branch manager</option></select></label><label>Scheduled workdays<input type="number" min="1" max="31" value={scheduledDays} onChange={(event) => setScheduledDays(Number(event.target.value))}/></label><label>Attended / approved payable days<input type="number" min="0" max={scheduledDays} value={actualDays} onChange={(event) => setActualDays(Math.min(scheduledDays, Number(event.target.value)))}/></label><label>Approved unpaid-leave adjustment (ZMW)<input inputMode="decimal" value={unpaidAdjustment} onChange={(event) => setUnpaidAdjustment(event.target.value.replace(/[^\d.]/g,""))}/></label><button className="button-primary" onClick={createRun}><Plus size={15}/> Submit demo payroll</button></div>
    <section className="payroll-kpis"><div><span>Approved employees</span><strong>{scoped.length}</strong><small>Pending records excluded</small></div><div><span>Basic pay after explicit adjustment</span><strong>{money(totals.basicCents)}</strong><small>{actualDays} / {scheduledDays} attendance days ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· no automatic deduction</small></div><div><span>Gross earnings incl. allowances</span><strong>{money(totals.grossCents)}</strong><small>Compensation components summed</small></div><div><span>Approved advances scheduled</span><strong>{money(voluntaryCents)}</strong><small>{proposedDeductions.length} active schedules</small></div></section>
    <section className="panel payroll-runs"><header><div><div className="section-eyebrow">MOCK APPROVAL QUEUE</div><h2>Payroll runs</h2></div><span className="synthetic-chip">Synthetic data</span></header><div className="table-scroll"><table><thead><tr><th>PERIOD / SCOPE</th><th>EMPLOYEES</th><th>GROSS</th><th>VOLUNTARY DEDUCTIONS</th><th>STATUS</th><th>WORKFLOW</th></tr></thead><tbody>{companyRuns.map((run) => <tr key={run.id}><td><strong>{periodLabel(run.period.slice(0,7))}</strong><small>{companies.find((company) => company.id === run.companyId)?.name} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· {run.branchId === 'all' ? 'All branches' : companies.find((company) => company.id === run.companyId)?.branches.find((branch) => branch.id === run.branchId)?.name}</small></td><td>{run.employeeCount}</td><td>{money(run.grossCents)}</td><td>{money(run.deductionCents)}</td><td><span className={`run-status run-${run.status.toLowerCase().replaceAll('_','-')}`}>{run.status.replaceAll('_',' ')}</span></td><td><div className="approval-actions">{run.status === 'SUBMITTED_FOR_APPROVAL' && <button className="button-secondary" onClick={() => transition(run,'UNDER_REVIEW')}>Begin HR review</button>}{run.status === 'UNDER_REVIEW' && <><button className="button-secondary" onClick={() => transition(run,'RETURNED_FOR_CORRECTION')}>Return</button><button className="button-secondary" onClick={() => transition(run,'REJECTED')}>Reject</button><button className="button-primary" onClick={() => transition(run,'APPROVED')}><Check size={13}/> Approve</button></>}{run.status === 'RETURNED_FOR_CORRECTION' && <button className="button-secondary" onClick={() => correctAndResubmit(run)}>Correct & resubmit</button>}{run.status === 'APPROVED' && <button className="button-primary" onClick={() => finalize(run)}><ShieldCheck size={13}/> Finalize demo</button>}{run.status === 'FINALIZED' && <small>Repayments posted to demo ledger once</small>}</div></td></tr>)}</tbody></table>{companyRuns.length === 0 && <div className="payroll-empty">No mock payroll runs yet. Create a synthetic preview after selecting a company.</div>}</div><footer>Pending or returned employees are excluded. Deduction posting only occurs for finalized demo runs and selected matching payroll periods.</footer></section>
        <section className="panel"><header><div><div className="section-eyebrow">CALCULATION INPUTS</div><h2>Employee calculation breakdown</h2></div></header><div className="table-scroll"><table><thead><tr><th>EMPLOYEE</th><th>GROSS</th><th>PAYE Ã‚Â· DEMO</th><th>NAPSA Ã‚Â· DEMO</th><th>NHIMA Ã‚Â· DEMO</th><th>NET PREVIEW</th></tr></thead><tbody>{employeeBreakdowns.slice(0,30).map((item) => <tr key={item.employeeId}><td>{item.employeeName}</td><td>{money(item.grossCents)}</td><td>{money(item.payeCents)}</td><td>{money(item.napsaCents)}</td><td>{money(item.nhimaCents)}</td><td>{money(item.netCents)}</td></tr>)}</tbody></table></div><div className="payroll-review"><strong>{scoped.length} approved employees Ã‚Â· {proposedDeductions.length} scheduled deductions</strong><span>{selectedCompany?.name ?? 'Choose a company'} Ã‚Â· {branchId === 'all' ? 'All branches' : 'Selected branch'}</span><small>PAYE bands are an illustrative 2026 configuration. NAPSA/NHIMA bases and applicability remain unverified. These examples cannot be used for production finalization.</small></div></section>
    <div className="synthetic-stamp"><span>ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³</span> HR approval and finalization are local UI simulations. No frontend permission check provides real authorization.</div>{notice && <div className="payroll-toast" role="status">{notice}</div>}
  </div>
}
