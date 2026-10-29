import { useEffect, useMemo, useState, type FormEvent } from 'react'
import * as XLSX from '@e965/xlsx'
import { FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getSupabaseClient } from '../../lib/supabase/client'
import { createLiveBusinessServices, type EmployeeImportBatchInput, type EmployeeImportJobRecord, type JsonObject } from '../../services/live-business-services'
import { createLiveHrServices, type DepartmentRecord } from '../../services/live-hr-services'
import { useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { dateForImport, findImportHeaderRow, hasTemplateExampleInstruction, importAttemptKey, isAllowedTemplateBank, isValidTemplateMobileNumber, liveImportFields, mapImportHeader, preserveIdentifierText, rotateImportAttemptKey, templateFieldsWithUnsupportedData, type LiveImportField } from './live-import-model'
import './live-employee-import.css'

type SheetRow = Record<string, unknown>
type ImportRow = { line: number; values: Record<string, string>; errors: string[] }
type ImportOutcome = { line: number; result: 'submitted' | 'draft' | 'failed'; message: string }

function excelCell(value: unknown, field?: LiveImportField, displayValue?: string): string {
  if (field?.type === 'date' && typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const identifierField = field && ['employee_number', 'identity_document_number', 'phone', 'tpin', 'napsa_number', 'nhima_number', 'bank_account_number', 'mobile_money_number', 'sort_code'].includes(field.key)
  return identifierField ? preserveIdentifierText(value, displayValue) : String(value ?? '').trim()
}

function columnName(index: number) { return XLSX.utils.encode_col(index) }

function enumValue(value: string) { return value.trim().toUpperCase().replace(/[\s-]+/g, '_') }
function employmentTypeValue(value: string) {
  const normalized = enumValue(value)
  if (normalized === 'FIXED_TERM_CONTRACT') return 'FIXED_TERM'
  return normalized
}
function paymentMethodValue(value: string) {
  const normalized = enumValue(value)
  if (['AIRTEL_MONEY', 'MTN_MOMO', 'ZAMTEL_KWACHA', 'MOBILE_MONEY'].includes(normalized)) return 'MOBILE_MONEY'
  if (normalized === 'BANK_TRANSFER') return 'BANK_TRANSFER'
  if (normalized === 'CASH') return 'CASH'
  return normalized
}
function walletProvider(value: string) {
  const normalized = enumValue(value)
  if (normalized.includes('AIRTEL')) return 'AIRTEL'
  if (normalized.includes('MTN')) return 'MTN'
  if (normalized.includes('ZAMTEL')) return 'ZAMTEL'
  return value.trim()
}

export function LiveEmployeeImport() {
  const { companies } = useWorkspace()
  const { companyId, company, setCompanyId } = useCompanySelection()
  const [branchId, setBranchId] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [sourceRows, setSourceRows] = useState<SheetRow[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([])
  const [lastImportCounts, setLastImportCounts] = useState<{ created: number; updated: number } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [updateOwnedDrafts, setUpdateOwnedDrafts] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID())
  const [history, setHistory] = useState<EmployeeImportJobRecord[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [draftUpdateSupported, setDraftUpdateSupported] = useState(false)
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [departmentError, setDepartmentError] = useState('')
  const [templateHasExampleRow, setTemplateHasExampleRow] = useState(false)
  const [exampleRowRemoved, setExampleRowRemoved] = useState(false)
  const branch = company?.branches.find((item) => item.id === branchId)

  useEffect(() => {
    if (branchId && !company?.branches.some((item) => item.id === branchId)) {
      setBranchId('')
      setHistory([])
    }
  }, [companyId, company, branchId])

  useEffect(() => {
    if (!companyId) { setDepartments([]); setDepartmentError(''); return }
    let cancelled = false
    createLiveHrServices(getSupabaseClient()).catalog.departments(companyId, false)
      .then((items) => { if (!cancelled) { setDepartments(items); setDepartmentError('') } })
      .catch(() => { if (!cancelled) { setDepartments([]); setDepartmentError('Company departments could not be verified. Check your configuration access before importing.') } })
    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    if (!companyId || !company?.portfolioId || !branchId) return
    let cancelled = false
    createLiveBusinessServices(getSupabaseClient()).employees.importHistory(company.portfolioId, companyId, branchId)
      .then((result) => { if (!cancelled) { setHistory(result.items); setHistoryError('') } })
      .catch(() => { if (!cancelled) { setHistory([]); setHistoryError('Import history is unavailable under the current branch permissions.') } })
    return () => { cancelled = true }
  }, [companyId, company?.portfolioId, branchId, historyRefresh])

  useEffect(() => {
    if (!company?.portfolioId || !companyId || !branchId) { setDraftUpdateSupported(false); setUpdateOwnedDrafts(false); return }
    let cancelled = false
    createLiveBusinessServices(getSupabaseClient()).employees.supportsDraftImportUpdates(company.portfolioId, companyId, branchId)
      .then((supported) => { if (!cancelled) { setDraftUpdateSupported(supported); if (!supported) setUpdateOwnedDrafts(false) } })
      .catch(() => { if (!cancelled) { setDraftUpdateSupported(false); setUpdateOwnedDrafts(false) } })
    return () => { cancelled = true }
  }, [company?.portfolioId, companyId, branchId])

  const rows = useMemo<ImportRow[]>(() => {
    const seen = new Set<string>()
    return sourceRows.map((source, index) => {
      const values = Object.fromEntries(liveImportFields.map((field) => [field.key, excelCell(mapping[field.key] ? source[mapping[field.key]] : '', field, mapping[field.key] ? String((source.__formatted as Record<string, string> | undefined)?.[mapping[field.key]] ?? '') : undefined)]))
      const errors: string[] = []
      for (const field of liveImportFields) if (field.required && !values[field.key]) errors.push(`${field.label} is required`)
      if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) errors.push('Email is invalid')
      if (values.date_of_birth && !dateForImport(values.date_of_birth)) errors.push('Date of birth must use an unambiguous date value')
      if (values.contract_start_date && !dateForImport(values.contract_start_date)) errors.push('Employment start date is invalid')
      if (values.contract_end_date && !dateForImport(values.contract_end_date)) errors.push('Contract end date is invalid')
      const birthDate = dateForImport(values.date_of_birth)
      const employmentStart = dateForImport(values.contract_start_date)
      const employmentEnd = dateForImport(values.contract_end_date)
      if (birthDate && birthDate > new Date().toISOString().slice(0, 10)) errors.push('Date of birth cannot be in the future')
      if (employmentStart && employmentEnd && employmentEnd < employmentStart) errors.push('Contract end date cannot be before employment start date')
      for (const field of liveImportFields.filter((item) => item.type === 'number')) {
        if (values[field.key] && (!Number.isFinite(Number(values[field.key])) || Number(values[field.key]) < 0)) errors.push(`${field.label} must be zero or greater`)
      }
      for (const key of ['basic_pay', 'housing_allowance', 'transport_allowance', 'other_allowances', 'loan_or_other_deduction']) {
        if (values[key] && !/^\d+(?:\.\d{1,2})?$/.test(values[key])) errors.push(`${liveImportFields.find((field) => field.key === key)?.label ?? key} must be a plain ZMW amount with at most two decimal places`)
      }
      if (values.annual_leave_days && !/^\d+$/.test(values.annual_leave_days)) errors.push('Annual leave days must be a whole number')
      const identifierHeaders = new Set(['employee_number', 'identity_document_number', 'phone', 'tpin', 'napsa_number', 'nhima_number', 'bank_account_number', 'mobile_money_number', 'sort_code'].map((key) => mapping[key]).filter(Boolean))
      const numericIdentifierHeaders = new Set((source.__numericGeneralIdentifiers as string[] | undefined) ?? [])
      for (const header of identifierHeaders) if (numericIdentifierHeaders.has(header)) errors.push(`${header} is stored as a number in the workbook. Format that column as Text and reupload to preserve leading zeros.`)
      if (values.basic_pay && Number(values.basic_pay) <= 0) errors.push('Basic pay must be greater than zero')
      if (values.department && companyId && !departments.some((item) => item.name.trim().toLowerCase() === values.department.trim().toLowerCase())) errors.push('Department is not active in this company. Create or map it in Departments before importing.')
      if (values.payment_method && !['BANK_TRANSFER', 'CASH', 'AIRTEL_MONEY', 'MTN_MOMO', 'ZAMTEL_KWACHA'].includes(enumValue(values.payment_method))) errors.push('Pay method must be Bank transfer, Airtel Money, MTN MoMo, Zamtel Kwacha, or Cash')
      if (!values.payment_method) errors.push('Pay method is required by the employee record. Add it to the file or map its source column.')
      if (values.identity_document_type && !['NRC', 'PASSPORT', 'OTHER'].includes(enumValue(values.identity_document_type))) errors.push('Identity document type must be NRC, Passport, or Other')
      if (values.gender && !['FEMALE', 'MALE'].includes(enumValue(values.gender))) errors.push('Gender must be Male or Female')
      if (values.employment_type && !['PERMANENT', 'FIXED_TERM_CONTRACT', 'CASUAL', 'INTERN'].includes(enumValue(values.employment_type))) errors.push('Employment type must be Permanent, Fixed-term contract, Casual, or Intern.')
      if (values.salary_frequency && !['MONTHLY', 'FORTNIGHTLY', 'WEEKLY', 'DAILY'].includes(enumValue(values.salary_frequency))) errors.push('Salary frequency is not supported')
      const method = paymentMethodValue(values.payment_method)
      if (values.payment_method && method === 'BANK_TRANSFER' && (!values.bank_name || !values.bank_account_name || !values.bank_account_number)) errors.push('Bank name, account name, and account number are required for bank transfer')
      if (method === 'BANK_TRANSFER' && values.bank_name && !isAllowedTemplateBank(values.bank_name)) errors.push('Choose a bank name listed in the workbook instructions')
      if (values.payment_method && method === 'MOBILE_MONEY' && !values.mobile_money_number) errors.push('Mobile money number is required for mobile money')
      if (method === 'MOBILE_MONEY' && values.mobile_money_number && !isValidTemplateMobileNumber(values.mobile_money_number, values.payment_method)) errors.push('Mobile money number must be 10 digits and match the selected Airtel, MTN, or Zamtel network')
      if (!values.date_of_birth) errors.push('Date of birth is required by the employee record. Add it to the file or map its source column.')
      if (!values.nationality) errors.push('Nationality is required by the employee record. Add it to the file or map its source column.')
      if (!values.job_title) errors.push('Job title is required by the employee record. Add it to the file or map its source column.')
      if (!values.department) errors.push('Department is required by the employee record. Add it to the file or map its source column.')
      if (!values.employment_type) errors.push('Employment type is required by the employee record. Add it to the file or map its source column.')
      if (!values.phone) errors.push('Phone is required by the employee record. Add it to the file or map its source column.')
      if (!values.residential_address) errors.push('Residential address is required by the employee record. Add it to the file or map its source column.')
      if (!values.emergency_contact_name || !values.emergency_contact_relationship || !values.emergency_contact_phone) errors.push('Emergency contact name, relationship, and phone are required by the employee record.')
      if (!values.contract_start_date) errors.push('Start date is required by the employee record. Add it to the file or map its source column.')
      if (!values.contract_type) errors.push('Contract type is required by the employee record. Add it to the file or map its source column.')
      if (!values.salary_frequency) errors.push('Salary frequency is required by the compensation record. Add it to the file or map its source column.')
      for (const unsupported of templateFieldsWithUnsupportedData(headers, headers.filter((header) => source[header] != null && String(source[header]).trim() !== ''))) {
        const label = unsupported.replace(/\s*\*$/, '')
        errors.push(`${label} has a value, but this import endpoint cannot safely store it yet. No rows will be submitted until it is handled.`)
      }
      if (enumValue(values.employment_type) === 'INTERN') errors.push('Intern employment type is not supported by the current employee record. No rows will be submitted.')
      if (values.employment_status && !['ACTIVE', 'EXITED'].includes(enumValue(values.employment_status))) errors.push('Status must be Active or Exited')
      if (enumValue(values.employment_status) === 'EXITED') errors.push('Exited status requires the approved employment-status workflow and cannot be set by employee import.')
      if (values.employee_number) {
        const employeeKey = values.employee_number.toLowerCase()
        if (seen.has(employeeKey)) errors.push('Employee number is duplicated in this file')
        seen.add(employeeKey)
      }
      const sourceLine = Number(source.__sourceLine)
      return { line: Number.isSafeInteger(sourceLine) && sourceLine > 0 ? sourceLine : index + 1, values, errors }
    })
  }, [sourceRows, mapping, companyId, departments, headers])

  async function chooseFile(file?: File) {
    setError(''); setOutcomes([]); setLastImportCounts(null); setConfirmed(false); setUpdateOwnedDrafts(false); setHeaders([]); setSourceRows([]); setTemplateHasExampleRow(false); setExampleRowRemoved(false)
    if (!file) return
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setError('Choose a CSV or XLSX file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Files must be 10 MB or smaller.'); return }
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: false })
      const firstSheet = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'employees') ?? workbook.SheetNames[0]
      if (!firstSheet) { setError('The file does not contain a worksheet.'); return }
      const instructionName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'instructions')
      if (instructionName) {
        const instructionRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[instructionName], { header: 1, raw: true, defval: '' })
        setTemplateHasExampleRow(hasTemplateExampleInstruction(instructionRows))
      }
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: '' })
      const headerIndex = findImportHeaderRow(matrix)
      const nextHeaders = (matrix[headerIndex] ?? []).map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`)
      const dataRows = matrix.slice(headerIndex + 1).map((row, index) => ({ row, line: headerIndex + index + 2 })).filter(({ row }) => row.some((value) => String(value ?? '').trim()))
      if (!nextHeaders.length || !dataRows.length) { setError('No header row and employee rows were found. Check the selected worksheet.'); return }
      if (dataRows.length > 5000) { setError('A single import is limited to 5,000 rows. Split larger files into batches.'); return }
      setHeaders(nextHeaders)
      setMapping(mapImportHeader(nextHeaders))
      const sheet = workbook.Sheets[firstSheet]
      setSourceRows(dataRows.map(({ row, line }) => {
        const formatted: Record<string, string> = {}
        const numericGeneralIdentifiers: string[] = []
        nextHeaders.forEach((header, index) => {
          const cell = sheet[`${columnName(index)}${line}`]
          if (cell?.w != null) formatted[header] = String(cell.w)
          if (cell?.t === 'n' && (!cell.z || cell.z === 'General')) numericGeneralIdentifiers.push(header)
        })
        return { ...Object.fromEntries(nextHeaders.map((header, index) => [header, row[index]])), __formatted: formatted, __numericGeneralIdentifiers: numericGeneralIdentifiers, __sourceLine: line }
      }))
      setFileName(file.name); setSheetName(firstSheet)
    } catch { setError('The file could not be read. It remains on this device and was not uploaded.') }
  }

  async function submitImport(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true); setOutcomes([])
    if (!company?.portfolioId || !branch) { setBusy(false); setError('Select an authorized company and workplace branch.'); return }
    if (templateHasExampleRow && !exampleRowRemoved) { setBusy(false); setError('Remove the example employee row named in the workbook instructions, then confirm it is no longer in the preview.'); return }
    const readyRows = rows.filter((row) => row.errors.length === 0)
    if (!confirmed || readyRows.length === 0) { setBusy(false); setError('Confirm the import and ensure at least one row passes validation.'); return }
    const batch: EmployeeImportBatchInput[] = readyRows.map((row) => {
        const v = row.values
        return {
          line: row.line,
          operation: updateOwnedDrafts && draftUpdateSupported ? 'SAFE_UPSERT_DRAFT' : 'CREATE',
          employee: {
            employee_number: v.employee_number, first_name: v.first_name, middle_name: v.middle_name || null, last_name: v.last_name,
            date_of_birth: dateForImport(v.date_of_birth), gender: v.gender ? enumValue(v.gender) : null,
            nationality: v.nationality, job_title: v.job_title, department: v.department,
            employment_type: employmentTypeValue(v.employment_type), contract_type: enumValue(v.contract_type),
            contract_start_date: dateForImport(v.contract_start_date), contract_end_date: v.contract_end_date ? dateForImport(v.contract_end_date) : null,
            retirement_age: Number(v.retirement_age || 65), retirement_status: 'NOT_RETIRED',
          } as JsonObject,
          privateDetails: {
            identity_document_type: v.identity_document_type ? enumValue(v.identity_document_type) : v.identity_document_number ? 'NRC' : '', identity_document_number: v.identity_document_number,
            residential_address: v.residential_address, phone: v.phone, email: v.email || null,
            email_unavailable_reason: v.email ? null : v.email_unavailable_reason || 'Not provided in import file',
            emergency_contact_name: v.emergency_contact_name, emergency_contact_relationship: v.emergency_contact_relationship,
            emergency_contact_phone: v.emergency_contact_phone, tpin: v.tpin || null, napsa_number: v.napsa_number || null,
            nhima_number: v.nhima_number || null, payment_method: paymentMethodValue(v.payment_method), bank_name: v.bank_name || null,
            bank_account_name: v.bank_account_name || null, bank_account_number: v.bank_account_number || null,
            bank_branch_name: v.bank_branch_name || null, mobile_money_provider: paymentMethodValue(v.payment_method) === 'MOBILE_MONEY' ? walletProvider(v.mobile_money_provider || v.payment_method) : null,
            mobile_money_number: v.mobile_money_number || null,
          } as JsonObject,
          compensation: {
            effective_from: dateForImport(v.contract_start_date), effective_to: v.contract_end_date ? dateForImport(v.contract_end_date) : null,
            salary_frequency: enumValue(v.salary_frequency), basic_pay: Number(v.basic_pay), housing_allowance: Number(v.housing_allowance || 0),
            meal_allowance: Number(v.meal_allowance || 0), transport_allowance: Number(v.transport_allowance || 0),
            other_allowances: Number(v.other_allowances || 0), overtime_eligible: ['true', 'yes', '1'].includes(v.overtime_eligible.toLowerCase()),
            payment_method: paymentMethodValue(v.payment_method),
          } as JsonObject,
        }
    })
    const payloadSize = new TextEncoder().encode(JSON.stringify(batch)).byteLength
    if (payloadSize > 5_500_000) { setBusy(false); setError('The validated import payload exceeds the secure 5.5 MB request limit. Split the workbook into smaller files.'); return }
    try {
      const result = await createLiveBusinessServices(getSupabaseClient()).employees.importBatch({
        portfolioId: company.portfolioId, companyId: company.id, branchId: branch.id, idempotencyKey, rows: batch,
      })
      if (result.status === 'COMPLETED') {
        setLastImportCounts({ created: result.imported_rows, updated: result.updated_rows })
        setOutcomes(readyRows.map((row) => ({ line: row.line, result: 'submitted', message: 'Submitted for HR review' })))
      } else {
        const errorsByLine = new Map<number, string[]>()
        for (const issue of result.errors) {
          if (typeof issue.line !== 'number') continue
          errorsByLine.set(issue.line, [...(errorsByLine.get(issue.line) ?? []), issue.message])
        }
        setOutcomes(readyRows.map((row) => ({ line: row.line, result: 'failed', message: errorsByLine.get(row.line)?.join('; ') ?? (result.status === 'FAILED' ? 'Atomic import failed; no employee rows were saved.' : 'Import validation failed.') })))
        setError(result.status === 'VALIDATION_FAILED' ? 'Some employee numbers are duplicated or cannot be updated under this import mode. No rows were changed; review the row errors and choose the matching-draft option only for drafts you created.' : 'The import could not be completed. No employee rows were saved or changed.')
      }
      setIdempotencyKey(rotateImportAttemptKey(company.id, branch.id))
    } catch {
      // Reusing this job key after a network timeout returns the committed job
      // instead of creating duplicate employee records.
      setError('Import status could not be confirmed. Retry this exact file and scope to safely retrieve the idempotent job result.')
    } finally { setBusy(false); setHistoryRefresh((value) => value + 1) }
  }

  const validCount = rows.filter((row) => row.errors.length === 0).length
  const invalidCount = rows.length - validCount

  return <div className="employee-screen live-import-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> BULK ONBOARDING</div><h1>Import employees</h1><p>Map spreadsheet columns, review validation results, then submit employees for HR approval.</p></div><Link className="button-secondary" to="/employees">Return to employees</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Files are read on this device; no data is sent until you confirm. This preview includes private employee and pay details, so keep your screen private. Confirming submits the employees for HR approval.</div>
    {templateHasExampleRow && <div className="auth-shell-error" role="note"><strong>Template example row:</strong> the workbook instructions say to replace its example row. Remove that row before continuing.<label className="live-import-example-check"><input type="checkbox" checked={exampleRowRemoved} onChange={(event) => setExampleRowRemoved(event.target.checked)} /> I removed the template example row from this file.</label></div>}
    {error && <div className="auth-shell-error" role="alert">{error}</div>}
    {error.startsWith('Import status could not be confirmed') && company && branch && <p role="status">The same company, branch, and idempotency key are retained for a safe retry in this browser tab. <button type="button" className="button-secondary" onClick={() => setIdempotencyKey(rotateImportAttemptKey(company.id, branch.id))}>Start a separate import attempt</button> A new attempt checks employee numbers already saved.</p>}
      <section className="panel live-import-upload"><label><Upload size={22}/><strong>{fileName || 'Choose a CSV or Excel workbook'}</strong><span>CSV or XLSX · file maximum 10 MB · one atomic server job up to 5,000 rows (5.5 MB mapped request)</span><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event.target.files?.[0])}/></label>{sheetName && <p>Worksheet: {sheetName}</p>}</section>
    {headers.length > 0 && <>
      <section className="panel live-import-mapping"><header><div><div className="section-eyebrow">FIELD MAPPING</div><h2>Match spreadsheet columns</h2><p>Header suggestions are editable. Workplace branch is selected separately from any bank branch column.</p></div></header><div className="live-import-fields">{liveImportFields.map((field) => <label key={field.key}><span>{field.label}{field.required && <i> *</i>}</span><select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Not mapped</option>{headers.map((header) => <option value={header} key={`${field.key}-${header}`}>{header}</option>)}</select></label>)}</div></section>
      <section className="panel live-import-preview"><header><div><div className="section-eyebrow">LOCAL VALIDATION</div><h2>{rows.length.toLocaleString()} rows previewed</h2></div><div className="live-import-selectors"><label>Company<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId(''); setHistory([]) }}><option value="">Select company</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Workplace branch<select value={branchId} onChange={(event) => { const nextBranchId = event.target.value; setBranchId(nextBranchId); setIdempotencyKey(nextBranchId ? importAttemptKey(companyId, nextBranchId) : crypto.randomUUID()); setHistory([]) }} disabled={!company}><option value="">Select workplace branch</option>{company?.branches.filter((item) => item.status === 'Active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></header>
        {departmentError && <p role="alert">{departmentError}</p>}
        {draftUpdateSupported ? <label className="live-import-update-mode"><input type="checkbox" checked={updateOwnedDrafts} onChange={(event) => { setUpdateOwnedDrafts(event.target.checked); setConfirmed(false) }} /> Update matching employee numbers when the record is a draft or returned for correction that I created. New numbers still create employees; approved records and records from another branch or user are rejected.</label> : <p className="live-import-update-mode-note">Matching employee updates are unavailable until the controlled update workflow is enabled for this company and branch. New employee imports remain available.</p>}
        {rows.some((row) => row.errors.some((message) => message.startsWith('Department is not active'))) && <p className="live-form-hint">Use <Link to="/departments">Departments</Link> to create or activate the department for this company, then return to the import. Your configuration access is checked when the department is saved.</p>}
        <div className="live-import-summary"><strong>{validCount.toLocaleString()} ready</strong><strong>{invalidCount.toLocaleString()} need correction</strong><span>{outcomes.filter((item) => item.result === 'submitted').length.toLocaleString()} submitted · {outcomes.filter((item) => item.result === 'draft').length.toLocaleString()} drafts · {outcomes.filter((item) => item.result === 'failed').length.toLocaleString()} failed</span></div>
        {busy && <div className="live-import-progress" role="status">Submitting {validCount.toLocaleString()} validated rows in one atomic server transaction…</div>}
        <div className="table-scroll"><table className="employee-table"><thead><tr><th>ROW</th><th>EMPLOYEE NUMBER</th><th>NAME</th><th>DEPARTMENT</th><th>VALIDATION</th></tr></thead><tbody>{rows.slice(0, 100).map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.values.employee_number}</td><td>{row.values.first_name} {row.values.last_name}</td><td>{row.values.department}</td><td>{row.errors.length ? row.errors.join('; ') : 'Ready to submit'}</td></tr>)}</tbody></table></div><footer>Showing first {Math.min(rows.length, 100).toLocaleString()} of {rows.length.toLocaleString()} rows. Validation covers the complete file.</footer>
      </section>
      <form className="live-import-confirm" onSubmit={(event) => void submitImport(event)}><label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm these employee records are authorized for this company and branch. Valid rows will be submitted for HR review{updateOwnedDrafts ? ', and matching drafts I created may be corrected and resubmitted' : ''}.</label><button className="button-primary" disabled={busy || !confirmed || !branch || (templateHasExampleRow && !exampleRowRemoved) || validCount === 0}>{busy ? 'Submitting…' : `${updateOwnedDrafts ? 'Import or update' : 'Import'} ${validCount.toLocaleString()} valid rows`}</button>{outcomes.length > 0 && <div role="status">{lastImportCounts ? `${lastImportCounts.created} new employees created and ${lastImportCounts.updated} draft records corrected; all submitted for HR review.` : `${outcomes.filter((item) => item.result === 'submitted').length} rows submitted for HR approval.`} {outcomes.filter((item) => item.result === 'failed').length} were rejected.</div>}{outcomes.some((item) => item.result !== 'submitted') && <ul>{outcomes.filter((item) => item.result !== 'submitted').map((item) => <li key={item.line}>Row {item.line}: {item.message}</li>)}</ul>}<span><FileSpreadsheet size={15}/> Private fields are sent only after you confirm; local previews are cleared on page refresh.</span></form>
    </>}
    {companyId && branchId && <section className="panel live-import-history" aria-label="Employee import history"><header><div><div className="section-eyebrow">IMPORT HISTORY</div><h2>Recent import history</h2></div></header>{historyError && <p role="alert">{historyError}</p>}{!historyError && !history.length && <p>No import jobs are available for this branch yet.</p>}{history.map((job) => <div key={job.id}><span>{new Date(job.created_at).toLocaleString()}</span><strong>{job.status.replaceAll('_', ' ')}</strong><span>{job.imported_rows.toLocaleString()} new · {job.updated_rows.toLocaleString()} updated / {job.total_rows.toLocaleString()} rows</span><small>{job.errors[0]?.message ?? 'No row errors'}</small></div>)}</section>}
  </div>
}
