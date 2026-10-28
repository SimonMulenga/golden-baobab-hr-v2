import { useMemo, useState, type FormEvent } from 'react'
import * as XLSX from '@e965/xlsx'
import { FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeDraftInput, type JsonObject } from '../../services/live-business-services'
import { useWorkspace } from '../companies/WorkspaceContext'
import { dateForImport, findImportHeaderRow, liveImportFields, mapImportHeader, type LiveImportField } from './live-import-model'
import './live-employee-import.css'

type SheetRow = Record<string, unknown>
type ImportRow = { line: number; values: Record<string, string>; errors: string[] }
type ImportOutcome = { line: number; result: 'submitted' | 'draft' | 'failed'; message: string }

function excelCell(value: unknown, field?: LiveImportField): string {
  if (field?.type === 'date' && typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value ?? '').trim()
}

function enumValue(value: string) { return value.trim().toUpperCase().replace(/[\s-]+/g, '_') }

export function LiveEmployeeImport() {
  const { companies } = useWorkspace()
  const [companyId, setCompanyId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [sourceRows, setSourceRows] = useState<SheetRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const company = companies.find((item) => item.id === companyId)
  const branch = company?.branches.find((item) => item.id === branchId)

  const rows = useMemo<ImportRow[]>(() => {
    const seen = new Set<string>()
    return sourceRows.map((source, index) => {
      const values = Object.fromEntries(liveImportFields.map((field) => [field.key, excelCell(mapping[field.key] ? source[mapping[field.key]] : '', field)]))
      const errors: string[] = []
      for (const field of liveImportFields) if (field.required && !values[field.key]) errors.push(`${field.label} is required`)
      if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) errors.push('Email is invalid')
      if (!values.email && !values.email_unavailable_reason) errors.push('Email or an unavailable reason is required')
      if (values.date_of_birth && !dateForImport(values.date_of_birth)) errors.push('Date of birth must use an unambiguous date value')
      if (values.contract_start_date && !dateForImport(values.contract_start_date)) errors.push('Employment start date is invalid')
      if (values.contract_end_date && !dateForImport(values.contract_end_date)) errors.push('Contract end date is invalid')
      for (const field of liveImportFields.filter((item) => item.type === 'number')) {
        if (values[field.key] && (!Number.isFinite(Number(values[field.key])) || Number(values[field.key]) < 0)) errors.push(`${field.label} must be zero or greater`)
      }
      if (values.basic_pay && Number(values.basic_pay) <= 0) errors.push('Basic pay must be greater than zero')
      if (values.payment_method && !['BANK_TRANSFER', 'CASH', 'MOBILE_MONEY'].includes(enumValue(values.payment_method))) errors.push('Payment method must be Bank transfer, Cash, or Mobile money')
      if (values.identity_document_type && !['NRC', 'PASSPORT', 'OTHER'].includes(enumValue(values.identity_document_type))) errors.push('Identity document type must be NRC, Passport, or Other')
      if (values.gender && !['FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED'].includes(enumValue(values.gender))) errors.push('Gender must be Female, Male, Non-binary, or Undisclosed')
      if (values.employment_type && !['PERMANENT', 'FIXED_TERM', 'PART_TIME', 'CASUAL', 'DAILY_RATED'].includes(enumValue(values.employment_type))) errors.push('Employment type is not supported')
      if (values.salary_frequency && !['MONTHLY', 'FORTNIGHTLY', 'WEEKLY', 'DAILY'].includes(enumValue(values.salary_frequency))) errors.push('Salary frequency is not supported')
      if (values.payment_method && enumValue(values.payment_method) === 'BANK_TRANSFER' && (!values.bank_name || !values.bank_account_name || !values.bank_account_number)) errors.push('Bank name, account name, and account number are required for bank transfer')
      if (values.payment_method && enumValue(values.payment_method) === 'MOBILE_MONEY' && (!values.mobile_money_provider || !values.mobile_money_number)) errors.push('Mobile money provider and number are required for mobile money')
      if (values.employee_number) {
        const employeeKey = values.employee_number.toLowerCase()
        if (seen.has(employeeKey)) errors.push('Employee number is duplicated in this file')
        seen.add(employeeKey)
      }
      return { line: index + 1, values, errors }
    })
  }, [sourceRows, mapping])

  async function chooseFile(file?: File) {
    setError(''); setOutcomes([]); setConfirmed(false); setProgress(0); setHeaders([]); setSourceRows([])
    if (!file) return
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setError('Choose a CSV or XLSX file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Files must be 10 MB or smaller.'); return }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: false })
      const firstSheet = workbook.SheetNames[0]
      if (!firstSheet) { setError('The file does not contain a worksheet.'); return }
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: '' })
      const headerIndex = findImportHeaderRow(matrix)
      const nextHeaders = (matrix[headerIndex] ?? []).map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`)
      const dataRows = matrix.slice(headerIndex + 1).filter((row) => row.some((value) => String(value ?? '').trim()))
      if (!nextHeaders.length || !dataRows.length) { setError('No header row and employee rows were found. Check the selected worksheet.'); return }
      if (dataRows.length > 5000) { setError('A single import is limited to 5,000 rows. Split larger files into batches.'); return }
      setHeaders(nextHeaders)
      setMapping(mapImportHeader(nextHeaders))
      setSourceRows(dataRows.map((row) => Object.fromEntries(nextHeaders.map((header, index) => [header, row[index]]))))
      setFileName(file.name); setSheetName(firstSheet)
    } catch { setError('The file could not be read. It remains on this device and was not uploaded.') }
  }

  async function submitImport(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true); setOutcomes([]); setProgress(0)
    if (!company?.portfolioId || !branch) { setBusy(false); setError('Select an authorized company and workplace branch.'); return }
    const readyRows = rows.filter((row) => row.errors.length === 0)
    if (!confirmed || readyRows.length === 0) { setBusy(false); setError('Confirm the import and ensure at least one row passes validation.'); return }
    const service = createLiveBusinessServices(getSupabaseClient()).employees
    const results: ImportOutcome[] = []
    const chunkSize = 20
    for (let offset = 0; offset < readyRows.length; offset += chunkSize) {
      const chunk = readyRows.slice(offset, offset + chunkSize)
      const completed = await Promise.all(chunk.map(async (row): Promise<ImportOutcome> => {
        const v = row.values
        const input: EmployeeDraftInput = {
          portfolioId: company.portfolioId!, companyId: company.id, branchId: branch.id,
          employee: {
            employee_number: v.employee_number, first_name: v.first_name, middle_name: v.middle_name || null, last_name: v.last_name,
            date_of_birth: dateForImport(v.date_of_birth), gender: v.gender ? enumValue(v.gender) : null,
            nationality: v.nationality, job_title: v.job_title, department: v.department,
            employment_type: enumValue(v.employment_type), contract_type: enumValue(v.contract_type),
            contract_start_date: dateForImport(v.contract_start_date), contract_end_date: v.contract_end_date ? dateForImport(v.contract_end_date) : null,
            retirement_age: Number(v.retirement_age), retirement_status: 'NOT_RETIRED',
          } as JsonObject,
          privateDetails: {
            identity_document_type: enumValue(v.identity_document_type), identity_document_number: v.identity_document_number,
            residential_address: v.residential_address, phone: v.phone, email: v.email || null,
            email_unavailable_reason: v.email ? null : v.email_unavailable_reason,
            emergency_contact_name: v.emergency_contact_name, emergency_contact_relationship: v.emergency_contact_relationship,
            emergency_contact_phone: v.emergency_contact_phone, tpin: v.tpin || null, napsa_number: v.napsa_number || null,
            nhima_number: v.nhima_number || null, payment_method: enumValue(v.payment_method), bank_name: v.bank_name || null,
            bank_account_name: v.bank_account_name || null, bank_account_number: v.bank_account_number || null,
            bank_branch_name: v.bank_branch_name || null, mobile_money_provider: v.mobile_money_provider || null,
            mobile_money_number: v.mobile_money_number || null,
          } as JsonObject,
          compensation: {
            effective_from: dateForImport(v.contract_start_date), effective_to: v.contract_end_date ? dateForImport(v.contract_end_date) : null,
            salary_frequency: enumValue(v.salary_frequency), basic_pay: Number(v.basic_pay), housing_allowance: Number(v.housing_allowance || 0),
            meal_allowance: Number(v.meal_allowance || 0), transport_allowance: Number(v.transport_allowance || 0),
            other_allowances: Number(v.other_allowances || 0), overtime_eligible: ['true', 'yes', '1'].includes(v.overtime_eligible.toLowerCase()),
            payment_method: enumValue(v.payment_method),
          } as JsonObject,
        }
        try {
          const employeeId = await service.createDraft(input)
          try { await service.submitForHrApproval(employeeId); return { line: row.line, result: 'submitted', message: 'Submitted for HR review' } }
          catch { return { line: row.line, result: 'draft', message: 'Draft saved; HR submission failed and needs retry' } }
        } catch { return { line: row.line, result: 'failed', message: 'Record was rejected by validation or access controls' } }
      }))
      results.push(...completed)
      setOutcomes([...results]); setProgress(results.length)
    }
    setBusy(false)
  }

  const validCount = rows.filter((row) => row.errors.length === 0).length
  const invalidCount = rows.length - validCount

  return <div className="employee-screen live-import-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> LIVE SECURE IMPORT</div><h1>Import employees</h1><p>Map your own spreadsheet columns, validate locally, then submit through the authorized employee approval workflow.</p></div><Link className="button-secondary" to="/employees">Return to employees</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Files are parsed in this browser and never uploaded. Confirming saves employee records to Supabase; branch imports are submitted for HR approval. Sensitive data may appear in the local preview.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}
    <section className="panel live-import-upload"><label><Upload size={22}/><strong>{fileName || 'Choose a CSV or Excel workbook'}</strong><span>CSV or XLSX Â· maximum 10 MB Â· up to 5,000 rows per batch</span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event.target.files?.[0])}/></label>{sheetName && <p>Worksheet: {sheetName}</p>}</section>
    {headers.length > 0 && <>
      <section className="panel live-import-mapping"><header><div><div className="section-eyebrow">FIELD MAPPING</div><h2>Match spreadsheet columns</h2><p>Header suggestions are editable. Workplace branch is selected separately from any bank branch column.</p></div></header><div className="live-import-fields">{liveImportFields.map((field) => <label key={field.key}><span>{field.label}{field.required && <i> *</i>}</span><select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Not mapped</option>{headers.map((header) => <option value={header} key={`${field.key}-${header}`}>{header}</option>)}</select></label>)}</div></section>
      <section className="panel live-import-preview"><header><div><div className="section-eyebrow">LOCAL VALIDATION</div><h2>{rows.length.toLocaleString()} rows previewed</h2></div><div className="live-import-selectors"><label>Company<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId('') }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Workplace branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!company}><option value="">Select workplace branch</option>{company?.branches.filter((item) => item.status === 'Active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></header>
        <div className="live-import-summary"><strong>{validCount.toLocaleString()} ready</strong><strong>{invalidCount.toLocaleString()} need correction</strong><span>{outcomes.filter((item) => item.result === 'submitted').length.toLocaleString()} submitted Â· {outcomes.filter((item) => item.result === 'draft').length.toLocaleString()} drafts Â· {outcomes.filter((item) => item.result === 'failed').length.toLocaleString()} failed</span></div>
        {busy && <div className="live-import-progress" role="status">Processing {progress.toLocaleString()} of {validCount.toLocaleString()} valid rows in batchesâ€¦</div>}
        <div className="table-scroll"><table className="employee-table"><thead><tr><th>ROW</th><th>EMPLOYEE NUMBER</th><th>NAME</th><th>DEPARTMENT</th><th>VALIDATION</th></tr></thead><tbody>{rows.slice(0, 100).map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.values.employee_number}</td><td>{row.values.first_name} {row.values.last_name}</td><td>{row.values.department}</td><td>{row.errors.length ? row.errors.join('; ') : 'Ready to submit'}</td></tr>)}</tbody></table></div><footer>Showing first {Math.min(rows.length, 100).toLocaleString()} of {rows.length.toLocaleString()} rows. Validation covers the complete file.</footer>
      </section>
      <form className="live-import-confirm" onSubmit={(event) => void submitImport(event)}><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm these employee records are authorized for this company and branch. Valid rows will be saved in Supabase.</label><button className="button-primary" disabled={busy || !confirmed || !branch || validCount === 0}>{busy ? 'Submittingâ€¦' : `Import ${validCount.toLocaleString()} valid rows`}</button>{outcomes.length > 0 && <div role="status">{outcomes.filter((item) => item.result === 'submitted').length} rows submitted for HR approval. {outcomes.filter((item) => item.result === 'draft').length} saved as drafts requiring review. {outcomes.filter((item) => item.result === 'failed').length} were rejected.</div>}{outcomes.some((item) => item.result !== 'submitted') && <ul>{outcomes.filter((item) => item.result !== 'submitted').map((item) => <li key={item.line}>Row {item.line}: {item.message}</li>)}</ul>}<span><FileSpreadsheet size={15}/> Private fields are sent only after you confirm; local previews are cleared on page refresh.</span></form>
    </>}
  </div>
}

