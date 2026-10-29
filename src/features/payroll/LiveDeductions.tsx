import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleDollarSign, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { useWorkspace } from '../companies/WorkspaceContext'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type DeductionInstallmentRecord, type DeductionRecord, type EmployeeDirectoryRecord } from '../../services/live-business-services'
import { buildDeductionSchedule, parseMoneyCents, type DeductionInstallment, type RepaymentMethod } from './deduction-schedule'
import './live-deductions.css'

const pageSize = 25
const deductionKinds = [
  ['EMPLOYEE_LOAN', 'Employee loan'], ['SALARY_ADVANCE', 'Salary advance'], ['MEDICAL_ADVANCE', 'Medical advance'],
  ['EDUCATIONAL_ADVANCE', 'Educational advance'], ['OTHER_ADVANCE', 'Other advance'], ['OTHER_AUTHORIZED', 'Other authorized deduction'],
] as const
const methodMap: Record<RepaymentMethod, string> = { ONE_TIME: 'ONE_TIME', FIXED_AMOUNT: 'FIXED_RECURRING', EQUAL_INSTALLMENTS: 'EQUAL_INSTALLMENTS', MANUAL: 'MANUAL_SCHEDULE' }
const money = (value: number) => `ZMW ${Number(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function LiveDeductions() {
  const { companies, activeCompanyId, setActiveCompany } = useWorkspace()
  const company = companies.find((item) => item.id === activeCompanyId)
  const [records, setRecords] = useState<DeductionRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [employeeDirectory, setEmployeeDirectory] = useState<Record<string, EmployeeDirectoryRecord>>({})
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [branchId, setBranchId] = useState(() => company?.branches[0]?.id ?? '')
  const effectiveBranchId = company?.branches.some((item) => item.id === branchId) ? branchId : company?.branches[0]?.id ?? ''
  const [kind, setKind] = useState<(typeof deductionKinds)[number][0]>('MEDICAL_ADVANCE')
  const [principal, setPrincipal] = useState('6000.00')
  const [startPeriod, setStartPeriod] = useState('2026-11-01')
  const [method, setMethod] = useState<RepaymentMethod>('EQUAL_INSTALLMENTS')
  const [count, setCount] = useState('6')
  const [fixedAmount, setFixedAmount] = useState('1000.00')
  const [reason, setReason] = useState('')
  const [manual, setManual] = useState('')
  const [schedules, setSchedules] = useState<Record<string, DeductionInstallmentRecord[]>>({})
  const requestGeneration = useRef(0)
  const selectedEmployee = employees.find((item) => item.id === employeeId)
  const schedule = useMemo(() => {
    try {
      const manualInstallments = method === 'MANUAL' ? manual.split('\n').filter(Boolean).map((line) => {
        const [periodStart, amount] = line.split(':')
        return { periodStart: periodStart ?? '', amount: amount ?? '' }
      }) : undefined
      return { rows: buildDeductionSchedule({ principal, startPeriod, method, installmentCount: Number(count), installmentAmount: fixedAmount, manualInstallments }), error: '' }
    } catch (cause) { return { rows: [] as DeductionInstallment[], error: cause instanceof Error ? cause.message : 'Check the repayment schedule.' } }
  }, [principal, startPeriod, method, count, fixedAmount, manual])

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current
    try {
      const services = createLiveBusinessServices(getSupabaseClient())
      const [deductions, people] = await Promise.all([
        services.deductions.list({ page, pageSize, ...(company ? { companyId: company.id } : {}) }),
        services.employees.list({ page: 1, pageSize: 100, ...(company ? { companyId: company.id } : {}), approvalStatus: 'APPROVED', search: employeeSearch }),
      ])
      if (generation !== requestGeneration.current) return
      setRecords(deductions.items); setTotal(deductions.total); setEmployees(people.items)
      const [directory, installmentRows] = await Promise.all([
        services.employees.byIds(deductions.items.map((item) => item.employee_id)),
        Promise.all(deductions.items.map(async (item) => [item.id, await services.deductions.installments(item.id)] as const)),
      ])
      if (generation === requestGeneration.current) {
        setEmployeeDirectory(Object.fromEntries(directory.map((item) => [item.id, item])))
        setSchedules(Object.fromEntries(installmentRows.map(([id, rows]) => [id, rows])))
      }
    } catch {
      if (generation === requestGeneration.current) setError('Live deduction records could not be loaded. Check your company access and retry.')
    } finally { if (generation === requestGeneration.current) setLoading(false) }
  }, [page, company, employeeSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => { window.clearTimeout(timer); requestGeneration.current += 1 }
  }, [load])

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice('')
    if (!company?.portfolioId || !effectiveBranchId || !selectedEmployee) { setError('Select an authorized company, branch, and approved employee.'); return }
    if (selectedEmployee.workplace_branch_id !== effectiveBranchId) { setError('The selected employee is assigned to a different branch.'); return }
    if (!reason.trim()) { setError('Provide the business reason for this request.'); return }
    if (schedule.error) return
    const details = {
      deduction_type: kind,
      principal_amount: (parseMoneyCents(principal) / 100).toFixed(2),
      repayment_method: methodMap[method],
      requested_installments: method === 'EQUAL_INSTALLMENTS' ? schedule.rows.length : null,
      fixed_installment_amount: method === 'FIXED_AMOUNT' ? (parseMoneyCents(fixedAmount) / 100).toFixed(2) : null,
      start_period: startPeriod,
      installment_frequency: 'MONTHLY',
      reason: reason.trim(),
    }
    const dbSchedule = method === 'MANUAL' ? schedule.rows.map((row) => ({ sequence_number: row.sequence, due_period: row.periodStart, scheduled_amount: row.amountCents / 100 })) : []
    setSaving(true)
    try {
      await createLiveBusinessServices(getSupabaseClient()).deductions.createRequest({
        portfolioId: company.portfolioId, companyId: company.id, branchId: effectiveBranchId, employeeId: selectedEmployee.id,
        idempotencyKey: crypto.randomUUID(), details, schedule: dbSchedule,
      })
      setNotice('Request submitted to the authorized HR approval queue. The schedule will affect payroll only after approval and finalized payroll.')
      setReason(''); setPage(1); setLoading(true); await load()
    } catch { setError('The deduction request was not saved. Verify your permissions and the request details, then retry.') }
    finally { setSaving(false) }
  }

  const review = async (record: DeductionRecord, decision: 'APPROVE' | 'REJECT') => {
    const reviewReason = decision === 'REJECT' ? window.prompt('Provide a reason for rejection:') : null
    if (decision === 'REJECT' && !reviewReason?.trim()) return
    setError(''); setNotice('')
    try {
      await createLiveBusinessServices(getSupabaseClient()).deductions.reviewRequest(record.id, decision, reviewReason ?? undefined)
      setNotice(decision === 'APPROVE' ? 'Deduction request approved by the trusted service.' : 'Deduction request rejected and recorded.')
      setLoading(true); await load()
    } catch { setError('The review was not accepted. The requester cannot approve their own request and the backend enforces reviewer permissions.') }
  }

  return <div className="employee-screen live-deductions">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/>PAYROLL DEDUCTIONS</div><h1>Deductions & advances</h1><p>Manage authorized repayment requests for {company?.name ?? 'your selected company'}.</p></div></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Requests and schedules are loaded from Supabase. The trusted backend enforces company, branch, role, and separation-of-duties checks.</div>
    {(error || notice) && <div className={error ? 'auth-shell-error' : 'live-deduction-success'} role={error ? 'alert' : 'status'}>{error || notice} {error && <button className="button-secondary" onClick={() => { setLoading(true); setError(''); void load() }}><RotateCcw size={14}/> Retry</button>}</div>}
    <div className="live-deduction-layout">
      <form className="panel live-deduction-form" onSubmit={(event) => void create(event)}>
        <div className="section-eyebrow">NEW REQUEST</div><h2>Create repayment request</h2>
        <label>Company<select value={company?.id ?? ''} onChange={(event) => { const next = companies.find((item) => item.id === event.target.value); if (next) { setActiveCompany(next.id); setBranchId(next.branches[0]?.id ?? ''); setEmployeeId('') } }} required><option value="">Choose company</option>{companies.filter((item) => item.status === 'Active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Branch<select value={effectiveBranchId} onChange={(event) => { setBranchId(event.target.value); setEmployeeId('') }} required><option value="">Choose branch</option>{company?.branches.filter((item) => item.status === 'Active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Find employee<input value={employeeSearch} onChange={(event) => { setLoading(true); setEmployeeSearch(event.target.value) }} placeholder="Search by last name" /></label>
        <label>Approved employee<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required><option value="">Choose employee</option>{employees.filter((item) => item.workplace_branch_id === effectiveBranchId).map((item) => <option key={item.id} value={item.id}>{item.first_name} {item.last_name} · {item.employee_number}</option>)}</select></label>
        <label>Deduction category<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{deductionKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Principal (ZMW)<input value={principal} inputMode="decimal" onChange={(event) => setPrincipal(event.target.value)} required/></label>
        <label>First payroll period<input type="date" value={startPeriod} onChange={(event) => setStartPeriod(event.target.value)} required/></label>
        <label>Repayment method<select value={method} onChange={(event) => setMethod(event.target.value as RepaymentMethod)}><option value="ONE_TIME">One-time</option><option value="FIXED_AMOUNT">Recurring fixed amount</option><option value="EQUAL_INSTALLMENTS">Equal installments</option><option value="MANUAL">Custom schedule</option></select></label>
        {method === 'EQUAL_INSTALLMENTS' && <label>Number of installments<input type="number" min="1" max="120" value={count} onChange={(event) => setCount(event.target.value)} required/></label>}
        {method === 'FIXED_AMOUNT' && <label>Monthly installment (ZMW)<input inputMode="decimal" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} required/></label>}
        {method === 'MANUAL' && <label>Schedule · one YYYY-MM-DD:amount per line<textarea rows={5} value={manual} onChange={(event) => setManual(event.target.value)} placeholder="2026-11-01:1000.00" required/></label>}
        <label>Reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} required/></label>
        {schedule.error && <small role="alert" className="field-error">{schedule.error}</small>}
        <button className="button-primary" disabled={saving || !company || !effectiveBranchId || !selectedEmployee || schedule.rows.length === 0}><CircleDollarSign size={15}/>{saving ? 'Submitting…' : 'Submit for HR approval'}</button>
      </form>
      <section className="panel live-deduction-preview"><div className="section-eyebrow">SCHEDULE PREVIEW</div><h2>{money(schedule.rows.reduce((sum, row) => sum + row.amountCents, 0) / 100)}</h2><p>Preview does not post a repayment. Only backend payroll finalization can record a deduction payment.</p><div className="live-schedule-list">{schedule.rows.map((row) => <div key={row.sequence}><span>Installment {row.sequence}</span><strong>{row.periodStart}</strong><b>{money(row.amountCents / 100)}</b></div>)}</div></section>
    </div>
    <section className="panel live-deduction-table"><header><div><div className="section-eyebrow">PERSISTED REQUESTS</div><h2>Repayments and approvals</h2></div><label>Company<select aria-label="Filter deductions by company" value={activeCompanyId === 'all' ? '' : activeCompanyId} onChange={(event) => { setActiveCompany(event.target.value || 'all'); setBranchId(''); setEmployeeId(''); setPage(1) }}><option value="">All authorized companies</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></header>
      {loading ? <div className="employee-empty" role="status">Loading authorized repayment records…</div> : records.length ? <div className="table-scroll"><table className="employee-table"><thead><tr><th>EMPLOYEE / REQUEST</th><th>PRINCIPAL</th><th>REPAID</th><th>OUTSTANDING</th><th>STATUS</th><th>SCHEDULE</th><th>REVIEW</th></tr></thead><tbody>{records.map((record) => { const rows = schedules[record.id] ?? []; const employeeRecord = employeeDirectory[record.employee_id]; const outstanding = Math.max(0, Number(record.principal_amount) - Number(record.amount_deducted)); return <tr key={record.id}><td><strong>{employeeRecord ? `${employeeRecord.first_name} ${employeeRecord.last_name}` : `Employee ${record.employee_id.slice(0, 8)}`}</strong><small>{employeeRecord?.employee_number ?? deductionKinds.find(([value]) => value === record.deduction_type)?.[1] ?? record.deduction_type}</small></td><td>{money(Number(record.principal_amount))}</td><td>{money(Number(record.amount_deducted))}</td><td>{money(outstanding)}</td><td><span className={`approval-status status-${record.status.toLowerCase().replaceAll('_', '-')}`}>{record.status.replaceAll('_', ' ')}</span></td><td><details><summary>{rows.length} installments</summary><div className="live-schedule-list">{rows.map((row) => <div key={row.id}><span>#{row.sequence_number}</span><strong>{row.due_period}</strong><b>{money(Number(row.scheduled_amount))}</b></div>)}</div></details></td><td>{record.status === 'SUBMITTED' ? <div className="live-review-actions"><button aria-label="Approve deduction" title="Approve" onClick={() => void review(record, 'APPROVE')}><Check size={15}/></button><button aria-label="Reject deduction" title="Reject" onClick={() => void review(record, 'REJECT')}><X size={15}/></button></div> : <span>—</span>}</td></tr> })}</tbody></table></div> : <div className="employee-empty">No deduction requests are visible for this access scope.</div>}
      <footer className="employee-pagination"><span>{total} requests · Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span><div><button className="button-secondary" aria-label="Previous requests page" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((value) => value - 1) }}><ChevronLeft size={15}/></button><button className="button-secondary" aria-label="Next requests page" disabled={page >= Math.max(1, Math.ceil(total / pageSize)) || loading} onClick={() => { setLoading(true); setPage((value) => value + 1) }}><ChevronRight size={15}/></button></div></footer>
    </section>
  </div>
}

