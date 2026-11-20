import { useEffect, useMemo, useState } from 'react'
import { Check, FileSpreadsheet, RefreshCw, Save, ShieldCheck, Upload, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getSupabaseClient } from '../../lib/supabase/client'
import { useCompanySelection, useWorkspace } from '../companies/WorkspaceContext'
import { createEmployeeImportStagingService, sha256File, type StagingBatch, type StagingRecord } from './employee-import-staging-service'
import { detectEmployeeUploadFormat, extractEmployeeWorkbook, recalculateStagedHousingAllowance, validateStagedEmployee, type StagedWorkbookRow } from './employee-import-staging'
import { allowedTemplateBanks, employeeTemplateValues, liveImportFields, type EmployeeFieldMapping } from './live-import-model'
import { createLiveHrServices, type DepartmentRecord } from '../../services/live-hr-services'
import { calculateGrossEarningsPreview, downloadEmployeeTemplate } from './employee-import-template'
import './live-employee-import.css'

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
const batchKey = (portfolioId: string, digest: string) => `gbhr-staging:${portfolioId}:${digest}`
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

export function LiveEmployeeImportStaging() {
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
  const [batches, setBatches] = useState<StagingBatch[]>([])
  const [selectedBatch, setSelectedBatch] = useState<StagingBatch | null>(null)
  const [stagedRows, setStagedRows] = useState<StagingRecord[]>([])
  const [selectedApprovalIds, setSelectedApprovalIds] = useState<string[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [reviewHistory, setReviewHistory] = useState<{ id: number; actor_id: string; action: string; reason: string | null; changed_fields: string[]; occurred_at: string }[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [draftPayroll, setDraftPayroll] = useState<Record<string, unknown>>({})
  const [draftCompanyId, setDraftCompanyId] = useState<string | null>(null)
  const [draftBranchId, setDraftBranchId] = useState<string | null>(null)
  const [payrollJson, setPayrollJson] = useState('{}')
  const [reviewReason, setReviewReason] = useState('')
  const [confirmDistinctMatch, setConfirmDistinctMatch] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [excludedDetails, setExcludedDetails] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [filterCompanyId, setFilterCompanyId] = useState('ALL')
  const [filterBranchId, setFilterBranchId] = useState('ALL')
  const [page, setPage] = useState(0)
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [departmentLoading, setDepartmentLoading] = useState(false)
  const [departmentError, setDepartmentError] = useState('')

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
  const readyCount = stagedRows.filter((row) => row.review_status === 'READY_FOR_APPROVAL').length
  const needsInfoCount = stagedRows.filter((row) => row.review_status === 'NEEDS_INFORMATION' || row.review_status === 'PENDING_REVIEW').length
  const duplicateCount = stagedRows.filter((row) => row.review_status === 'DUPLICATE_REVIEW').length
  const submittedCount = stagedRows.filter((row) => row.review_status === 'SUBMITTED_FOR_APPROVAL' && Boolean(row.resulting_employee_id)).length
  const previewNeedsAttention = records.filter((row) => validateStagedEmployee(row.current_data, row.company_id ?? '', row.branch_id ?? '').length > 0).length
  const previewReadyForReview = records.length - previewNeedsAttention
  const filteredRecords = useMemo(() => stagedRows.filter((row) => {
    const query=searchQuery.trim().toLowerCase()
    const company=companies.find((item)=>item.id===row.company_id)
    const branch=company?.branches.find((item)=>item.id===row.branch_id)
    const matchesQuery=!query||[row.current_data.employee_number,row.current_data.first_name,row.current_data.last_name,row.source_sheet,String(row.source_row),company?.name,branch?.name].some((value)=>String(value??'').toLowerCase().includes(query))
    return matchesQuery&&(statusFilter==='ALL'||row.review_status===statusFilter)&&(filterCompanyId==='ALL'||row.company_id===filterCompanyId)&&(filterBranchId==='ALL'||row.branch_id===filterBranchId)
  }),[stagedRows,companies,searchQuery,statusFilter,filterCompanyId,filterBranchId])
  const pageSize=50
  const pageCount=Math.max(1,Math.ceil(filteredRecords.length/pageSize))

  async function refreshBatches(targetPortfolio = portfolioId) {
    if (!targetPortfolio) return
    const items = await createEmployeeImportStagingService(getSupabaseClient()).listBatches(targetPortfolio)
    setBatches(items)
  }

  useEffect(() => {
    if (currentCompany?.portfolioId && !portfolioId) setPortfolioId(currentCompany.portfolioId)
  }, [currentCompany?.portfolioId, portfolioId])

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

  useEffect(() => {
    if (!portfolioId) return
    let active = true
    createEmployeeImportStagingService(getSupabaseClient()).listBatches(portfolioId)
      .then((items) => {
        if (!active) return
        setBatches(items)
        const params = new URLSearchParams(window.location.search)
        const batchId = params.get('batch')
        const requestedBatch = items.find((batch) => batch.id === batchId)
        if (requestedBatch) void openBatch(requestedBatch, params.get('record') ?? undefined)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Import batch history could not be loaded.') })
    return () => { active = false }
  }, [portfolioId])

  async function openBatch(batch: StagingBatch, focusRecordId?: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const rows = await createEmployeeImportStagingService(getSupabaseClient()).listRecords(batch.id)
      const focusedRecord = rows.find((row) => row.id === focusRecordId) ?? rows[0]
      setSelectedBatch(batch); setStagedRows(rows); setSelectedRecordId(focusedRecord?.id ?? '');
      setSelectedApprovalIds([])
      setPage(0); setSearchQuery(''); setStatusFilter('ALL'); setFilterCompanyId('ALL'); setFilterBranchId('ALL')
      setSheetSummary(batch.sheet_summary ?? [])
      setReconciliation(batch.reconciliation ?? {})
      setExclusions(Array.isArray(batch.reconciliation?.excluded) ? batch.reconciliation.excluded as { sheet: string; row: number; reason: string }[] : [])
      if (focusedRecord) { setDraft(focusedRecord.current_data); setDraftPayroll(focusedRecord.payroll_data); setPayrollJson(JSON.stringify(focusedRecord.payroll_data,null,2)); setDraftCompanyId(focusedRecord.company_id); setDraftBranchId(focusedRecord.branch_id); setReviewHistory(await createEmployeeImportStagingService(getSupabaseClient()).listHistory(focusedRecord.id) as typeof reviewHistory) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Staged rows could not be loaded.') }
    finally { setBusy(false) }
  }

  function selectRecord(record: StagingRecord) {
    setSelectedRecordId(record.id); setDraft(record.current_data); setDraftPayroll(record.payroll_data); setPayrollJson(JSON.stringify(record.payroll_data,null,2)); setDraftCompanyId(record.company_id); setDraftBranchId(record.branch_id); setReviewReason(''); setConfirmDistinctMatch(false); setNotice('')
    void createEmployeeImportStagingService(getSupabaseClient()).listHistory(record.id).then((items)=>setReviewHistory(items as typeof reviewHistory)).catch(()=>setReviewHistory([]))
  }

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
    setRecords((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, company_id: targetCompanyId || null, branch_id: null } : row))
  }
  function assignBranch(index: number, branchId: string) {
    setRecords((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, branch_id: branchId || null } : row))
  }

  async function stageWorkbook() {
    setError(''); setNotice('')
    if (!portfolioId) { setError('No authorized portfolio context is available. Select an authorized company workspace, then retry.'); return }
    if (!fileName || records.length === 0) { setError('Choose and review a workbook first.'); return }
    if (mappingConflicts.length) { setError(`Resolve ambiguous column mappings before staging: ${mappingConflicts.join('; ')}`); return }
    if (records.length > 5000) { setError('A single staging batch is limited to 5,000 employee rows.'); return }
    setBusy(true)
    try {
      const fileInput = document.querySelector<HTMLInputElement>('#employee-staging-file')?.files?.[0]
      if (!fileInput) throw new Error('Select the workbook again to stage it.')
      const digest = await sha256File(await fileInput.arrayBuffer())
      const result = await createEmployeeImportStagingService(getSupabaseClient()).createBatch({
        portfolioId, filename: fileName, sourceSha256: digest,
        idempotencyKey: batchKey(portfolioId, digest), records, sheetSummary,
        reconciliation: { ...reconciliation, excluded: exclusions },
      })
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      const savedNotice = result.replayed ? `This exact workbook was already staged (batch ${result.batch_id}).` : `${result.total_records} employee ${result.total_records === 1 ? 'candidate has' : 'candidates have'} been saved to the secure HR review queue.`
      setNotice(savedNotice)
      setRecords([]); setFileName('')
      const inputElement = document.querySelector<HTMLInputElement>('#employee-staging-file')
      if (inputElement) inputElement.value = ''
      const refreshedBatches = await createEmployeeImportStagingService(getSupabaseClient()).listBatches(portfolioId)
      setBatches(refreshedBatches)
      const found = refreshedBatches.find((batch) => batch.id === result.batch_id)
      if (found) { await openBatch(found); setNotice(savedNotice) }
      else setNotice(`${savedNotice} Batch ${result.batch_id} is saved; refresh batch history if it is not immediately visible.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Batch could not be staged. No success was reported; verify the batch list before retrying.') }
    finally { setBusy(false) }
  }

  async function saveReview(decision: 'SAVE' | 'MARK_READY' | 'REJECT') {
    if (!selectedRecord) return
    try { JSON.parse(payrollJson) } catch { setError('Payroll source fields must remain valid JSON before saving.'); return }
    if (decision === 'MARK_READY' && validationErrors.length) { setError(`Complete the required information first: ${validationErrors.join(', ')}.`); return }
    if (decision === 'MARK_READY' && selectedRecord.duplicate_warnings.some((item) => ['EMPLOYEE_NUMBER','BATCH_DUPLICATE','BATCH_IDENTITY_DUPLICATE','BATCH_NAME_DUPLICATE'].includes(item.type ?? ''))) { setError('An employee number or within-batch duplicate remains unresolved and cannot be overridden.'); return }
    if (decision === 'MARK_READY' && selectedRecord.duplicate_warnings.length && (!confirmDistinctMatch || !reviewReason.trim())) { setError('Review the potential match and record a reason confirming the records are distinct, or reject the row.'); return }
    if (decision === 'REJECT' && !reviewReason.trim()) { setError('Enter a reason before rejecting this record.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await createEmployeeImportStagingService(getSupabaseClient()).review({
        recordId: selectedRecord.id, companyId: draftCompanyId, branchId: draftBranchId,
        currentData: draft, payrollData: draftPayroll, decision, reason: reviewReason,
        duplicateResolution: confirmDistinctMatch ? 'CONFIRMED_DISTINCT' : undefined,
      })
      const refreshed = await createEmployeeImportStagingService(getSupabaseClient()).listRecords(selectedRecord.batch_id)
      setStagedRows(refreshed)
      const next = refreshed.find((row) => row.id === selectedRecord.id)
      if (next) selectRecord(next)
      setNotice(decision === 'MARK_READY' ? 'Record is ready for HR approval submission.' : decision === 'REJECT' ? 'Record was rejected and the reason was recorded.' : 'Corrections were saved to the review history.')
      await refreshBatches()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Review changes could not be saved.') }
    finally { setBusy(false) }
  }

  async function submitRecord(record: StagingRecord) {
    const confirmation = window.confirm(`Submit ${record.current_data.first_name} ${record.current_data.last_name} to the existing employee HR approval workflow? This does not approve the employee or activate compensation.`)
    if (!confirmation) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await createEmployeeImportStagingService(getSupabaseClient()).submit(record.id, submitKey(record.id))
      if (result.status !== 'SUBMITTED_FOR_APPROVAL') {
        try { sessionStorage.removeItem(`gbhr-staged-submit:${record.id}`) } catch { /* Retry key is tab-scoped. */ }
        throw new Error(`Submission returned ${result.import_job?.status ?? result.status}. Correct the record and revalidate before retrying.`)
      }
      setNotice('Employee draft was submitted to the existing HR approval workflow. A different authorized reviewer must complete approval.')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await openBatch(selectedBatch!)
      await refreshBatches()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Employee could not be submitted.') }
    finally { setBusy(false) }
  }

  async function submitEligible() {
    const eligible = stagedRows.filter((row) => row.review_status === 'READY_FOR_APPROVAL')
    if (!eligible.length) return
    if (!window.confirm(`Submit ${eligible.length} eligible employees to the existing HR approval queue? Incomplete, duplicate, rejected, and unauthorized rows are excluded. This will not approve employees.`)) return
    setBusy(true); setError(''); setNotice('')
    const outcomes: string[] = []
    try {
      const service = createEmployeeImportStagingService(getSupabaseClient())
      for (const row of eligible) {
        try {
          const result = await service.submit(row.id, submitKey(row.id))
          outcomes.push(`${row.source_sheet} row ${row.source_row}: ${result.status}`)
          if (result.status !== 'SUBMITTED_FOR_APPROVAL') { try { sessionStorage.removeItem(`gbhr-staged-submit:${row.id}`) } catch { /* Tab-scoped retry key. */ } }
        } catch (reason) { outcomes.push(`${row.source_sheet} row ${row.source_row}: ${reason instanceof Error ? reason.message : 'failed'}`) }
      }
      setNotice(`${eligible.length} eligible rows were attempted. ${outcomes.filter((item) => item.endsWith('SUBMITTED_FOR_APPROVAL')).length} submitted; ${outcomes.length - outcomes.filter((item) => item.endsWith('SUBMITTED_FOR_APPROVAL')).length} need follow-up.`)
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await openBatch(selectedBatch!)
      await refreshBatches()
    } finally { setBusy(false) }
  }

  async function approveSubmittedRecord(record: StagingRecord) {
    if (record.review_status !== 'SUBMITTED_FOR_APPROVAL' || !record.resulting_employee_id) return
    if (!window.confirm(`Approve ${record.current_data.first_name} ${record.current_data.last_name} through the existing HR approval workflow?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createEmployeeImportStagingService(getSupabaseClient()).approve(record.resulting_employee_id)
      setNotice('Approval was recorded by the existing employee HR workflow.')
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      await openBatch(selectedBatch!)
      await refreshBatches()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The existing HR approval workflow rejected this action or permission.') }
    finally { setBusy(false) }
  }

  async function approveSubmittedRows(eligible: StagingRecord[], actionLabel: string) {
    if (!eligible.length) return
    if (!window.confirm(`Approve ${actionLabel} (${eligible.length}) through the existing HR approval workflow? Each decision will use your current company and branch permissions; incomplete or unresolved records are excluded.`)) return
    setBusy(true); setError(''); setNotice('')
    const outcomes: { row: StagingRecord; error?: string }[] = []
    try {
      const service = createEmployeeImportStagingService(getSupabaseClient())
      for (const row of eligible) {
        try { await service.approve(row.resulting_employee_id!); outcomes.push({ row }) }
        catch (reason) { outcomes.push({ row, error: reason instanceof Error ? reason.message : 'Approval failed.' }) }
      }
      const approved = outcomes.filter((outcome) => !outcome.error).length
      setNotice(`${approved} of ${eligible.length} approvals recorded. ${eligible.length - approved} require follow-up; each result is listed below.`)
      window.dispatchEvent(new CustomEvent('gbhr-employee-approvals-changed'))
      const failures = outcomes.filter((outcome) => outcome.error)
      if (failures.length) setError(failures.map(({ row, error: failure }) => `${row.source_sheet} row ${row.source_row}: ${failure}`).join(' | '))
      await openBatch(selectedBatch!)
      await refreshBatches()
    } finally { setBusy(false) }
  }

  async function approveSelected() {
    const eligible = stagedRows.filter((row) => selectedApprovalIds.includes(row.id) && row.review_status === 'SUBMITTED_FOR_APPROVAL' && Boolean(row.resulting_employee_id))
    await approveSubmittedRows(eligible, 'selected employees')
  }

  async function approveAllEligible() {
    const eligible = stagedRows.filter((row) => row.review_status === 'SUBMITTED_FOR_APPROVAL' && Boolean(row.resulting_employee_id))
    await approveSubmittedRows(eligible, 'all eligible submitted employees')
  }

  function toggleApprovalSelection(row: StagingRecord) {
    if (row.review_status !== 'SUBMITTED_FOR_APPROVAL' || !row.resulting_employee_id) return
    setSelectedApprovalIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])
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
    const csv = rows.map((row)=>row.map((cell)=>`"${String(cell??'').replaceAll('"','""')}"`).join(',')).join('\r\n')
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
  return <div className="employee-screen live-import-screen staging-screen">
    <section className="welcome-row employee-welcome"><div><div className="eyebrow"><span className="eyebrow-line"/> SECURE HR REVIEW</div><h1>Import employees</h1><p>Preview, map and securely stage employee candidates. Missing details are held for HR review before approval.</p></div><Link className="button-secondary" to="/employees">Employee register</Link></section>
    <div className="live-data-notice"><ShieldCheck size={15}/> Workbooks are parsed in this browser. The staged records are sent only to the authenticated project under company and branch permissions. Originals are retained for comparison; no employee or payroll master record is created by upload.</div>
    {error && <div className="auth-shell-error" role="alert">{error}</div>}{notice && <div className="live-data-notice" role="status"><Check size={15}/>{notice}</div>}

    <section className="panel live-import-upload"><button type="button" className="button-secondary" onClick={downloadEmployeeTemplate}><FileSpreadsheet size={16}/> Download Employee Template</button><label><Upload size={22}/><strong>{fileName || 'Choose an Excel workbook or CSV to stage'}</strong><span>.xlsx, .xls, or .csv · up to 20 MB · up to 5,000 employee rows</span><input id="employee-staging-file" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])}/></label></section>

    {records.length > 0 && <section className="panel live-import-preview"><header><div><div className="section-eyebrow">LOCAL WORKBOOK PREVIEW</div><h2>{records.length.toLocaleString()} employee candidates across {sheetSummary.length} worksheets</h2><p>Basic salary subtotal in detected rows: ZMW {totalSalary.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}. These are workbook values, not recalculated statutory payroll.</p></div></header>
      <details className="employee-import-mapping" open><summary>Review automatic field mapping ({worksheetMappings.length} worksheet{worksheetMappings.length===1?'':'s'})</summary><label>Worksheet<select aria-label="Worksheet mapping" value={selectedMappingSheet} onChange={(event)=>setSelectedMappingSheet(event.target.value)}>{worksheetMappings.map((sheet)=><option value={sheet.sheet} key={sheet.sheet}>{sheet.sheet} · row {sheet.headerRow} headings</option>)}</select></label>{(() => {const sheet=worksheetMappings.find((item)=>item.sheet===selectedMappingSheet);if(!sheet)return null;const templateKeys=new Set(['employee_number','first_name','middle_name','last_name','date_of_birth','gender','nationality','identity_document_number','residential_address','phone','email','email_unavailable_reason','company_name','branch_name','department','job_title','employment_type','contract_start_date','basic_pay','payment_method','bank_name','bank_account_number','mobile_money_provider','mobile_money_number','tpin','napsa_number','nhima_number','emergency_contact_name','emergency_contact_relationship','emergency_contact_phone','housing_allowance','meal_allowance','transport_allowance','medical_allowance','other_allowances','gross_pay']);const fields=liveImportFields.filter((field)=>templateKeys.has(field.key)||['contract_type','salary_frequency','bank_account_name'].includes(field.key));return <><div className="staging-fields">{fields.map((field)=><label key={field.key}><span>{field.label}</span><select aria-label={`Map ${field.label}`} value={sheet.mapping[field.key]===null||sheet.mapping[field.key]===undefined?'':String(sheet.mapping[field.key])} onChange={(event)=>changeMapping(sheet.sheet,field.key,event.target.value)}><option value="">Not mapped</option>{sheet.headers.map((header,index)=><option value={index} key={`${index}:${header}`}>{excelColumnLabel(index)}: {header||`Column ${index+1}`}{sheet.headers.slice(0,index).includes(header)?` (${index+1})`:''}</option>)}</select></label>)}</div>{mappingConflicts.length>0&&<div className="auth-shell-error" role="alert"><strong>Resolve ambiguous column mappings before staging:</strong> {mappingConflicts.join('; ')}</div>}</>})()}</details>
      <div className="live-import-summary"><strong>Rows examined: {sheetSummary.reduce((sum, sheet) => sum + sheet.extracted + sheet.excluded, 0).toLocaleString()}</strong><strong>Employee candidates: {records.length.toLocaleString()}</strong><span>No local required fields missing: {previewReadyForReview.toLocaleString()}</span><span>Needs HR information: {previewNeedsAttention.toLocaleString()}</span><span>Excluded rows: {exclusions.length.toLocaleString()}</span><button type="button" className="button-secondary" onClick={downloadReconciliation}>Export validation report</button></div>
      {reportSummary&&<div className="auth-shell-error" role="status"><strong>{reportSummary.worksheet} comparison:</strong> consolidated sheet reports {reportSummary.employee_count??'an unreadable count'} employees and ZMW {reportSummary.basic_subtotal?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})??'an unreadable subtotal'}; source candidate count and basic salary subtotal are {Number(reconciliation.row_count??records.length)} and ZMW {Number(reconciliation.basic_salary_total??totalSalary).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}. Difference: {reportSummary.employee_count==null?'count unavailable':Number(reconciliation.row_count??records.length)-reportSummary.employee_count} employee rows and {reportSummary.basic_subtotal==null?'subtotal unavailable':`ZMW ${(Number(reconciliation.basic_salary_total??totalSalary)-reportSummary.basic_subtotal).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}. Review this variance before any payroll transaction.</div>}
      {reportSummary?.broken_formulas?.length? <div className="auth-shell-error" role="alert"><strong>Broken workbook formulas:</strong> {reportSummary.broken_formulas.map((formula)=>`${formula.cell} (row ${formula.row}): ${formula.error}`).join('; ')}. Payroll review remains separate from employee staging.</div>:null}
      <div className="table-scroll import-candidate-table-wrap"><table className="employee-table import-candidate-table"><thead><tr><th>Source Row</th><th>Employee Number</th><th>Employee Name</th><th>Company</th><th>Branch</th><th>Department</th><th>Validation Status</th><th>Actions</th></tr></thead><tbody>{records.map((row,index) => {const company=companies.find((item)=>item.id===row.company_id);const rowIssues=validateStagedEmployee(row.current_data,row.company_id??'',row.branch_id??'');return <tr key={`${row.source_sheet}:${row.source_row}`}><td className="import-nowrap">{row.source_sheet} · {row.source_row}</td><td className="import-nowrap">{row.current_data.employee_number||'Not provided'}</td><td>{[row.current_data.first_name,row.current_data.middle_name,row.current_data.last_name].filter(Boolean).join(' ')||row.current_data.full_name||'Name needs review'}</td><td><select aria-label={`Company for ${row.source_sheet} row ${row.source_row}`} value={row.company_id ?? ''} onChange={(event)=>assignCompany(index,event.target.value)}><option value="">Select company</option>{portfolioCompanies.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></td><td><select aria-label={`Branch for ${row.source_sheet} row ${row.source_row}`} value={row.branch_id ?? ''} disabled={!company} onChange={(event)=>assignBranch(index,event.target.value)}><option value="">Assign during review</option>{company?.branches.filter((item)=>item.status==='Active').map((branch)=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td><td>{row.current_data.department||'Not provided'}</td><td><span className={`approval-status ${rowIssues.length?'status-needs-information':'status-ready'}`}>{rowIssues.length?'Needs information':'No local field issues'}</span></td><td><details><summary>{rowIssues.length?`${rowIssues.length} items`:'Details'}</summary>{rowIssues.length?<ul>{rowIssues.map((issue)=><li key={issue}>{issue}</li>)}</ul>:<p>Stage first. Duplicate and authorized company validation occurs at the secure database boundary.</p>}</details></td></tr>})}</tbody></table></div>
      <div className="employee-form-actions import-stage-action"><button type="button" className="button-primary" disabled={busy || !portfolioId || mappingConflicts.length > 0} onClick={() => void stageWorkbook()}>{busy ? 'Staging…' : `Stage ${records.length.toLocaleString()} ${records.length === 1 ? 'Employee' : 'Employees'} for HR Review`}</button>{!portfolioId && <span role="status">Waiting for authorized portfolio context…</span>}{mappingConflicts.length > 0 && <span role="alert">Resolve the column mapping conflicts above before staging.</span>}</div>
      {sheetSummary.map((sheet)=><span className="live-form-hint" key={sheet.sheet}>{sheet.sheet}: {sheet.extracted} staged candidates, {sheet.excluded} excluded rows</span>)}
      {exclusions.length>0&&<details open={excludedDetails} onToggle={(event)=>setExcludedDetails((event.target as HTMLDetailsElement).open)}><summary>Rows excluded from employee staging ({exclusions.length})</summary><ul>{exclusions.map((item,index)=><li key={`${item.sheet}:${item.row}:${index}`}>{item.sheet} row {item.row}: {item.reason}</li>)}</ul></details>}
    </section>}

    <section className="panel live-import-history" aria-label="Import batches"><header><div><div className="section-eyebrow">IMPORT BATCHES</div><h2>Recent secure batches</h2></div><button className="button-secondary" disabled={busy||!portfolioId} onClick={()=>void refreshBatches()}><RefreshCw size={14}/> Refresh</button></header>
      {!batches.length?<p>No staged batches are available in this authorized portfolio.</p>:batches.map((batch)=><button key={batch.id} className={`staging-batch-row ${selectedBatch?.id===batch.id?'active':''}`} onClick={()=>void openBatch(batch)}><span>{batch.uploaded_filename}</span><small>{new Date(batch.created_at).toLocaleString()}</small><strong>{batch.status.replaceAll('_',' ')}</strong><span>{batch.total_records} total · {batch.valid_records} valid · {batch.incomplete_records} need information · {batch.duplicate_warnings} duplicate warnings · {batch.approved_records} approved</span><small>{batch.reviewed_records} of {batch.total_records} reviewed; {batch.ready_records} ready for approval</small><progress aria-label={`${batch.uploaded_filename} review progress`} value={batch.reviewed_records} max={Math.max(1,batch.total_records)} /></button>)}
    </section>

    {selectedBatch&&<section className="panel live-import-preview" aria-label="HR staging queue"><header><div><div className="section-eyebrow">PENDING HR REVIEW</div><h2>{selectedBatch.uploaded_filename}</h2><p>{stagedRows.length} source rows · {selectedBatch.source_sha256.slice(0,12)}… source hash</p></div><div><button className="button-secondary" onClick={downloadReconciliation}>Download redacted reconciliation CSV</button><button className="button-secondary" disabled={busy||selectedApprovalIds.length===0} onClick={()=>void approveSelected()}>Approve selected ({selectedApprovalIds.length})</button><button className="button-secondary" disabled={busy||submittedCount===0} onClick={()=>void approveAllEligible()}>Approve all eligible ({submittedCount})</button><button className="button-primary" disabled={busy||readyCount===0} onClick={()=>void submitEligible()}>Submit all {readyCount} eligible for HR approval</button></div></header>
      <div className="live-import-summary"><strong>{readyCount} ready to submit</strong><strong>{needsInfoCount} need information</strong><span>{duplicateCount} duplicate review · {submittedCount} submitted awaiting HR approval · {selectedBatch.approved_records} approved</span></div>
      {reportSummary&&<div className="auth-shell-error" role="status"><strong>{reportSummary.worksheet} reconciliation:</strong> source row count {Number(reconciliation.row_count??stagedRows.length)} vs consolidated {reportSummary.employee_count??'unavailable'}; source basic salaries ZMW {Number(reconciliation.basic_salary_total??0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} vs consolidated ZMW {reportSummary.basic_subtotal?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})??'unavailable'}. Any payroll transaction requires a separately resolved reconciliation.</div>}
      {reportSummary?.broken_formulas?.length?<div className="auth-shell-error" role="alert">Broken workbook formulas: {reportSummary.broken_formulas.map((formula)=>`${formula.cell} (row ${formula.row}): ${formula.error}`).join('; ')}.</div>:null}
      <div className="staging-filters"><label>Search records<input value={searchQuery} onChange={(event)=>{setSearchQuery(event.target.value);setPage(0)}} placeholder="Name, employee number, sheet or row" /></label><label>Status<select value={statusFilter} onChange={(event)=>{setStatusFilter(event.target.value);setPage(0)}}><option value="ALL">All statuses</option>{['PENDING_REVIEW','NEEDS_INFORMATION','DUPLICATE_REVIEW','READY_FOR_APPROVAL','SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED','IMPORT_FAILED'].map((status)=><option value={status} key={status}>{status.replaceAll('_',' ')}</option>)}</select></label><label>Company<select value={filterCompanyId} onChange={(event)=>{setFilterCompanyId(event.target.value);setFilterBranchId('ALL');setPage(0)}}><option value="ALL">All companies</option>{portfolioCompanies.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Branch<select value={filterBranchId} onChange={(event)=>{setFilterBranchId(event.target.value);setPage(0)}}><option value="ALL">All branches</option>{portfolioCompanies.filter((item)=>filterCompanyId==='ALL'||item.id===filterCompanyId).flatMap((item)=>item.branches.map((branch)=><option value={branch.id} key={branch.id}>{item.name} · {branch.name}</option>))}</select></label></div>
      <div className="staging-review-layout"><div className="table-scroll"><table className="employee-table"><thead><tr><th>SELECT</th><th>RECORD</th><th>EMPLOYEE</th><th>COMPANY / BRANCH</th><th>STATUS</th></tr></thead><tbody>{filteredRecords.slice(page*pageSize,(page+1)*pageSize).map((row)=><tr key={row.id} className={row.id===selectedRecordId?'selected':''} onClick={()=>selectRecord(row)}><td><input type="checkbox" aria-label={`Select ${row.current_data.first_name} ${row.current_data.last_name} for approval`} checked={selectedApprovalIds.includes(row.id)} disabled={busy||row.review_status!=='SUBMITTED_FOR_APPROVAL'||!row.resulting_employee_id} onClick={(event)=>event.stopPropagation()} onChange={()=>toggleApprovalSelection(row)} /></td><td>{row.source_sheet} · {row.source_row}</td><td>{row.current_data.first_name} {row.current_data.last_name}</td><td>{companies.find((item)=>item.id===row.company_id)?.name ?? 'Unassigned'} · {companies.find((item)=>item.id===row.company_id)?.branches.find((item)=>item.id===row.branch_id)?.name??'—'}</td><td>{row.review_status.replaceAll('_',' ')}</td></tr>)}</tbody></table><div className="staging-pagination"><span>Showing {filteredRecords.length?Math.min(page*pageSize+1,filteredRecords.length):0}–{Math.min((page+1)*pageSize,filteredRecords.length)} of {filteredRecords.length}</span><button className="button-secondary" disabled={page===0} onClick={()=>setPage((value)=>Math.max(0,value-1))}>Previous</button><span>Page {page+1} of {pageCount}</span><button className="button-secondary" disabled={page+1>=pageCount} onClick={()=>setPage((value)=>Math.min(pageCount-1,value+1))}>Next</button></div></div>
      {selectedRecord&&<section className="staging-record-editor"><header><div><h3>{selectedRecord.source_sheet} row {selectedRecord.source_row}</h3><span>{selectedRecord.review_status.replaceAll('_',' ')}</span></div><button type="button" className="icon-button" aria-label="Clear selected review" onClick={()=>setSelectedRecordId('')}><X size={15}/></button></header>
        {selectedRecord.resulting_employee_id&&<div className="auth-shell-error" role="status">This staged record is linked to an existing employee workflow. Use <Link to={`/employees/${selectedRecord.resulting_employee_id}/correct`}>the employee correction screen</Link>; this importer will not create a second employee.</div>}
        <div className="staging-fields"><label><span>Company *</span><select disabled={Boolean(selectedRecord.resulting_employee_id)} value={draftCompanyId??''} onChange={(event)=>{setDraftCompanyId(event.target.value||null);setDraftBranchId(null)}}><option value="">Select company</option>{portfolioCompanies.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Workplace branch (required before approval)</span><select value={draftBranchId??''} disabled={!draftCompanyId||Boolean(selectedRecord.resulting_employee_id)} onChange={(event)=>setDraftBranchId(event.target.value||null)}><option value="">Assign branch later</option>{portfolioCompanies.find((item)=>item.id===draftCompanyId)?.branches.filter((item)=>item.status==='Active').map((branch)=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div>
        {departmentLoading&&<p className="live-form-hint" role="status">Loading departments for the selected company…</p>}{departmentError&&<p className="auth-shell-error" role="alert">{departmentError}</p>}{!departmentLoading&&!departmentError&&draftCompanyId&&departments.length===0&&<p className="live-form-hint">No departments are visible for this company. Confirm that departments are configured and visible to your account using <Link to="/departments">Department management</Link>. The record can still be saved for review.</p>}{!departmentLoading&&!departmentError&&draftCompanyId&&departments.length>0&&!departments.some((item)=>item.status.toLowerCase()==='active')&&<p className="live-form-hint">This company has no active departments available for approval. The record can still be saved for review.</p>}
        <div className="staging-origin"><strong>Workbook original values</strong><pre>{JSON.stringify(selectedRecord.original_data,null,2)}</pre></div>
        <div className="staging-fields">{liveImportFields.map(reviewField)}</div>
        {draft.housing_allowance_review_required==='true'&&<div className="auth-shell-error" role="alert"><strong>Housing allowance differs from the 30% default.</strong> Calculated amount: ZMW {draft.housing_allowance_proposed||'unavailable'}. Choose which value to retain.<div className="employee-form-actions"><button type="button" className="button-secondary" disabled={Boolean(selectedRecord.resulting_employee_id)} onClick={()=>resolveHousingAllowance('USE_CALCULATED')}>Use calculated 30%</button><button type="button" className="button-secondary" disabled={Boolean(selectedRecord.resulting_employee_id)} onClick={()=>resolveHousingAllowance('USE_UPLOADED')}>Keep reviewed amount</button></div></div>}
        <section className="panel employee-compensation-preview"><h4>Compensation preview (not a payroll calculation)</h4><div className="staging-fields">{[['Basic Salary','basic_pay'],['Housing Allowance','housing_allowance'],['Lunch','meal_allowance'],['Transport','transport_allowance'],['Other Allowances','other_allowances'],['Medical Allowance (legacy workbook)','medical_allowance']].map(([label,key])=><div key={key}><strong>{label}</strong><span>{draft[key] ? `ZMW ${Number(draft[key]).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : 'Not provided'}</span></div>)}</div>{draft.gross_pay_review_required==='true'&&<p role="alert">The uploaded Gross Pay differs from the recalculated template preview. Review the original value before submitting.</p>}<p>Gross earnings preview (template components): {grossPreview.total===null?'Invalid amount':`ZMW ${Number(grossPreview.total).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}{grossPreview.incomplete.length>0?` · Unconfirmed: ${grossPreview.incomplete.map((key)=>liveImportFields.find((field)=>field.key===key)?.label??key).join(', ')}`:''}</p></section>
        <details><summary>Payroll and payment fields retained for separate payroll review</summary><p>These values remain staged and are not sent to payroll operations by employee approval.</p><textarea readOnly={Boolean(selectedRecord.resulting_employee_id)} aria-label="Edit staged payroll fields" value={payrollJson} onChange={(event)=>{setPayrollJson(event.target.value);try{setDraftPayroll(JSON.parse(event.target.value) as Record<string,unknown>)}catch{}}} rows={8}/>{(() => {try{JSON.parse(payrollJson);return null}catch{return <small className="field-error">Enter valid JSON to save these retained source fields.</small>}})()}</details>
        {validationErrors.length>0&&<div className="auth-shell-error"><strong>Needs information:</strong> {validationErrors.join('; ')}</div>}
        {selectedRecord.duplicate_warnings.length>0&&<div className="auth-shell-error"><strong>Duplicate review:</strong> {selectedRecord.duplicate_warnings.map((warning)=>warning.message).join('; ')}</div>}
        <details><summary>Review and correction history ({reviewHistory.length})</summary>{reviewHistory.length?<ol>{reviewHistory.map((item)=><li key={item.id}><strong>{item.action.replaceAll('_',' ')}</strong> · {new Date(item.occurred_at).toLocaleString()} · {item.actor_id}{item.reason?` · ${item.reason}`:''}{item.changed_fields?.length?` · changed: ${item.changed_fields.join(', ')}`:''}</li>)}</ol>:<p>No review actions recorded yet.</p>}</details>
        <label className="staging-reject-reason">Review note / rejection reason<input value={reviewReason} onChange={(event)=>setReviewReason(event.target.value)} placeholder="Required when rejecting or resolving a potential match" /></label>
        {selectedRecord.duplicate_warnings.some((item)=>['IDENTITY_MATCH','NAME_MATCH'].includes(item.type??''))&&<label className="staging-reject-reason"><span><input type="checkbox" checked={confirmDistinctMatch} onChange={(event)=>setConfirmDistinctMatch(event.target.checked)}/> I reviewed the possible existing employee match and confirm this is a different person.</span></label>}
        <div className="employee-form-actions"><button className="button-secondary" disabled={busy||Boolean(selectedRecord.resulting_employee_id)} onClick={()=>void saveReview('SAVE')}><Save size={14}/> Save corrections</button><button className="button-secondary" disabled={busy||validationErrors.length>0||Boolean(selectedRecord.resulting_employee_id)} onClick={()=>void saveReview('MARK_READY')}><Check size={14}/> Mark ready</button>{selectedRecord.review_status==='READY_FOR_APPROVAL'&&<button className="button-primary" disabled={busy||Boolean(selectedRecord.resulting_employee_id)} onClick={()=>void submitRecord(selectedRecord)}>Submit to HR approval</button>}{selectedRecord.review_status==='SUBMITTED_FOR_APPROVAL'&&selectedRecord.resulting_employee_id&&<button className="button-primary" disabled={busy} onClick={()=>void approveSubmittedRecord(selectedRecord)}>Approve employee</button>}<button className="button-secondary" disabled={busy||Boolean(selectedRecord.resulting_employee_id)} onClick={()=>void saveReview('REJECT')}>Reject record</button></div>
        <p className="live-form-hint">Submitting creates an employee draft through employee_import_atomic and queues it for review. It does not approve the employee or overwrite an existing employee or approved compensation.</p>
      </section>}
      </div>
    </section>}
    <p className="live-form-hint"><FileSpreadsheet size={14}/> Payroll amounts remain in batch staging. Payroll runs, payments, statutory deductions and employee compensation are not written by this upload action.</p>
  </div>
}
