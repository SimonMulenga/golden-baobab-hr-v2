import { useMemo, useRef, useState } from 'react'
import { Check, CircleDollarSign, ShieldCheck } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { useEmployees } from '../employees/EmployeeContext'
import { isPayrollEligible } from '../employees/employee-workflow'
import { usePayroll } from './PayrollContext'
import type { DemoDeduction } from './PayrollContext'
import { buildDeductionSchedule, parseMoneyCents, type DeductionInstallment, type RepaymentMethod } from './deduction-schedule'
import './employee-deductions.css'

const deductionTypes = ['Employee loan', 'Salary advance', 'Medical advance', 'Educational advance', 'Other advance', 'Other authorized deduction']
const money = (cents: number) => `ZMW ${(cents / 100).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const nowIso = () => new Date().toISOString()

export function EmployeeDeductions() {
  const { companies, activeCompanyId } = useWorkspace()
  const { employees } = useEmployees()
  const { deductions: records, saveDeduction } = usePayroll()
  const nextRecordId = useRef(0)
  const scopedEmployees = (activeCompanyId === 'all' ? employees : employees.filter((employee) => employee.companyId === activeCompanyId)).filter(isPayrollEligible)
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState(deductionTypes[0])
  const [initiatorRole, setInitiatorRole] = useState<'BRANCH_MANAGER' | 'OVERALL_HR_MANAGER'>('BRANCH_MANAGER')
  const [principal, setPrincipal] = useState('6000.00')
  const [startPeriod, setStartPeriod] = useState('2026-11-01')
  const [method, setMethod] = useState<RepaymentMethod>('EQUAL_INSTALLMENTS')
  const [installmentCount, setInstallmentCount] = useState('6')
  const [fixedAmount, setFixedAmount] = useState('1000.00')
  const [manualText, setManualText] = useState('2026-11-01:1000.00\n2026-12-01:1000.00\n2027-01-01:1000.00\n2027-02-01:1000.00\n2027-03-01:1000.00\n2027-04-01:1000.00')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const employee = scopedEmployees.find((item) => item.id === employeeId)
  const scheduleResult = useMemo(() => {
    try {
      const manualInstallments = method === 'MANUAL' ? manualText.split('\n').filter(Boolean).map((line) => { const [periodStart, amount] = line.split(':'); return { periodStart: periodStart ?? '', amount: amount ?? '' } }) : undefined
      const schedule = buildDeductionSchedule({ principal, startPeriod, method, installmentCount: Number(installmentCount), installmentAmount: fixedAmount, manualInstallments })
      return { schedule, error: '' }
    } catch (reasonValue) {
      return { schedule: [] as DeductionInstallment[], error: reasonValue instanceof Error ? reasonValue.message : 'Check the schedule details.' }
    }
  }, [principal, startPeriod, method, installmentCount, fixedAmount, manualText])

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!employee) { setError('Choose an employee in the selected company.'); return }
    if (!reason.trim()) { setError('Enter the reason for this request.'); return }
    if (scheduleResult.error) { setError(scheduleResult.error); return }
    const record: DemoDeduction = {
      id: `deduction-demo-${++nextRecordId.current}`,
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      companyId: employee.companyId,
      branchId: employee.branchId,
      type,
      principalCents: parseMoneyCents(principal),
      balanceCents: parseMoneyCents(principal),
      reason: reason.trim(),
      initiatedBy: initiatorRole === 'BRANCH_MANAGER' ? 'Demo branch manager' : 'Demo Overall HR',
      status: 'SUBMITTED',
      schedule: scheduleResult.schedule,
      postedRunIds: [],
    }
    saveDeduction(record)
    setError('')
    setNotice('Demo request added to the simulated HR approval queue. No payroll deduction has been posted.')
    setReason('')
  }

  const changeStatus = (record: (typeof records)[number], status: (typeof records)[number]['status']) => saveDeduction({ ...record, status, ...(status === 'ACTIVE' || status === 'REJECTED' ? { approvedBy: 'Demo Overall HR reviewer', approvedAt: nowIso() } : {}) })

  return <div className="employee-screen deduction-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>EMPLOYEE ADVANCES & DEDUCTIONS</div><h1>Deductions & advances</h1><p>Build repayment previews and review synthetic employee requests.</p></div></section>
    <div className="import-warning"><ShieldCheck size={16}/><span><strong>Demo workflow only.</strong> Requests share this browser-session mock store with payroll. Approval is simulated; only a simulated finalized payroll run posts a scheduled amount. This is not financial processing or authorization.</span></div>
    <div className="deduction-layout">
      <form className="panel deduction-form" onSubmit={create}>
        <div className="section-eyebrow">NEW REQUEST</div><h2>Set up a repayment schedule</h2>
        <label>Employee<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required><option value="">Choose employee</option>{scopedEmployees.map((item) => <option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {item.employeeNumber}</option>)}</select></label>
        <label>Request initiated by role<select value={initiatorRole} onChange={(event) => setInitiatorRole(event.target.value as typeof initiatorRole)}><option value="BRANCH_MANAGER">Branch manager</option><option value="OVERALL_HR_MANAGER">Overall HR</option></select></label>
        <label>Deduction type<select value={type} onChange={(event) => setType(event.target.value)}>{deductionTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Principal amount (ZMW)<input inputMode="decimal" value={principal} onChange={(event) => setPrincipal(event.target.value)} required/></label>
        <label>First payroll period<input type="date" value={startPeriod} onChange={(event) => setStartPeriod(event.target.value)} required/></label>
        <label>Repayment method<select value={method} onChange={(event) => setMethod(event.target.value as RepaymentMethod)}><option value="ONE_TIME">One-time deduction</option><option value="FIXED_AMOUNT">Recurring fixed amount</option><option value="EQUAL_INSTALLMENTS">Equal installments</option><option value="MANUAL">Custom schedule</option></select></label>
        {method === 'FIXED_AMOUNT' ? <label>Installment amount (ZMW)<input inputMode="decimal" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} required/></label> : method === 'EQUAL_INSTALLMENTS' ? <label>Number of installments<input type="number" min="1" max="120" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} required/></label> : method === 'MANUAL' ? <label>Custom schedule · one YYYY-MM-DD:amount per line<textarea rows={6} value={manualText} onChange={(event) => setManualText(event.target.value)} required/></label> : null}
        <label>Reason / description<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} required/></label>
        {error && <small role="alert" className="field-error">{error}</small>}
        <button className="button-primary" type="submit"><CircleDollarSign size={15}/> Submit demo request</button>
      </form>
      <section className="panel deduction-preview"><div className="section-eyebrow">SCHEDULE PREVIEW</div><h2>{money(scheduleResult.schedule.reduce((sum, row) => sum + row.amountCents, 0))} total</h2><p>Outstanding amount is illustrative. Posting requires a future finalized-payroll ledger.</p>{scheduleResult.error ? <div className="import-error" role="alert">{scheduleResult.error}</div> : <div className="deduction-schedule">{scheduleResult.schedule.map((row) => <div key={row.sequence}><span>Installment {row.sequence}</span><strong>{row.periodStart}</strong><b>{money(row.amountCents)}</b></div>)}</div>}</section>
    </div>
    <section className="panel deduction-list"><div className="panel-heading compact"><div><div className="section-eyebrow">LOCAL DEMO STATE</div><h2>Requests and approvals</h2></div><span>{records.length} requests</span></div>
      {records.length === 0 ? <div className="employee-empty"><CircleDollarSign size={20}/><strong>No demo requests yet</strong><span>Submit a request to preview its simulated approval workflow.</span></div> : <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>TYPE</th><th>PRINCIPAL / BALANCE</th><th>PLAN</th><th>STATUS / ACTION</th></tr></thead><tbody>{records.map((record) => { const company = companies.find((item) => item.id === record.companyId); const branch = company?.branches.find((item) => item.id === record.branchId); return <tr key={record.id}><td><strong>{record.employeeName}</strong><small>{record.initiatedBy ?? 'Demo requester'} · {record.reason}</small></td><td><strong>{company?.name ?? '—'}</strong><small>{branch?.name ?? '—'}</small></td><td>{record.type}</td><td><strong>{money(record.principalCents)}</strong><small>{money(record.balanceCents)} outstanding</small></td><td>{record.schedule.length} · {money(record.schedule[0]?.amountCents ?? 0)} per scheduled period</td><td>{record.status === 'SUBMITTED' ? <><button className="button-secondary" onClick={() => changeStatus(record,'ACTIVE')}><Check size={13}/> Overall HR approve</button> <button className="button-secondary" onClick={() => changeStatus(record,'REJECTED')}>Overall HR reject</button></> : record.status === 'ACTIVE' ? <><span className="employee-status employee-status-approved"><i/>ACTIVE · {record.approvedBy ?? 'Approved'}</span> <button className="button-secondary" onClick={() => changeStatus(record,'PAUSED')}>Pause</button></> : record.status === 'PAUSED' ? <><span className="employee-status"><i/>PAUSED</span> <button className="button-secondary" onClick={() => changeStatus(record,'ACTIVE')}>Resume</button></> : <span className={`employee-status employee-status-${record.status.toLowerCase()}`}><i/>{record.status}</span>}</td></tr> })}</tbody></table></div>}
    </section>
    {notice && <div className="employee-toast" role="status">{notice}</div>}
  </div>
}
