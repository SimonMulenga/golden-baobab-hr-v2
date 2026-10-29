import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileBarChart2, LoaderCircle, Printer, Search, ShieldCheck } from 'lucide-react'
import * as XLSX from '@e965/xlsx'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord, type FinalizedPayslipItemRecord, type FinalizedPayslipRunRecord } from '../../services/live-business-services'
import { formatWorkspaceDate, useWorkspace } from '../companies/WorkspaceContext'
import './live-payroll-reports.css'

type ReportMode = 'payroll' | 'statutory'
const amount = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0 }
const money = (value: number) => `K${value.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthLabel = (run: FinalizedPayslipRunRecord, preferences?: ReturnType<typeof useWorkspace>['preferences']) => formatWorkspaceDate(`${run.payroll_periods.period_start}T00:00:00Z`, preferences, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const safeCsv = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"` }

export function LivePayrollReports({ mode = 'payroll' }: { mode?: ReportMode }) {
  const { companies, activeCompanyId, preferences } = useWorkspace()
  const [companyId, setCompanyId] = useState(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
  useEffect(() => {
    setCompanyId(activeCompanyId === 'all' ? companies[0]?.id ?? '' : activeCompanyId)
    setBranchId('all'); setRunId(''); setPage(1); setRuns([]); setItems([]); setTotal(0)
  }, [activeCompanyId, companies])
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState('all')
  const [runs, setRuns] = useState<FinalizedPayslipRunRecord[]>([])
  const [runId, setRunId] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<FinalizedPayslipItemRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedRun = runs.find((run) => run.id === runId)
  const selectedRunId = selectedRun?.id
  const selectedRunVersion = selectedRun?.version
  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees])
  const visibleItems = items.filter((item) => {
    const employee = employeeMap.get(item.employee_id)
    return !search.trim() || `${employee?.employee_number ?? ''} ${employee?.first_name ?? ''} ${employee?.last_name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  })
  const api = () => createLiveBusinessServices(getSupabaseClient())
  const pageCount = Math.max(1, Math.ceil(total / 100))
  const statutoryMode = mode === 'statutory'

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    api().payslips.finalizedRuns(companyId, branchId === 'all' ? undefined : branchId)
      .then((result) => { if (!cancelled) { setError(''); setRuns(result); setLoading(Boolean(result[0])); setRunId(result[0]?.id ?? '') } })
      .catch(() => { if (!cancelled) { setRuns([]); setError('Finalized payroll is unavailable for your current reporting permissions.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, branchId])

  useEffect(() => {
    if (!selectedRunId || selectedRunVersion == null) return
    let cancelled = false
    api().payslips.finalizedItems(selectedRunId, selectedRunVersion, page)
      .then(async (result) => {
        const people = await api().employees.byIds(result.items.map((item) => item.employee_id))
        if (!cancelled) { setItems(result.items); setEmployees(people); setTotal(result.total) }
      })
      .catch(() => { if (!cancelled) setError('The finalized payroll register could not be read under payroll row-level permissions.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedRunId, selectedRunVersion, page])

  const record = (item: FinalizedPayslipItemRecord, employee?: EmployeeDirectoryRecord) => {
    const statutory = item.statutory_deductions ?? {}
    return {
      EmployeeNumber: employee?.employee_number ?? '', Employee: [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' '),
      Department: employee?.department ?? '', JobTitle: employee?.job_title ?? '',
      BasicPay: amount(item.basic_pay), HousingAllowance: amount(item.housing_allowance), MealAllowance: amount(item.meal_allowance),
      TransportAllowance: amount(item.transport_allowance), OtherAllowances: amount(item.other_allowances), Overtime: amount(item.overtime),
      BonusesAndOtherEarnings: amount(item.bonuses_and_other_earnings), UnpaidLeaveAdjustment: amount(item.attendance_deduction),
      GrossEarnings: amount(item.gross_pay), PAYE: amount(statutory.PAYE), NAPSAEmployee: amount(statutory.NAPSA_EMPLOYEE),
      NAPSAEmployer: amount(item.napsa_employer), NHIMAEmployee: amount(statutory.NHIMA_EMPLOYEE), NHIMAEmployer: amount(item.nhima_employer),
      OtherDeductions: amount(item.voluntary_deductions), NetPay: amount(item.net_pay), EmployerCost: amount(item.total_employer_cost),
    }
  }
  const exportRows = async () => {
    if (!selectedRun) return []
    const totalPages = Math.ceil(total / 100)
    const rows: ReturnType<typeof record>[] = []
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      const result = await api().payslips.finalizedItems(selectedRun.id, selectedRun.version, currentPage)
      const people = await api().employees.byIds(result.items.map((item) => item.employee_id))
      const peopleById = new Map(people.map((person) => [person.id, person]))
      rows.push(...result.items.map((item) => record(item, peopleById.get(item.employee_id))))
    }
    return rows
  }
  const download = async (format: 'CSV' | 'XLSX') => {
    if (!selectedRun) return
    setExporting(true); setError(''); setNotice('')
    try {
      const allRows = await exportRows()
      const rows = statutoryMode ? allRows.map(({ EmployeeNumber, Employee, PAYE, NAPSAEmployee, NAPSAEmployer, NHIMAEmployee, NHIMAEmployer, GrossEarnings, NetPay }) => ({ EmployeeNumber, Employee, GrossEarnings, PAYE, NAPSAEmployee, NAPSAEmployer, NHIMAEmployee, NHIMAEmployer, NetPay })) : allRows
      const filename = `${company?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${statutoryMode ? 'statutory' : 'payroll'}-${selectedRun.payroll_periods.period_start}`
      if (format === 'CSV') {
        const headers = Object.keys(rows[0] ?? {})
        const content = [headers.map(safeCsv).join(','), ...rows.map((row) => headers.map((key) => safeCsv(row[key as keyof typeof row])).join(','))].join('\r\n')
        const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); URL.revokeObjectURL(url)
      } else {
        const workbook = XLSX.utils.book_new(); const sheet = XLSX.utils.json_to_sheet(rows)
        XLSX.utils.book_append_sheet(workbook, sheet, statutoryMode ? 'Statutory Summary' : 'Payroll Register')
        XLSX.writeFile(workbook, `${filename}.xlsx`)
      }
      setNotice(`Exported ${rows.length.toLocaleString()} finalized payroll rows. This is an internal report, not a regulator submission.`)
    } catch { setError('Export failed. Check your authorized payroll access and retry; no mock report was generated.') }
    finally { setExporting(false) }
  }
  const print = () => { if (selectedRun) { setNotice('Print view contains finalized payroll records only. It is not an official regulator filing.'); window.print() } }

  return <div className="live-payroll-reports">
    <header className="page-heading"><div><div className="eyebrow">FINALIZED RECORDS · {statutoryMode ? 'STATUTORY SUMMARY' : 'PAYROLL REPORTING'}</div><h1>{statutoryMode ? 'Statutory summaries' : 'Payroll reports'}</h1><p>{statutoryMode ? 'Employee and employer contribution totals from finalized payroll.' : 'Payroll register and employer cost reports from finalized payroll.'}</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={15}/> Reports read persisted finalized payroll versions under database permissions. Calculations are not repeated, and these reports are not filings with ZRA, NAPSA or NHIMA.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-report-notice" role="status">{notice}</div>}
    {!companies.length && <div className="panel live-report-state">No authorized companies are available for reporting.</div>}
    <section className="panel live-report-filters" aria-label="Report filters">
      <label>Company<select aria-label="Report company" value={companyId} onChange={(event) => { setLoading(Boolean(event.target.value)); setRuns([]); setRunId(''); setItems([]); setEmployees([]); setCompanyId(event.target.value); setPage(1) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Branch<select aria-label="Report branch" value={branchId} onChange={(event) => { setLoading(true); setRuns([]); setRunId(''); setItems([]); setEmployees([]); setBranchId(event.target.value); setPage(1) }}><option value="all">All authorized branches</option>{company?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Finalized payroll<select aria-label="Report payroll run" value={runId} onChange={(event) => { setLoading(Boolean(event.target.value)); setItems([]); setEmployees([]); setRunId(event.target.value); setPage(1) }}><option value="">Select finalized payroll</option>{runs.map((run) => <option value={run.id} key={run.id}>{monthLabel(run, preferences)} · {company?.branches.find((branch) => branch.id === run.branch_id)?.name ?? 'Branch'} · v{run.version}</option>)}</select></label>
    </section>
    {selectedRun && <div className="live-report-toolbar"><label className="live-report-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter this page by employee" aria-label="Search report employees"/></label><span>{total.toLocaleString()} finalized rows · page {page} of {pageCount}</span><div><button className="button-secondary" disabled={exporting} onClick={() => void download('CSV')}><Download size={14}/> CSV</button><button className="button-secondary" disabled={exporting} onClick={() => void download('XLSX')}>{exporting ? <LoaderCircle size={14}/> : <Download size={14}/>} XLSX</button><button className="button-secondary" onClick={print}><Printer size={14}/> Print</button></div></div>}
    {loading ? <div className="panel live-report-state" role="status"><LoaderCircle size={18}/> Loading finalized report records…</div> : !selectedRun ? <div className="panel live-report-state"><FileBarChart2 size={22}/><strong>{runs.length ? 'No finalized payroll selected' : 'No finalized payroll available'}</strong><span>{runs.length ? 'Choose a company and finalized run to build a report.' : 'No saved finalized run is visible for this company and branch scope.'}</span></div> : <div className="panel live-report-table"><div className="table-scroll"><table><thead><tr>{statutoryMode ? <><th>EMPLOYEE</th><th>GROSS</th><th>PAYE</th><th>NAPSA EE</th><th>NAPSA ER</th><th>NHIMA EE</th><th>NHIMA ER</th><th>NET</th></> : <><th>EMPLOYEE</th><th>DEPARTMENT</th><th>BASIC</th><th>ALLOWANCES</th><th>OVERTIME</th><th>BONUS / OTHER</th><th>GROSS</th><th>PAYE</th><th>NAPSA</th><th>NHIMA</th><th>OTHER DED.</th><th>NET</th><th>EMPLOYER COST</th></>}</tr></thead><tbody>{visibleItems.map((item) => { const employee = employeeMap.get(item.employee_id); const row = record(item, employee); return <tr key={item.id}><td><strong>{row.Employee}</strong><small>{row.EmployeeNumber}</small></td>{statutoryMode ? <><td>{money(row.GrossEarnings)}</td><td>{money(row.PAYE)}</td><td>{money(row.NAPSAEmployee)}</td><td>{money(row.NAPSAEmployer)}</td><td>{money(row.NHIMAEmployee)}</td><td>{money(row.NHIMAEmployer)}</td><td>{money(row.NetPay)}</td></> : <><td>{row.Department}</td><td>{money(row.BasicPay)}</td><td>{money(row.HousingAllowance + row.MealAllowance + row.TransportAllowance + row.OtherAllowances)}</td><td>{money(row.Overtime)}</td><td>{money(row.BonusesAndOtherEarnings)}</td><td>{money(row.GrossEarnings)}</td><td>{money(row.PAYE)}</td><td>{money(row.NAPSAEmployee)}</td><td>{money(row.NHIMAEmployee)}</td><td>{money(row.OtherDeductions)}</td><td>{money(row.NetPay)}</td><td>{money(row.EmployerCost)}</td></>}</tr> })}</tbody></table></div><footer><span>Internal report from finalized version {selectedRun.version} · {monthLabel(selectedRun, preferences)}</span><nav aria-label="Report pagination"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={14}/> Previous</button><button className="button-secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next <ChevronRight size={14}/></button></nav></footer></div>}
  </div>
}
