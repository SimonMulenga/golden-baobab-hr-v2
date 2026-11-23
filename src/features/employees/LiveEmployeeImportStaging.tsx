import { useEffect, useMemo, useState } from 'react'
import { Check, FileSpreadsheet, Save, ShieldCheck, Upload, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { getSupabaseClient } from '../../lib/supabase/client'
import { useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { createEmployeeImportStagingService, sha256File, type StagingRecord } from './employee-import-staging-service'
import { detectEmployeeUploadFormat, duplicateWarningsForRow, extractEmployeeWorkbook, matchingInactiveImportBranch, missingOptionalEmployeeFields, recalculateStagedHousingAllowance, validateStagedEmployee, type StagedWorkbookRow } from './employee-import-staging'
import { allowedTemplateBanks, employeeTemplateValues, liveImportFields, type EmployeeFieldMapping } from './live-import-model'
import { createLiveHrServices, type DepartmentRecord } from '../../services/live-hr-services'
import { calculateGrossEarningsPreview, downloadEmployeeTemplate } from './employee-import-template'
import './live-employee-import.css'
import '../../module-modernization.css'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const reviewSelectOptions: Record<string, { value: string; label: string }[]> = {
  gender: employeeTemplateValues.gender.map((label) => ({ value: label.toUpperCase(), label })),
  employment_type: employeeTemplateValues.employmentType.map((label) => ({ value: label.toUpperCase().replaceAll('-', '_'), label })),
  salary_frequency: employeeTemplateValues.salaryFrequency.map((label) => ({ value: label.toUpperCase(), label })),
  payment_method: [
    { value: 'BANK_TRANSFER', label: 'Bank transfer' }, { value: 'MOBILE_MONEY', label: 'Mobile money' }, { value: 'CASH', label: 'Cash' },
  ],
  bank_name: allowedTemplateBanks.map((value) => ({ value, label: value })),
  mobile_money_provider: employeeTemplateValues.mobileMoneyProvider.map((label) => ({
    value: label.startsWith('Airtel') ? 'AIRTEL' : label.startsWith('MTN') ? 'MTN' : 'ZAMTEL', label,
  })),
}
async function batchKey(portfolioId: string, digest: string, rows: StagedWorkbookRow[]) {
  const rowDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows.map((row) => [row.source_sheet, row.source_row]))))
  const rowKey = Array.from(new Uint8Array(rowDigest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `gbhr-staging:${portfolioId}:${digest}:${rowKey}`.slice(0, 160)
}
function excelColumnLabel(index: number) {
  let value = index + 1
  let label = ''
  while (value > 0) { value--; label = String.fromCharCode(65 + (value % 26)) + label; value = Math.floor(value / 26) }
  return label
}
function submitKey(recordId: string) {
  const key = `gbhr-staged-submit:${recordId}`
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const next = crypto.randomUUID()
    sessionStorage.setItem(key, next)
    return next
  } catch { return `staged:${recordId}:${crypto.randomUUID()}` }
}

