import { useEffect, useMemo, useState } from 'react'
import { Download, FileBarChart2, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import * as XLSX from '@e965/xlsx'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDirectoryRecord, type FinalizedPayslipItemRecord, type FinalizedPayslipRunRecord, type LeaveLedgerReportRecord } from '../../services/live-business-services'
import { formatWorkspaceDate, useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { ADVANCE_HEADINGS, BANK_HEADINGS, buildAdvanceReport, buildBankPayrollReport, buildCashPayrollReport, buildLeaveDaysReport, buildMasterPayrollReport, buildMobileMoneyPayrollReport, buildNapsaReport, buildNhimaReport, buildPayeReport, buildReportCsv, buildReportWorkbook, CASH_HEADINGS, LEAVE_HEADINGS, MASTER_HEADINGS, MOBILE_MONEY_HEADINGS, NAPSA_HEADINGS, NHIMA_HEADINGS, PAYE_HEADINGS, PAYROLL_REGISTER_HEADINGS, type DeductionReportRecord, type PrivateReportDetails, type ReportLine, type ReportValidation } from './report-export-model'
import './live-payroll-reports.css'

type ReportMode = 'payroll' | 'statutory'
type ReportId = 'PAYROLL_REGISTER' | 'NAPSA' | 'NHIMA' | 'PAYE' | 'LEAVE' | 'BANK' | 'CASH' | 'ADVANCES' | 'MASTER' | 'MOBILE'
type ReportSection = 'Compliance Reports' | 'Payroll Reports'
type ReportChoice = { id: ReportId; title: string; section: ReportSection; format: string }

const REPORTS: ReportChoice[] = [
  { id: 'NAPSA', title: 'NAPSA Contributions', section: 'Compliance Reports', format: 'Internal contribution schedule · CSV' },
  { id: 'NHIMA', title: 'NHIMA Contributions', section: 'Compliance Reports', format: 'Internal contribution schedule · CSV' },
  { id: 'PAYE', title: 'PAYE Schedule', section: 'Compliance Reports', format: 'Internal payroll tax schedule · Excel' },
  { id: 'PAYROLL_REGISTER', title: 'Payroll Register (internal)', section: 'Payroll Reports', format: 'Excel workbook · finalized snapshot' },
  { id: 'LEAVE', title: 'Leave Days', section: 'Payroll Reports', format: 'Excel workbook · selected branch and finalized period' },
  { id: 'BANK', title: 'Bank Payroll', section: 'Payroll Reports', format: 'Excel workbook', },
  { id: 'CASH', title: 'Cash Payroll', section: 'Payroll Reports', format: 'Excel workbook', },
  { id: 'ADVANCES', title: 'Loans & Advances', section: 'Payroll Reports', format: 'Excel workbook', },
  { id: 'MASTER', title: 'Master Payroll', section: 'Payroll Reports', format: 'Excel workbook · finalized payroll snapshot' },
  { id: 'MOBILE', title: 'Mobile Money Payroll', section: 'Payroll Reports', format: 'Internal Excel instruction report' },
]

const number = (value: unknown) => { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0 }
const money = (value: number) => `K${value.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthLabel = (run: FinalizedPayslipRunRecord, preferences?: ReturnType<typeof useWorkspace>['preferences']) => formatWorkspaceDate(`${run.payroll_periods.period_start}T00:00:00Z`, preferences, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const rowName = (employee?: EmployeeDirectoryRecord) => [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(' ')
const statutoryAmount = (item: FinalizedPayslipItemRecord, key: string) => number(item.statutory_deductions?.[key])
const auditTypeFor = (reportId: ReportId) => reportId === 'BANK' ? 'BANK_PAYROLL' : reportId === 'CASH' ? 'CASH_PAYROLL' : reportId === 'ADVANCES' ? 'LOANS_ADVANCES' : reportId === 'MOBILE' ? 'MOBILE_MONEY' : reportId === 'LEAVE' ? 'LEAVE_DAYS' : reportId

const sensitiveReport = (reportId: ReportId) => ['BANK', 'CASH', 'MOBILE', 'NAPSA', 'NHIMA', 'PAYE'].includes(reportId)
function reportTotals(id: ReportId): string[] | undefined {
  const columns: Partial<Record<ReportId, string[]>> = {
    NAPSA: ['Employee Contribution', 'Employer Contribution', 'Total Contribution'],
    NHIMA: ['Employee Contribution', 'Employer Contribution', 'Total Contribution'],
    PAYE: ['Gross Emoluments', 'Chargeable Emoluments', 'Tax Deducted'],
    BANK: ['AMOUNT'], CASH: ['TOTAL EARNINGS', 'STAT DEDUCTIONS', 'GEN DEDUCTIONS', 'TOTAL DEDUCTIONS', 'NET PAY'],
    ADVANCES: ['MONTHLY AMT', 'INITIAL AMT', 'AMOUNT RECOVERED', 'OUTSTANDING AMT'],
    MASTER: ['Basic Pay', 'Housing Allowance', 'Meal Allowance', 'Transport Allowance', 'Other Allowances', 'Overtime', 'Bonus / Other Earnings', 'Gross Pay', 'PAYE', 'Employee NAPSA', 'Employer NAPSA', 'Employee NHIMA', 'Employer NHIMA', 'Other Deductions', 'Net Pay', 'Employer Cost'],
    MOBILE: ['NET PAY'], PAYROLL_REGISTER: ['BASIC PAY', 'ALLOWANCES', 'OVERTIME', 'BONUS / OTHER', 'GROSS PAY', 'PAYE', 'NAPSA EE', 'NAPSA ER', 'NHIMA EE', 'NHIMA ER', 'OTHER DEDUCTIONS', 'NET PAY', 'EMPLOYER COST'],
  }
  return columns[id]
}

function payrollRegister(items: FinalizedPayslipItemRecord[], employees: Map<string, EmployeeDirectoryRecord>): ReportLine[] {
  return items.map((item) => {
    const employee = employees.get(item.employee_id)
    return {
      'EMP NO': employee?.employee_number ?? '', EMPLOYEE: rowName(employee), DEPARTMENT: employee?.department ?? '',
      'BASIC PAY': number(item.basic_pay), ALLOWANCES: number(item.housing_allowance) + number(item.meal_allowance) + number(item.transport_allowance) + number(item.other_allowances),
      OVERTIME: number(item.overtime), 'BONUS / OTHER': number(item.bonuses_and_other_earnings), 'GROSS PAY': number(item.gross_pay),
      PAYE: statutoryAmount(item, 'PAYE'), 'NAPSA EE': statutoryAmount(item, 'NAPSA_EMPLOYEE'), 'NAPSA ER': number(item.napsa_employer),
      'NHIMA EE': statutoryAmount(item, 'NHIMA_EMPLOYEE'), 'NHIMA ER': number(item.nhima_employer), 'OTHER DEDUCTIONS': number(item.voluntary_deductions),
      'NET PAY': number(item.net_pay), 'EMPLOYER COST': number(item.total_employer_cost),
    }
  })
}

function reportCellValue(heading: string, value: string | number): string {
  if (typeof value !== 'number') return value
  if (heading === '#') return String(value)
  if (/days?|leave taken|accrued|adjustments|balance/i.test(heading)) return value.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return money(value)
}

export function LivePayrollReports({ mode = 'payroll' }: { mode?: ReportMode }) {
  const { companies, preferences } = useWorkspace()
  const { companyId, setCompanyId } = useCompanySelection()
  const company = companies.find((item) => item.id === companyId)
  const [branchId, setBranchId] = useState('all')
  const [runs, setRuns] = useState<FinalizedPayslipRunRecord[]>([])
  const [runId, setRunId] = useState('')
  const [items, setItems] = useState<FinalizedPayslipItemRecord[]>([])
  const [employees, setEmployees] = useState<EmployeeDirectoryRecord[]>([])
  const [privateDetails, setPrivateDetails] = useState<PrivateReportDetails[]>([])
  const [privateLoading, setPrivateLoading] = useState(false)
  const [deductions, setDeductions] = useState<DeductionReportRecord[]>([])
  const [leaveLedger, setLeaveLedger] = useState<LeaveLedgerReportRecord[]>([])
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [reportId, setReportId] = useState<ReportId>(mode === 'statutory' ? 'PAYE' : 'PAYROLL_REGISTER')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [previewAudit, setPreviewAudit] = useState<{ key: string; status: 'READY' | 'FAILED' } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selectedRun = runs.find((run) => run.id === runId)
  const report = REPORTS.find((item) => item.id === reportId)
  const employeeMap = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees])
  const privateMap = useMemo(() => new Map(privateDetails.map((details) => [details.employee_id, details])), [privateDetails])
  const branchNames = useMemo(() => new Map((company?.branches ?? []).map((branch) => [branch.id, branch.name])), [company])
  const pageCount = Math.max(1, Math.ceil(total / 100))
  const reportAuditKey = selectedRun ? `${selectedRun.id}:${selectedRun.version}:${reportId}` : ''
  const reportContext = selectedRun ? {
    companyName: company?.name ?? 'Authorized company',
    branchName: branchNames.get(selectedRun.branch_id) ?? 'Authorized branch',
    payrollPeriod: monthLabel(selectedRun, preferences),
    periodStart: selectedRun.payroll_periods.period_start,
    periodEnd: selectedRun.payroll_periods.period_end,
  } : null
  const reportValidation: ReportValidation = useMemo(() => {
    if (reportId === 'BANK') return buildBankPayrollReport(items, employeeMap, privateMap, branchNames)
    if (reportId === 'CASH') return buildCashPayrollReport(items, employeeMap, privateMap)
    if (reportId === 'MOBILE') return buildMobileMoneyPayrollReport(items, employeeMap, privateMap)
    if (reportId === 'ADVANCES') return buildAdvanceReport(items, employeeMap, deductions)
    if (reportId === 'PAYE') return buildPayeReport(items, employeeMap, privateMap)
    if (reportId === 'NAPSA' && reportContext) return buildNapsaReport(items, employeeMap, privateMap, reportContext)
    if (reportId === 'NHIMA' && reportContext) return buildNhimaReport(items, employeeMap, privateMap, reportContext)
    if (reportId === 'LEAVE' && reportContext) return buildLeaveDaysReport(items, employeeMap, leaveLedger, reportContext)
    if (reportId === 'MASTER') return buildMasterPayrollReport(items, employeeMap)
    return { rows: payrollRegister(items, employeeMap), errors: [] }
  }, [reportId, items, employeeMap, privateMap, branchNames, deductions, leaveLedger, reportContext])
  const visibleRows = reportValidation.rows.filter((row) => !search.trim() || Object.values(row).join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  const services = () => createLiveBusinessServices(getSupabaseClient())

  useEffect(() => {
    setBranchId('all'); setRunId(''); setPage(1); setRuns([]); setItems([]); setEmployees([]); setPrivateDetails([]); setDeductions([]); setLeaveLedger([]); setTotal(0)
  }, [companyId])

  useEffect(() => {
    if (!companyId) { setLoading(false); setRuns([]); setRunId(''); return }
    let cancelled = false
    setLoading(true); setError('')
    services().payslips.finalizedRuns(companyId, branchId === 'all' ? undefined : branchId)
      .then((result) => { if (!cancelled) { setRuns(result); setRunId(result[0]?.id ?? '') } })
      .catch(() => { if (!cancelled) { setRuns([]); setRunId(''); setError('Finalized payroll is unavailable for your reporting permissions and selected company.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [companyId, branchId])

  useEffect(() => {
    if (!selectedRun) { setItems([]); setEmployees([]); setPrivateDetails([]); setDeductions([]); setTotal(0); return }
    let cancelled = false
    setLoading(true); setError(''); setItems([]); setEmployees([]); setPrivateDetails([]); setDeductions([])
    services().payslips.finalizedItems(selectedRun.id, selectedRun.version, page)
      .then(async (result) => {
        const people = await services().employees.byIds(result.items.map((item) => item.employee_id))
        if (!cancelled) { setItems(result.items); setEmployees(people); setTotal(result.total) }
      })
      .catch(() => { if (!cancelled) setError('The finalized payroll snapshot could not be loaded for this company and branch.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedRun?.id, selectedRun?.version, page])

  useEffect(() => {
    if (!selectedRun || !items.length || !sensitiveReport(reportId)) { setPrivateDetails([]); return }
    let cancelled = false
    setPrivateLoading(true)
    const client = getSupabaseClient()
    void client.from('employee_private_details')
      .select('employee_id,identity_document_number,tpin,napsa_number,nhima_number,payment_method,bank_account_name,bank_account_number,bank_branch_name,mobile_money_provider,mobile_money_number')
      .eq('company_id', selectedRun.company_id).in('employee_id', items.map((item) => item.employee_id))
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) { setError('Private employee details cannot be accessed for this report. Check the statutory or payment-data permission for this company.'); setPrivateDetails([]); setPrivateLoading(false); return }
        setPrivateDetails((data ?? []) as PrivateReportDetails[])
        if (items.length && !data?.length) setError('Private payment and statutory details are unavailable under your current permissions.')
        setPrivateLoading(false)
      })
    return () => { cancelled = true; setPrivateLoading(false) }
  }, [selectedRun?.id, items, reportId])

  useEffect(() => {
    if (!selectedRun || !report || loading || privateLoading || leaveLoading || total < 1) return
    let cancelled = false
    const key = `${selectedRun.id}:${selectedRun.version}:${reportId}`
    setPreviewAudit(null)
    void services().reports.authorizeAndAuditExport(selectedRun.id, auditTypeFor(reportId), reportValidation.rows.length, 'PREVIEW')
      .then(() => { if (!cancelled) setPreviewAudit({ key, status: 'READY' }) })
      .catch(() => { if (!cancelled) setPreviewAudit({ key, status: 'FAILED' }) })
    return () => { cancelled = true }
  }, [selectedRun?.id, selectedRun?.version, reportId, loading, privateLoading, leaveLoading, total, reportValidation.rows.length])

  useEffect(() => {
    if (!selectedRun || !items.length || reportId !== 'ADVANCES') { setDeductions([]); return }
    let cancelled = false
    const loadDeductions = async () => {
      const records: DeductionReportRecord[] = []
      for (let offset = 0; ; offset += 1000) {
        const result = await getSupabaseClient().from('employee_deductions')
          .select('id,employee_id,deduction_type,reason,principal_amount,amount_deducted,status')
          .eq('company_id', selectedRun.company_id).eq('branch_id', selectedRun.branch_id)
          .in('employee_id', items.map((item) => item.employee_id)).range(offset, offset + 999)
        if (result.error) throw result.error
        const pageRows = (result.data ?? []) as DeductionReportRecord[]
        records.push(...pageRows)
        if (pageRows.length < 1000) break
      }
      if (!cancelled) setDeductions(records)
    }
    void loadDeductions().catch(() => { if (!cancelled) { setError('Loan and advance records are unavailable under your deduction permissions.'); setDeductions([]) } })
    return () => { cancelled = true }
  }, [selectedRun?.id, items, reportId])

  useEffect(() => {
    if (!selectedRun || !items.length || reportId !== 'LEAVE') { setLeaveLedger([]); setLeaveLoading(false); return }
    let cancelled = false
    setLeaveLoading(true)
    void services().reports.leaveLedger(selectedRun.company_id, selectedRun.branch_id, items.map((item) => item.employee_id), selectedRun.payroll_periods.period_end)
      .then((result) => { if (!cancelled) setLeaveLedger(result) })
      .catch(() => { if (!cancelled) { setLeaveLedger([]); setError('Leave ledger data could not be loaded for the selected company, branch and period.') } })
      .finally(() => { if (!cancelled) setLeaveLoading(false) })
    return () => { cancelled = true }
  }, [selectedRun?.id, selectedRun?.version, items, reportId])

  const exportReport = async () => {
    if (!selectedRun || !report) return
    setExporting(true); setError(''); setNotice('')
    try {
      const pageTotal = Math.ceil(total / 100)
      const allItems: FinalizedPayslipItemRecord[] = []
      const allPeople = new Map<string, EmployeeDirectoryRecord>()
      for (let currentPage = 1; currentPage <= pageTotal; currentPage += 1) {
        const result = await services().payslips.finalizedItems(selectedRun.id, selectedRun.version, currentPage)
        allItems.push(...result.items)
        const people = await services().employees.byIds(result.items.map((item) => item.employee_id))
        for (const person of people) allPeople.set(person.id, person)
      }
      let allRows: ReportLine[]
      let exportPrivateMap = new Map<string, PrivateReportDetails>()
      if (sensitiveReport(reportId)) {
        const privateRows: PrivateReportDetails[] = []
        for (let index = 0; index < allItems.length; index += 100) {
          const ids = allItems.slice(index, index + 100).map((item) => item.employee_id)
          const privateResult = await getSupabaseClient().from('employee_private_details')
            .select('employee_id,identity_document_number,tpin,napsa_number,nhima_number,payment_method,bank_account_name,bank_account_number,bank_branch_name,mobile_money_provider,mobile_money_number')
            .eq('company_id', selectedRun.company_id).in('employee_id', ids)
          if (privateResult.error) throw privateResult.error
          privateRows.push(...((privateResult.data ?? []) as PrivateReportDetails[]))
        }
        exportPrivateMap = new Map(privateRows.map((details) => [details.employee_id, details]))
      }
      if (reportId === 'BANK' || reportId === 'CASH' || reportId === 'MOBILE') {
        if (reportId === 'BANK') {
          const validation = buildBankPayrollReport(allItems, allPeople, exportPrivateMap, branchNames)
          if (validation.errors.length) throw new Error(validation.errors[0].reason)
          allRows = validation.rows
        } else if (reportId === 'MOBILE') {
          const validation = buildMobileMoneyPayrollReport(allItems, allPeople, exportPrivateMap)
          if (validation.errors.length) throw new Error(validation.errors[0].reason)
          allRows = validation.rows
        } else {
          const validation = buildCashPayrollReport(allItems, allPeople, exportPrivateMap)
          if (validation.errors.length) throw new Error(validation.errors[0].reason)
          allRows = validation.rows
        }
      } else if (reportId === 'ADVANCES') {
        const deductionRows: DeductionReportRecord[] = []
        for (let index = 0; index < allItems.length; index += 100) {
          const ids = allItems.slice(index, index + 100).map((item) => item.employee_id)
          for (let offset = 0; ; offset += 1000) {
            const deductionResult = await getSupabaseClient().from('employee_deductions')
              .select('id,employee_id,deduction_type,reason,principal_amount,amount_deducted,status')
              .eq('company_id', selectedRun.company_id).eq('branch_id', selectedRun.branch_id).in('employee_id', ids).range(offset, offset + 999)
            if (deductionResult.error) throw deductionResult.error
            const pageRows = (deductionResult.data ?? []) as DeductionReportRecord[]
            deductionRows.push(...pageRows)
            if (pageRows.length < 1000) break
          }
        }
        const validation = buildAdvanceReport(allItems, allPeople, deductionRows)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else if (reportId === 'NAPSA') {
        const validation = buildNapsaReport(allItems, allPeople, exportPrivateMap, reportContext!)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else if (reportId === 'NHIMA') {
        const validation = buildNhimaReport(allItems, allPeople, exportPrivateMap, reportContext!)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else if (reportId === 'PAYE') {
        const validation = buildPayeReport(allItems, allPeople, exportPrivateMap)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else if (reportId === 'LEAVE') {
        const ledger = await services().reports.leaveLedger(selectedRun.company_id, selectedRun.branch_id, allItems.map((item) => item.employee_id), selectedRun.payroll_periods.period_end)
        const validation = buildLeaveDaysReport(allItems, allPeople, ledger, reportContext!)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else if (reportId === 'MASTER') {
        const validation = buildMasterPayrollReport(allItems, allPeople)
        if (validation.errors.length) throw new Error(validation.errors[0].reason)
        allRows = validation.rows
      } else {
        allRows = payrollRegister(allItems, allPeople)
      }
      await services().reports.authorizeAndAuditExport(selectedRun.id, auditTypeFor(reportId), allRows.length, 'EXPORT')
      const filename = `${(company?.name ?? 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${reportId.toLowerCase()}-${selectedRun.payroll_periods.period_start}`
      const employeeCount = new Set(allRows.map((row) => String(row['Employee Number'] ?? row['EMP NO'] ?? row['EMP NO.'] ?? '')).filter(Boolean)).size
      const headers = reportId === 'BANK' ? BANK_HEADINGS : reportId === 'CASH' ? CASH_HEADINGS : reportId === 'ADVANCES' ? ADVANCE_HEADINGS : reportId === 'MOBILE' ? MOBILE_MONEY_HEADINGS : reportId === 'NAPSA' ? NAPSA_HEADINGS : reportId === 'NHIMA' ? NHIMA_HEADINGS : reportId === 'PAYE' ? PAYE_HEADINGS : reportId === 'LEAVE' ? LEAVE_HEADINGS : reportId === 'MASTER' ? MASTER_HEADINGS : PAYROLL_REGISTER_HEADINGS
      const isCsv = reportId === 'NAPSA' || reportId === 'NHIMA'
      if (isCsv) {
        const csv = buildReportCsv(allRows, headers)
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const link = document.createElement('a')
        const downloadUrl = URL.createObjectURL(blob)
        link.href = downloadUrl; link.download = `${filename}.csv`; document.body.appendChild(link); link.click(); link.remove()
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      } else {
        const workbook = buildReportWorkbook(allRows, headers, report.title, reportTotals(reportId), `TOTAL (${reportId === 'ADVANCES' ? `${allRows.length} lines` : `${employeeCount} employees`})`)
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        if (sheet && allRows.length) sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: allRows.length, c: headers.length - 1 } }) }
        XLSX.writeFile(workbook, `${filename}.xlsx`)
      }
      setNotice(`Exported ${allRows.length.toLocaleString()} report rows for ${employeeCount.toLocaleString()} employees from ${branchNames.get(selectedRun.branch_id) ?? 'the selected branch'} for ${monthLabel(selectedRun, preferences)} (finalized version ${selectedRun.version}). The export was audited. No payment or statutory submission was initiated.`)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : ''
      const safeDetail = detail && !/[0-9]{6,}|@/.test(detail) ? ` ${detail}` : ''
      setError(`Report could not be generated. Check the data or permissions for the selected finalized payroll.${safeDetail}`)
    } finally { setExporting(false) }
  }

  return <div className="live-payroll-reports">
    <header className="page-heading"><div><div className="eyebrow">{mode === 'statutory' ? 'COMPLIANCE REPORTS' : 'PAYROLL & COMPLIANCE'}</div><h1>{mode === 'statutory' ? 'Compliance Reports' : 'Reports'}</h1><p>Select a finalized payroll run. Each report includes the exact employee rows in that run's company, branch and period.</p></div></header>
    <div className="live-data-notice"><ShieldCheck size={16}/> Sensitive report data remains subject to your existing company, branch and employee permissions. Exports are audited and never initiate payments.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-report-notice" role="status">{notice}</div>}
    {!companies.length && <div className="panel live-report-state">No authorized companies are available for reporting.</div>}
    <section className="panel live-report-filters" aria-label="Report filters">
      <label>Company<select aria-label="Report company" value={companyId} onChange={(event) => { setRuns([]); setRunId(''); setItems([]); setEmployees([]); setCompanyId(event.target.value); setPage(1) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Branch<select aria-label="Report branch" value={branchId} onChange={(event) => { setRunId(''); setItems([]); setEmployees([]); setBranchId(event.target.value); setPage(1) }}><option value="all">All authorized branches · runs listed separately</option>{company?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Finalized payroll<select aria-label="Report payroll run" value={runId} onChange={(event) => { setRunId(event.target.value); setPage(1) }}><option value="">Select finalized payroll</option>{runs.map((run) => <option value={run.id} key={run.id}>{monthLabel(run, preferences)} · {branchNames.get(run.branch_id) ?? 'Branch'} · v{run.version}</option>)}</select></label>
    </section>
    <section className="report-catalog" aria-label="Report types">
      {(['Compliance Reports', 'Payroll Reports'] as const).filter((section) => mode !== 'statutory' || section === 'Compliance Reports').map((section) => <div className="report-catalog-section" key={section}><h2>{section}</h2><div className="report-choice-grid">{REPORTS.filter((item) => item.section === section).map((item) => <button key={item.id} className={`report-choice ${reportId === item.id ? 'selected' : ''}`} onClick={() => { setReportId(item.id); setError(''); setNotice(''); setPreviewAudit(null) }} aria-pressed={reportId === item.id}><strong>{item.title}</strong><span>{item.format}</span></button>)}</div></div>)}
    </section>
    {report && <section className="panel report-preview-panel">
      <header className="report-preview-heading"><div><h2>{report.title}</h2><p>{selectedRun ? `${monthLabel(selectedRun, preferences)} · ${branchNames.get(selectedRun.branch_id) ?? 'Selected branch'} · finalized version ${selectedRun.version}` : 'Select a finalized payroll period to preview this report.'}</p></div><div className="report-actions"><button className="button-primary" onClick={() => void exportReport()} disabled={loading || privateLoading || leaveLoading || exporting || !selectedRun || reportValidation.errors.length > 0}><Download size={15}/>{exporting ? 'Preparing…' : reportId === 'NAPSA' || reportId === 'NHIMA' ? 'Export CSV' : 'Export Excel'}</button></div></header>
      {selectedRun && <div className="report-preview-toolbar"><label className="report-search"><Search size={15}/><input aria-label="Search report preview" placeholder="Search report rows" value={search} onChange={(event) => setSearch(event.target.value)}/></label><span>{reportValidation.rows.length.toLocaleString()} report rows on page · {total.toLocaleString()} employees in selected branch payroll · page {page} of {pageCount}</span></div>}
      {loading || privateLoading || leaveLoading || (selectedRun && previewAudit?.key !== reportAuditKey && previewAudit?.status !== 'FAILED') ? <div className="panel live-report-state" role="status"><LoaderCircle size={18}/> Confirming report access and recording the preview…</div>
        : selectedRun && total === 0 ? <div className="panel live-report-state"><strong>No employees in this finalized branch payroll</strong><span>This report is tied to the selected finalized payroll snapshot.</span></div>
        : selectedRun && previewAudit?.status === 'FAILED' ? <div className="panel report-validation" role="alert"><strong>Report preview is unavailable</strong><span>Your report-view access could not be audited. Check payroll/report permissions and confirm the report-access migration is active.</span></div>
        : !selectedRun ? <div className="panel live-report-state"><FileBarChart2 size={22}/><strong>{runs.length ? 'Select a finalized payroll' : 'No finalized payroll found'}</strong><span>Reports cannot be generated from trial calculations or unapproved payroll.</span></div>
        : reportValidation.errors.length > 0 ? <div className="report-validation" role="alert"><strong>Resolve these data issues before export</strong><ul>{reportValidation.errors.slice(0, 30).map((issue, index) => <li key={`${issue.employee}-${issue.field}-${index}`}>{issue.employee && <b>{issue.employee}: </b>}<b>{issue.field} — </b>{issue.reason}</li>)}</ul>{reportValidation.errors.length > 30 && <p>{reportValidation.errors.length - 30} additional issues are not shown.</p>}</div>
        : reportValidation.rows.length === 0 ? <div className="panel live-report-state"><strong>No matching employees in this branch payroll</strong><span>The selected finalized payroll contains {total.toLocaleString()} employees. No records match this report type or payment method.</span></div>
        : <div className="report-preview-table"><div className="table-scroll"><table><thead><tr>{Object.keys(reportValidation.rows[0]).map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{visibleRows.slice(0, 100).map((row, index) => <tr key={index}>{Object.entries(row).map(([heading, value], cellIndex) => <td key={cellIndex}>{reportCellValue(heading, value)}</td>)}</tr>)}</tbody></table></div><footer><span>Preview contains {reportValidation.rows.length.toLocaleString()} report rows from finalized version {selectedRun.version}; values are not recalculated.</span><div><button className="button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button-secondary" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer></div>}
    </section>}
  </div>
}