export function LiveEmployeeImportStaging({ approvalRecordId, canApprove = false, onClose, onChanged }: { approvalRecordId?: string; canApprove?: boolean; onClose?: () => void; onChanged?: () => void }) {
  const navigate = useNavigate()
  const { companies } = useWorkspace()
  const { companyId } = useCompanySelection()
  const [fileName, setFileName] = useState('')
  const [portfolioId, setPortfolioId] = useState('')
  const [records, setRecords] = useState<StagedWorkbookRow[]>([])
  const [sourceBuffer, setSourceBuffer] = useState<ArrayBuffer | null>(null)
  const [worksheetMappings, setWorksheetMappings] = useState<{ sheet: string; headerRow: number; headers: string[]; mapping: EmployeeFieldMapping; conflicts: string[] }[]>([])
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, EmployeeFieldMapping>>({})
  const [selectedMappingSheet, setSelectedMappingSheet] = useState('')
  const [exclusions, setExclusions] = useState<{ sheet: string; row: number; reason: string }[]>([])
  const [sheetSummary, setSheetSummary] = useState<{ sheet: string; extracted: number; excluded: number }[]>([])
  const [reconciliation, setReconciliation] = useState<Record<string, unknown>>({})
  const [stagedRows, setStagedRows] = useState<StagingRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [reviewHistory, setReviewHistory] = useState<{ id: number; actor_id: string; action: string; reason: string | null; changed_fields: string[]; occurred_at: string }[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [draftPayroll, setDraftPayroll] = useState<Record<string, unknown>>({})
  const [draftCompanyId, setDraftCompanyId] = useState<string | null>(null)
  const [draftBranchId, setDraftBranchId] = useState<string | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [confirmDistinctMatch, setConfirmDistinctMatch] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [excludedDetails, setExcludedDetails] = useState(false)
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [companyDepartments, setCompanyDepartments] = useState<Record<string, DepartmentRecord[]>>({})
  const [departmentLoading, setDepartmentLoading] = useState(false)
  const [departmentError, setDepartmentError] = useState('')
  const [approvalDialogLoading, setApprovalDialogLoading] = useState(false)

  const currentCompany = companies.find((item) => item.id === companyId)
  const portfolioCompanies = companies.filter((item) => !portfolioId || item.portfolioId === portfolioId)
  const selectedRecord = stagedRows.find((item) => item.id === selectedRecordId) ?? null
  const validationErrors = useMemo(() => {
    const errors = validateStagedEmployee(draft, draftCompanyId ?? '', draftBranchId ?? '')
    if (draftCompanyId && draft.department?.trim()) {
      if (departmentLoading) errors.push('Wait for active departments in the selected company to finish loading')
      else if (departmentError) errors.push('Active department access could not be verified; retry before marking ready')
      else if (departments.length === 0) errors.push('No departments are visible for this company; confirm department setup and access before approval')
      else if (!departments.some((department) => department.name.trim().toLowerCase() === draft.department.trim().toLowerCase())) {
        const inactiveMatch = departments.some((department) => department.name.trim().toLowerCase() === draft.department.trim().toLowerCase() && department.status.toLowerCase() !== 'active')
        errors.push(inactiveMatch ? 'Department is inactive; select an active department before approval' : 'Department is not recognized in this company; select an existing active department before approval')
      }
    }
    const matchesSavedRecord = selectedRecord
      && JSON.stringify(draft) === JSON.stringify(selectedRecord.current_data)
      && draftCompanyId === selectedRecord.company_id
      && draftBranchId === selectedRecord.branch_id
    if (selectedRecord && matchesSavedRecord) errors.push(...selectedRecord.validation_errors.map((issue) => issue.message))
    return [...new Set(errors)]
  }, [draft, draftCompanyId, draftBranchId, departments, departmentLoading, departmentError, selectedRecord])
  const grossPreview = useMemo(() => calculateGrossEarningsPreview(draft, false), [draft])
  const mappingConflicts = worksheetMappings.flatMap((sheet) => sheet.conflicts.map((issue) => `${sheet.sheet}: ${issue}`))
  function previewIssues(row: StagedWorkbookRow, index: number) {
    const issues = validateStagedEmployee(row.current_data, row.company_id ?? '', row.branch_id ?? '')
    issues.push(...duplicateWarningsForRow(row, records.filter((_, otherIndex) => otherIndex !== index)))
    if (row.company_id && row.current_data.department.trim()) {
      const dept = companyDepartments[row.company_id] ?? []
      if (!dept.some((item) => item.name.trim().toLowerCase() === row.current_data.department.trim().toLowerCase() && item.status.toLowerCase() === 'active')) {
        issues.push('Department is not registered and active for the selected company')
      }
    }
    return [...new Set(issues)]
  }
  const previewNeedsAttention = records.filter((row,index) => previewIssues(row,index).length > 0).length
  const previewReadyForReview = records.length - previewNeedsAttention
  const previewIncomplete = records.filter((row,index) => previewIssues(row,index).length===0&&missingOptionalEmployeeFields(row.current_data).length>0).length
  useEffect(() => {
    if (approvalRecordId) return
    if (currentCompany?.portfolioId && !portfolioId) setPortfolioId(currentCompany.portfolioId)
  }, [approvalRecordId, currentCompany?.portfolioId, portfolioId])

  useEffect(() => {
    if (!approvalRecordId) return
    let active = true
    setApprovalDialogLoading(true); setError('')
    const service = createEmployeeImportStagingService(getSupabaseClient())
    void service.getRecord(approvalRecordId).then(async (record) => {
      const [rows, history] = await Promise.all([service.listRecords(record.batch_id), service.listHistory(record.id)])
      if (!active) return
      setPortfolioId(record.portfolio_id)
      setStagedRows(rows)
      setSelectedRecordId(record.id)
      setDraft(record.current_data)
      setDraftPayroll(record.payroll_data)
      setDraftCompanyId(record.company_id)
      setDraftBranchId(record.branch_id)
      setReviewHistory(history as typeof reviewHistory)
      setApprovalDialogLoading(false)
    }).catch(() => {
      if (active) { setError('This imported employee is unavailable under your current company permissions.'); setApprovalDialogLoading(false) }
    })
    return () => { active = false }
  }, [approvalRecordId])

  useEffect(() => {
    if (!draftCompanyId) { setDepartments([]); setDepartmentError(''); setDepartmentLoading(false); return }
    let active = true
    setDepartmentLoading(true); setDepartmentError('')
    createLiveHrServices(getSupabaseClient()).catalog.departments(draftCompanyId, true)
      .then((items) => { if (active) setDepartments(items) })
      .catch((reason: unknown) => {
        if (!active) return
        const failure = reason as { code?: string; status?: number; message?: string }
        const denied = failure?.status === 401 || failure?.status === 403 || failure?.code === '42501'
        const network = failure instanceof TypeError || /network|fetch|timeout/i.test(failure?.message ?? '')
        setDepartments([])
        setDepartmentError(denied
          ? 'Department access was denied. Ask an administrator to verify your company permissions; the row can still be saved for review.'
          : network
            ? 'Departments could not be loaded because the service is unreachable. Retry when the connection is restored; the row can still be saved for review.'
            : 'The department directory could not be loaded. Retry or ask an administrator to check the service; the row can still be saved for review.')
      })
      .finally(() => { if (active) setDepartmentLoading(false) })
    return () => { active = false }
  }, [draftCompanyId])

  async function chooseFile(file?: File) {
    setError(''); setNotice(''); setRecords([]); setExclusions([]); setSheetSummary([]); setWorksheetMappings([]); setMappingOverrides({}); setSourceBuffer(null); setFileName('')
    if (!file) return
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Choose an .xlsx, .xls, or .csv employee file.'); return }
    if (!file.size || file.size > MAX_FILE_SIZE) { setError('File must be smaller than 20 MB.'); return }
    const authorizedPortfolioIds = [...new Set(companies.map((item) => item.portfolioId))]
    const chosenPortfolio = currentCompany?.portfolioId ?? (authorizedPortfolioIds.length === 1 ? authorizedPortfolioIds[0] : '')
    if (!chosenPortfolio) { setError('Choose an authorized company workspace or portfolio before preparing a batch.'); return }
    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      detectEmployeeUploadFormat(file.name, buffer)
      const extracted = extractEmployeeWorkbook(buffer, companies.filter((item) => item.portfolioId === chosenPortfolio), {}, currentCompany?.portfolioId === chosenPortfolio ? currentCompany.id : undefined)
      if (extracted.records.length === 0) throw new Error('No employee rows were found in the workbook worksheets.')
      const companyRows = companies.filter((item) => item.portfolioId === chosenPortfolio)
      const loadedDepartments = await Promise.all(companyRows.map(async (company) => {
        try { return [company.id, await createLiveHrServices(getSupabaseClient()).catalog.departments(company.id, true)] as const }
        catch { return [company.id, [] as DepartmentRecord[]] as const }
      }))
      setCompanyDepartments(Object.fromEntries(loadedDepartments))
      setPortfolioId(chosenPortfolio); setFileName(file.name); setSourceBuffer(buffer); setRecords(extracted.records); setExclusions(extracted.exclusions)
      setWorksheetMappings(extracted.worksheetMappings); setSelectedMappingSheet(extracted.worksheetMappings[0]?.sheet ?? '')
      setSheetSummary(extracted.sheetSummary); setReconciliation(extracted.reconciliation)
      setNotice('Workbook parsed locally. Review every company and branch assignment, then stage it for secure HR review.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Workbook could not be parsed.') }
    finally { setBusy(false) }
  }

  function changeMapping(sheetName: string, fieldKey: string, columnValue: string) {
    if (!sourceBuffer) return
    const sheet = worksheetMappings.find((item) => item.sheet === sheetName)
    if (!sheet) return
    const mapping = { ...sheet.mapping, [fieldKey]: columnValue === '' ? null : Number(columnValue) }
    const overrides = { ...mappingOverrides, [sheetName]: mapping }
    const extracted = extractEmployeeWorkbook(sourceBuffer, companies.filter((item) => item.portfolioId === portfolioId), overrides, currentCompany?.portfolioId === portfolioId ? currentCompany.id : undefined)
    setMappingOverrides(overrides); setWorksheetMappings(extracted.worksheetMappings); setRecords(extracted.records)
    setExclusions(extracted.exclusions); setSheetSummary(extracted.sheetSummary); setReconciliation(extracted.reconciliation)
  }

  function assignCompany(index: number, targetCompanyId: string) {
    const target = companies.find((item) => item.id === targetCompanyId)
    setRecords((items) => items.map((row, rowIndex) => rowIndex === index ? {
      ...row, company_id: targetCompanyId || null, branch_id: null,
      current_data: { ...row.current_data, company_name: target?.name ?? row.current_data.company_name, branch_name: '', department: '' },
    } : row))
  }
  function assignBranch(index: number, branchId: string) {
    setRecords((items) => items.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const company = companies.find((item) => item.id === row.company_id)
      const branch = company?.branches.find((item) => item.id === branchId)
      return { ...row, branch_id: branchId || null, current_data: { ...row.current_data, branch_name: branch?.name ?? '' } }
    }))
  }
  function assignDepartment(index: number, departmentName: string) {
    setRecords((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, current_data: { ...row.current_data, department: departmentName } } : row))
  }

  async function stageWorkbook() {
    setError(''); setNotice('')
    if (!portfolioId) { setError('No authorized portfolio context is available. Select an authorized company workspace, then retry.'); return }
    if (!fileName || records.length === 0) { setError('Choose and review a workbook first.'); return }
    if (mappingConflicts.length) { setError(`Resolve ambiguous column mappings before staging: ${mappingConflicts.join('; ')}`); return }
    if (records.length > 5000) { setError('A single staging batch is limited to 5,000 employee rows.'); return }
    const duplicateRowKeys = new Set(records.flatMap((row,index) => duplicateWarningsForRow(row,records.filter((_,otherIndex)=>otherIndex!==index)).length ? [`${row.source_sheet}:${row.source_row}`] : []))
    const assignedRows = records.filter((row) => Boolean(row.company_id) && !duplicateRowKeys.has(`${row.source_sheet}:${row.source_row}`))
    const unresolvedRows = records.filter((row) => !row.company_id || duplicateRowKeys.has(`${row.source_sheet}:${row.source_row}`))
    if (!assignedRows.length) { setError(records.some((row) => row.company_id) ? 'Resolve the duplicate employee number, identity or name conflicts shown in the preview before staging.' : 'Select a registered company for at least one row before staging. Rows with unknown or ambiguous companies remain available to correct in this preview.'); return }
    setBusy(true)
    try {
      const fileInput = document.querySelector<HTMLInputElement>('#employee-staging-file')?.files?.[0]
      if (!fileInput) throw new Error('Select the workbook again to stage it.')
      const digest = await sha256File(await fileInput.arrayBuffer())
      const groups = new Map<string, StagedWorkbookRow[]>()
      for (const row of assignedRows) {
        const key = `${row.company_id}:${row.branch_id ?? ''}`
        groups.set(key, [...(groups.get(key) ?? []), row])
      }
      const failedRows: StagedWorkbookRow[] = []
      const summaries: string[] = []
      const replayedGroups: boolean[] = []
      for (const groupRows of groups.values()) {
        try {
          const groupSheets = sheetSummary.map((sheet) => ({ ...sheet, extracted: groupRows.filter((row) => row.source_sheet === sheet.sheet).length }))
          const groupReconciliation = { ...reconciliation, row_count: groupRows.length,
            basic_salary_total: groupRows.reduce((sum,row)=>sum+(Number(row.current_data.basic_pay)||0),0) }
          const result = await createEmployeeImportStagingService(getSupabaseClient()).createBatch({
            portfolioId, filename: fileName, sourceSha256: digest,
            idempotencyKey: await batchKey(portfolioId, digest, groupRows), records: groupRows, sheetSummary: groupSheets,
            reconciliation: { ...groupReconciliation, excluded: exclusions },
          })
          summaries.push(`${result.total_records} employee row${result.total_records === 1 ? '' : 's'} staged`)
          replayedGroups.push(result.replayed)
        } catch {
          failedRows.push(...groupRows)
        }
      }
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      const savedNotice = summaries.length ? `${summaries.join('; ')} for secure HR review.` : ''
      const remainingRows = [...unresolvedRows, ...failedRows]
      setRecords(remainingRows)
      if (remainingRows.length) {
        setNotice(`${savedNotice} ${remainingRows.length} row${remainingRows.length === 1 ? '' : 's'} remain in the preview. Correct missing or ambiguous organization details and duplicate values. Rows that could not be staged may require an authorized import permission for their selected company and branch.`.trim())
        if (failedRows.length) setError(`${failedRows.length} row${failedRows.length === 1 ? '' : 's'} could not be staged. Check company and branch access; no success was reported for those rows.`)
        return
      }
      setFileName('')
      const inputElement = document.querySelector<HTMLInputElement>('#employee-staging-file')
      if (inputElement) inputElement.value = ''
      navigate('/employee-approvals', { state: { employeeImportNotice: replayedGroups.some(Boolean) ? `Previously staged workbook rows were confirmed. ${savedNotice}` : savedNotice } })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Batch could not be staged. No success was reported; verify the batch list before retrying.') }
    finally { setBusy(false) }
  }

  function changeField(field: string, value: string) { setDraft((previous) => recalculateStagedHousingAllowance(previous, field, value)) }
  function resolveHousingAllowance(resolution: 'USE_CALCULATED' | 'USE_UPLOADED') {
    setDraft((previous) => ({ ...previous, housing_allowance_resolution: resolution, housing_allowance: resolution === 'USE_CALCULATED' ? (previous.housing_allowance_proposed ?? '') : previous.housing_allowance }))
  }

  const totalSalary = Number(reconciliation.basic_salary_total ?? 0)
  const reportSummary = reconciliation.consolidated_report as { worksheet?: string; employee_count?: number | null; basic_subtotal?: number | null; broken_formulas?: { cell: string; row: number; error: string }[] } | null
  function downloadReconciliation() {
    const rows: unknown[][] = [['worksheet','excel_row','classification','company_location','status','validation_errors','duplicate_warnings','detail']]
    for (const item of sheetSummary) rows.push([item.sheet,'','STAGED_CANDIDATES',companies.find((company)=>company.portfolioId===portfolioId)?.name??'',`${item.extracted} candidate rows; ${item.excluded} excluded`])
    for (const item of exclusions) rows.push([item.sheet,item.row,'EXCLUDED','','','','',item.reason])
    for (const row of (records.length ? records : stagedRows)) {
      const location=Object.entries(row.original_data).find(([key])=>['location','company','company name','employing company','workplace'].includes(key.trim().toLowerCase()))?.[1]??''
      const validation = validateStagedEmployee(row.current_data, row.company_id ?? '', row.branch_id ?? '')
      const rowStatus = 'review_status' in row ? row.review_status : validation.length ? 'NEEDS_INFORMATION' : 'PENDING_REVIEW'
      const duplicateItems = 'duplicate_warnings' in row && Array.isArray(row.duplicate_warnings) ? row.duplicate_warnings as { message: string }[] : []
      const duplicates = duplicateItems.map((warning) => warning.message).join('; ')
      rows.push([row.source_sheet,row.source_row,'INCLUDED',String(location),rowStatus,validation.join('; '),duplicates,'Employee details omitted from this validation report.'])
    }
    const savedCount = Number(reconciliation.row_count ?? records.length)
    const savedTotal = Number(reconciliation.basic_salary_total ?? totalSalary)
    rows.push(['Source worksheets','','TOTAL', '', `${savedCount} rows; basic salary subtotal ZMW ${savedTotal.toFixed(2)}`])
    if (reportSummary) {
      rows.push([reportSummary.worksheet??'Consolidated report','12','SUMMARY_COUNT_AND_BASIC_SUBTOTAL','',`${reportSummary.employee_count??'unreadable'} employees; ZMW ${reportSummary.basic_subtotal?.toFixed(2)??'unreadable'}`])
      for (const formula of reportSummary.broken_formulas??[]) rows.push([reportSummary.worksheet??'',formula.row,'FORMULA_ERROR','',`${formula.cell} ${formula.error}`])
    }
    const csv = rows.map((row)=>row.map((cell)=>`"${String(cell??'').replaceAll('"','""')}"`).join(',')).join('\n')
    const url=URL.createObjectURL(new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download='employee-import-reconciliation.csv';anchor.click();URL.revokeObjectURL(url)
  }
  function reviewField(field: typeof liveImportFields[number]) {
    const value = draft[field.key] ?? ''
    const readOnly = Boolean(selectedRecord?.resulting_employee_id)
    const options = reviewSelectOptions[field.key]
    const dateField = ['date_of_birth', 'contract_start_date', 'contract_end_date'].includes(field.key)
    if (field.key === 'department') {
      return <label key={field.key}><span>Department{field.required ? ' *' : ''}</span><select disabled={readOnly || departmentLoading || Boolean(departmentError)} value={value} onChange={(event) => changeField(field.key, event.target.value)}><option value="">Select an active department</option>{value && !departments.some((item) => item.name.toLowerCase() === value.toLowerCase() && item.status.toLowerCase() === 'active') && <option value={value}>Needs review: {value}</option>}{departments.filter((item) => item.status.toLowerCase() === 'active').map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
    }
    if (options) {
      return <label key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span><select disabled={readOnly} value={value} onChange={(event) => changeField(field.key, event.target.value)}><option value="">Select a value</option>{value && !options.some((option) => option.value === value) && <option value={value}>Needs review: {value}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    }
    return <label key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span><input type={dateField ? 'date' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} readOnly={readOnly} value={value} onChange={(event) => changeField(field.key, event.target.value)} /></label>
  }

  async function saveApprovalRecord(decision: 'SAVE' | 'REJECT') {
    if (!selectedRecord) return
    if (decision === 'REJECT' && reviewReason.trim().length < 3) { setError('Enter a rejection reason of at least 3 characters.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await createEmployeeImportStagingService(getSupabaseClient()).review({
        recordId: selectedRecord.id, companyId: draftCompanyId, branchId: draftBranchId,
        currentData: draft, payrollData: draftPayroll, decision, reason: reviewReason.trim(),
      })
      if (decision === 'REJECT') {
        setNotice('Employee rejected. The decision was recorded in the review history.')
        window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
        onChanged?.()
        onClose?.()
        return
      }
      const refreshed = await createEmployeeImportStagingService(getSupabaseClient()).getRecord(selectedRecord.id)
      setStagedRows((current) => current.map((item) => item.id === refreshed.id ? refreshed : item))
      setDraft(refreshed.current_data); setDraftPayroll(refreshed.payroll_data); setDraftCompanyId(refreshed.company_id); setDraftBranchId(refreshed.branch_id)
      setNotice('Changes saved. The employee remains pending until an authorized approver approves the record.')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The staged employee changes could not be saved.') }
    finally { setBusy(false) }
  }

  async function saveAndApproveStaged() {
    if (!selectedRecord || !canApprove) return
    if (validationErrors.length) { setError(`Complete these fields before approval: ${validationErrors.join('; ')}.`); return }
    const blockers = selectedRecord.duplicate_warnings.filter((item) => !['IDENTITY_MATCH','NAME_MATCH'].includes(item.type ?? ''))
    if (blockers.length) { setError(`Resolve duplicate conflicts before approval: ${blockers.map((item) => item.message).join('; ')}.`); return }
    if (selectedRecord.duplicate_warnings.length && (!confirmDistinctMatch || reviewReason.trim().length < 3)) {
      setError('Review the possible employee match, confirm that it is a different person, and record a reason before approval.')
      return
    }
    const name = `${draft.first_name ?? ''} ${draft.last_name ?? ''}`.trim() || draft.employee_number || 'this employee'
    if (!window.confirm(`Save corrections and approve ${name} through the existing HR workflow? The database will revalidate the record.`)) return
    setBusy(true); setError(''); setNotice('')
    const service = createEmployeeImportStagingService(getSupabaseClient())
    try {
      await service.review({
        recordId: selectedRecord.id, companyId: draftCompanyId, branchId: draftBranchId,
        currentData: draft, payrollData: draftPayroll, decision: 'MARK_READY', reason: reviewReason.trim(),
        duplicateResolution: confirmDistinctMatch ? 'CONFIRMED_DISTINCT' : undefined,
      })
      const submitted = await service.submit(selectedRecord.id, submitKey(selectedRecord.id))
      if (submitted.status !== 'SUBMITTED_FOR_APPROVAL' || !submitted.employee_id) {
        throw new Error('Corrections were saved but the existing employee submission workflow did not create an approval record. Refresh the queue and review the batch result.')
      }
      try {
        await service.approve(submitted.employee_id)
      } catch {
        window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
        onChanged?.()
        throw new Error('The employee draft was submitted, but your account could not complete final approval. It remains in the authorized Employee Approvals queue.')
      }
      setNotice('Employee approved through the existing HR workflow and added to the employee register.')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      onChanged?.()
      onClose?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The employee could not be approved.') }
    finally { setBusy(false) }
  }

  if (approvalRecordId) {
    const selectedCompany = portfolioCompanies.find((item) => item.id === draftCompanyId)
    const activeBranches = selectedCompany?.branches.filter((item) => item.status.toLowerCase() === 'active') ?? []
    const originalBranchValue = draft.branch_name || String(Object.entries(selectedRecord?.original_data ?? {}).find(([key]) => ['branch','workplace branch','work location'].includes(key.trim().toLowerCase()))?.[1] ?? '')
    const inactiveBranch = matchingInactiveImportBranch(originalBranchValue, selectedCompany?.branches ?? [])
    const fieldGroups = [
      ['Personal information', ['employee_number','first_name','middle_name','last_name','date_of_birth','gender','nationality','identity_document_type','identity_document_number','residential_address','phone','email','email_unavailable_reason']],
      ['Employment information', ['department','job_title','employment_type','contract_type','contract_start_date','contract_end_date','salary_frequency','retirement_age']],
      ['Payment information', ['payment_method','bank_name','bank_account_name','bank_account_number','bank_branch_name','mobile_money_provider','mobile_money_number']],
      ['Statutory information', ['tpin','napsa_number','nhima_number']],
      ['Emergency contact', ['emergency_contact_name','emergency_contact_relationship','emergency_contact_phone']],
    ] as const
    const renderOriginalValue = (value: unknown) => value == null || value === '' ? 'â€”' : typeof value === 'object' ? 'Structured source value' : String(value)
    return <div className="modal-backdrop employee-staging-approval-backdrop" role="presentation"><section className="panel employee-staging-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="staged-approval-title">
      <header><div><div className="section-eyebrow">FINAL HR REVIEW Â· {selectedRecord?.review_status.replaceAll('_',' ') ?? 'LOADING'}</div><h2 id="staged-approval-title">{selectedRecord ? `${draft.first_name ?? ''} ${draft.last_name ?? ''}`.trim() || draft.employee_number || 'Imported employee' : 'Employee details'}</h2><p>{selectedRecord ? `${selectedRecord.source_sheet} worksheet Â· Excel row ${selectedRecord.source_row}` : 'Loading the authorized staged recordâ€¦'}</p></div><button className="icon-button" aria-label="Close employee review" onClick={onClose}><X size={18}/></button></header>
      {approvalDialogLoading ? <div className="employee-empty" role="status">Loading employee detailsâ€¦</div> : selectedRecord ? <>
        {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-data-notice" role="status">{notice}</div>}
        <div className="staging-fields"><label><span>Company *</span><select value={draftCompanyId ?? ''} onChange={(event)=>{const id=event.target.value||null;setDraftCompanyId(id);setDraftBranchId(null);setDraft((current)=>({...current,company_name:portfolioCompanies.find((item)=>item.id===id)?.name??''}))}}><option value="">Select company</option>{portfolioCompanies.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Workplace branch *</span><select value={draftBranchId ?? ''} disabled={!draftCompanyId} onChange={(event)=>{const id=event.target.value||null;const branch=activeBranches.find((item)=>item.id===id);setDraftBranchId(id);setDraft((current)=>({...current,branch_name:branch?.name??''}))}}><option value="">Select an active workplace branch</option>{activeBranches.map((branch)=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><small>Workbook Branch: {originalBranchValue || 'Not provided'}</small></label></div>
        {inactiveBranch && <p className="auth-shell-error" role="status">Workbook value â€œ{originalBranchValue}â€ matches â€œ{inactiveBranch.name}â€ in the company directory, but that branch is inactive. The application will not activate it. Select an active branch or ask an authorized administrator to activate the correct branch.</p>}
        {!activeBranches.length && <p className="auth-shell-error" role="status">No active workplace branches are configured for this company. This employee can be saved, but final approval requires an authorized administrator to configure an active branch.</p>}
        {departmentError && <p className="auth-shell-error" role="alert">{departmentError}</p>}
        {fieldGroups.map(([title, keys])=><section className="employee-approval-field-group" key={title}><h3>{title}</h3><div className="staging-fields">{liveImportFields.filter((field)=>(keys as readonly string[]).includes(field.key) && field.key !== "company_name" && field.key !== "branch_name").map(reviewField)}</div></section>)}
        <section className="employee-approval-field-group"><h3>Compensation information</h3><div className="staging-fields">{liveImportFields.filter((field)=>['basic_pay','housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances'].includes(field.key)).map(reviewField)}</div><p>Gross earnings preview: {grossPreview.total===null?'Incomplete or invalid':`ZMW ${Number(grossPreview.total).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}. This is not a payroll or statutory calculation.</p></section>
        {draft.housing_allowance_review_required==='true'&&<div className="auth-shell-error" role="alert"><strong>Housing allowance needs review.</strong> Proposed 30% amount: ZMW {draft.housing_allowance_proposed||'unavailable'}.<div className="employee-form-actions"><button type="button" className="button-secondary" onClick={()=>resolveHousingAllowance('USE_CALCULATED')}>Use calculated 30%</button><button type="button" className="button-secondary" onClick={()=>resolveHousingAllowance('USE_UPLOADED')}>Keep reviewed amount</button></div></div>}
        {validationErrors.length>0&&<div className="auth-shell-error" role="alert"><strong>Still needs correction:</strong><ul>{validationErrors.map((issue)=><li key={issue}>{issue}</li>)}</ul></div>}
        {selectedRecord.duplicate_warnings.length>0&&<div className="auth-shell-error" role="alert"><strong>Potential duplicate:</strong> {selectedRecord.duplicate_warnings.map((item)=>item.message).join('; ')}</div>}
        <details className="employee-approval-original"><summary>Original workbook values</summary><dl>{Object.entries(selectedRecord.original_data).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{renderOriginalValue(value)}</dd></div>)}</dl></details>
        <details><summary>Correction history ({reviewHistory.length})</summary>{reviewHistory.length?<ol>{reviewHistory.map((item)=><li key={item.id}><strong>{item.action.replaceAll('_',' ')}</strong> Â· {new Date(item.occurred_at).toLocaleString()} Â· {item.reason ?? item.changed_fields.join(', ')}</li>)}</ol>:<p>No correction history recorded.</p>}</details>
        <label className="staging-reject-reason">Review note / rejection reason<input value={reviewReason} onChange={(event)=>setReviewReason(event.target.value)} placeholder="Required for rejection or duplicate resolution" /></label>
        {selectedRecord.duplicate_warnings.some((item)=>['IDENTITY_MATCH','NAME_MATCH'].includes(item.type??''))&&<label className="staging-reject-reason"><span><input type="checkbox" checked={confirmDistinctMatch} onChange={(event)=>setConfirmDistinctMatch(event.target.checked)}/> I reviewed the possible match and confirm this is a different person.</span></label>}
        <div className="employee-form-actions"><button type="button" className="button-secondary" disabled={busy} onClick={()=>void saveApprovalRecord('SAVE')}><Save size={14}/> Save Changes</button>{canApprove&&<button type="button" className="button-primary" disabled={busy||validationErrors.length>0} onClick={()=>void saveAndApproveStaged()}><Check size={14}/> Save and Approve</button>}<button type="button" className="button-secondary" disabled={busy||reviewReason.trim().length<3} onClick={()=>void saveApprovalRecord('REJECT')}>Reject</button><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>Cancel</button></div>
        <section className="employee-approval-original"><strong>Original payroll components remain staged separately</strong><dl>{Object.entries(draftPayroll).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{renderOriginalValue(value)}</dd></div>)}</dl><p>No payroll run, payment or statutory filing is created by employee approval.</p></section>
      </> : <div className="employee-empty" role="alert">{error || 'Employee could not be loaded.'}</div>}
    </section></div>
  }

  return <div className="employee-screen live-import-screen staging-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> EMPLOYEE ONBOARDING</div><h1>Import employees</h1><p>Upload a workbook, review the preview, and submit employee candidates directly to the final HR approval queue.</p></div><Link className="button-secondary" to="/employees">Employee register</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Workbooks are parsed in this browser. The staged records are sent only to the authenticated project under company and branch permissions. Originals are retained for comparison; no employee or payroll master record is created by upload.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-data-notice" role="status"><Check size={15}/>{notice}</div>}

    <section className="panel live-import-upload"><button type="button" className="button-secondary" onClick={downloadEmployeeTemplate}><FileSpreadsheet size={16}/> Download Employee Template</button><label><Upload size={22}/><strong>{fileName || 'Choose an Excel workbook or CSV to stage'}</strong><span>.xlsx, .xls, or .csv Â· up to 20 MB Â· up to 5,000 employee rows</span><input id="employee-staging-file" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])}/></label></section>

    {records.length > 0 && <section className="panel live-import-preview"><header><div><div className="section-eyebrow">LOCAL WORKBOOK PREVIEW</div><h2>{records.length.toLocaleString()} employee candidates across {sheetSummary.length} worksheets</h2><p>Basic salary subtotal in detected rows: ZMW {totalSalary.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}. These are workbook values, not recalculated statutory payroll.</p></div></header>
      <details className="employee-import-mapping" open><summary>Review automatic field mapping ({worksheetMappings.length} worksheet{worksheetMappings.length===1?'':'s'})</summary><label>Worksheet<select aria-label="Worksheet mapping" value={selectedMappingSheet} onChange={(event)=>setSelectedMappingSheet(event.target.value)}>{worksheetMappings.map((sheet)=><option value={sheet.sheet} key={sheet.sheet}>{sheet.sheet} Â· row {sheet.headerRow} headings</option>)}</select></label>{(() => {const sheet=worksheetMappings.find((item)=>item.sheet===selectedMappingSheet);if(!sheet)return null;const templateKeys=new Set(['employee_number','first_name','middle_name','last_name','date_of_birth','gender','nationality','identity_document_number','residential_address','phone','email','email_unavailable_reason','company_name','branch_name','department','job_title','employment_type','contract_start_date','basic_pay','payment_method','bank_name','bank_account_number','mobile_money_provider','mobile_money_number','tpin','napsa_number','nhima_number','emergency_contact_name','emergency_contact_relationship','emergency_contact_phone','housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances','gross_pay']);const fields=liveImportFields.filter((field)=>templateKeys.has(field.key)||['contract_type','salary_frequency','bank_account_name'].includes(field.key));return <><div className="staging-fields">{fields.map((field)=><label key={field.key}><span>{field.label}</span><select aria-label={`Map ${field.label}`} value={sheet.mapping[field.key]===null||sheet.mapping[field.key]===undefined?'':String(sheet.mapping[field.key])} onChange={(event)=>changeMapping(sheet.sheet,field.key,event.target.value)}><option value="">Not mapped</option>{sheet.headers.map((header,index)=><option value={index} key={`${index}:${header}`}>{excelColumnLabel(index)}: {header||`Column ${index+1}`}{sheet.headers.slice(0,index).includes(header)?` (${index+1})`:''}</option>)}</select></label>)}</div>{mappingConflicts.length>0&&<div className="auth-shell-error" role="alert"><strong>Resolve ambiguous column mappings before staging:</strong> {mappingConflicts.join('; ')}</div>}</>})()}</details>
      <div className="live-import-summary"><strong>Rows examined: {sheetSummary.reduce((sum, sheet) => sum + sheet.extracted + sheet.excluded, 0).toLocaleString()}</strong><strong>Employee candidates: {records.length.toLocaleString()}</strong><span>Valid: {previewReadyForReview.toLocaleString()}</span><span>Invalid: {previewNeedsAttention.toLocaleString()}</span><span>Valid but incomplete: {previewIncomplete.toLocaleString()}</span><span>Excluded rows: {exclusions.length.toLocaleString()}</span><button type="button" className="button-secondary" onClick={downloadReconciliation}>Export validation report</button></div>
      {reportSummary&&<div className="auth-shell-error" role="status"><strong>{reportSummary.worksheet} comparison:</strong> consolidated sheet reports {reportSummary.employee_count??'an unreadable count'} employees and ZMW {reportSummary.basic_subtotal?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})??'an unreadable subtotal'}; source candidate count and basic salary subtotal are {Number(reconciliation.row_count??records.length)} and ZMW {Number(reconciliation.basic_salary_total??totalSalary).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}. Difference: {reportSummary.employee_count==null?'count unavailable':Number(reconciliation.row_count??records.length)-reportSummary.employee_count} employee rows and {reportSummary.basic_subtotal==null?'subtotal unavailable':`ZMW ${(Number(reconciliation.basic_salary_total??totalSalary)-reportSummary.basic_subtotal).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}. Review this variance before any payroll transaction.</div>}
      {reportSummary?.broken_formulas?.length? <div className="auth-shell-error" role="alert"><strong>Broken workbook formulas:</strong> {reportSummary.broken_formulas.map((formula)=>`${formula.cell} (row ${formula.row}): ${formula.error}`).join('; ')}. Payroll review remains separate from employee staging.</div>:null}
      <div className="table-scroll import-candidate-table-wrap"><table className="employee-table import-candidate-table"><thead><tr><th>Source Row</th><th>Employee Number</th><th>Employee Name</th><th>Company</th><th>Workplace Branch</th><th>Department</th><th>Basic Salary</th><th>Missing Optional Information</th><th>Validation Status</th><th>Actions</th></tr></thead><tbody>{records.map((row,index) => {const company=companies.find((item)=>item.id===row.company_id);const inactiveBranch=company?matchingInactiveImportBranch(row.current_data.branch_name,company.branches):null;const rowIssues=previewIssues(row,index);const allowedDepartments=companyDepartments[row.company_id??'']??[];return <tr key={`${row.source_sheet}:${row.source_row}`}><td className="import-nowrap">{row.source_sheet} Â· {row.source_row}</td><td className="import-nowrap">{row.current_data.employee_number||'Generated on import'}</td><td>{[row.current_data.first_name,row.current_data.middle_name,row.current_data.last_name].filter(Boolean).join(' ')||row.current_data.full_name||'Name needs review'}</td><td><select aria-label={`Company for ${row.source_sheet} row ${row.source_row}`} value={row.company_id ?? ''} onChange={(event)=>assignCompany(index,event.target.value)}><option value="">Select company</option>{portfolioCompanies.filter((item)=>item.status.toLowerCase()==='active').map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></td><td><select aria-label={`Workplace branch for ${row.source_sheet} row ${row.source_row}`} value={row.branch_id ?? ''} disabled={!company} onChange={(event)=>assignBranch(index,event.target.value)}><option value="">Select an active branch</option>{company?.branches.filter((item)=>item.status.toLowerCase()==='active').map((branch)=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>{inactiveBranch?<small role="status">Workbook value â€œ{row.current_data.branch_name}â€ matches inactive branch â€œ{inactiveBranch.name}â€; it cannot be used for approval.</small>:!row.branch_id&&row.current_data.branch_name?<small role="status">Branch not recognized. Select the correct branch. Workbook value: â€œ{row.current_data.branch_name}â€.</small>:null}</td><td><select aria-label={`Department for ${row.source_sheet} row ${row.source_row}`} value={row.current_data.department} disabled={!company} onChange={(event)=>assignDepartment(index,event.target.value)}><option value="">Select active department</option>{row.current_data.department&&!allowedDepartments.some((item)=>item.name===row.current_data.department&&item.status.toLowerCase()==='active')&&<option value={row.current_data.department}>Needs review: {row.current_data.department}</option>}{allowedDepartments.filter((item)=>item.status.toLowerCase()==='active').map((item)=><option key={item.id} value={item.name}>{item.name}</option>)}</select></td><td>{row.current_data.basic_pay||'Missing'}</td><td>{missingOptionalEmployeeFields(row.current_data).join(', ') || 'None'}</td><td><span className={`approval-status ${rowIssues.length?'status-needs-information':'status-ready'}`}>{rowIssues.length?'Needs information':'Valid for review'}</span></td><td><details><summary>{rowIssues.length?`${rowIssues.length} items`:'Details'}</summary>{rowIssues.length?<ul>{rowIssues.map((issue)=><li key={issue}>{issue}</li>)}</ul>:<p>The database revalidates the company, branch, department, permissions, earnings, and duplicates before import.</p>}</details></td></tr>})}</tbody></table></div>
      <div className="employee-form-actions import-stage-action"><button type="button" className="button-primary" disabled={busy || !portfolioId || mappingConflicts.length > 0 || records.length === 0} onClick={() => void stageWorkbook()}>{busy ? 'Submittingâ€¦' : `Submit ${records.length.toLocaleString()} ${records.length === 1 ? 'Employee' : 'Employees'}`}</button>{!portfolioId && <span role="status">Waiting for authorized portfolio contextâ€¦</span>}{mappingConflicts.length > 0 && <span role="alert">Resolve the column mapping conflicts above before submission.</span>}</div>
      {sheetSummary.map((sheet)=><span className="live-form-hint" key={sheet.sheet}>{sheet.sheet}: {sheet.extracted} staged candidates, {sheet.excluded} excluded rows</span>)}
      {exclusions.length>0&&<details open={excludedDetails} onToggle={(event)=>setExcludedDetails((event.target as HTMLDetailsElement).open)}><summary>Rows excluded from employee staging ({exclusions.length})</summary><ul>{exclusions.map((item,index)=><li key={`${item.sheet}:${item.row}:${index}`}>{item.sheet} row {item.row}: {item.reason}</li>)}</ul></details>}
    </section>}

    <p className="live-form-hint"><FileSpreadsheet size={14}/> Payroll amounts remain in batch staging. Payroll runs, payments, statutory deductions and employee compensation are not written by this upload action.</p>
  </div>
}
