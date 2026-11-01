import type { PayrollRunRecord } from '../../services/live-business-services'

type ReviewError = { code?: string; message?: string }

export function payrollReviewGuidance(
  run: PayrollRunRecord,
  currentUserId: string | null,
  latestRun?: PayrollRunRecord | null,
  error?: unknown,
  allowOverallHrSelfApproval = false,
): string {
  if (currentUserId && run.created_by === currentUserId && !allowOverallHrSelfApproval) {
    return 'You prepared this payroll run. Another authorized payroll reviewer must review it.'
  }

  if (latestRun && latestRun.version !== run.version) {
    return 'This payroll calculation has changed. The latest version is loaded; review it before deciding.'
  }

  if (run.status === 'CALCULATED' || run.status === 'DRAFT' || run.status === 'RETURNED_FOR_CORRECTION') {
    return 'Submit this payroll run for approval before attempting to approve it.'
  }
  if (run.status === 'APPROVED' || run.status === 'FINALIZED') {
    return 'This payroll run has already been reviewed. Refresh the run history to see its current status.'
  }
  if (latestRun && latestRun.status !== run.status) {
    return `Another reviewer changed this run to ${latestRun.status.replaceAll('_', ' ')}. The latest status has been loaded.`
  }

  const cause = error as ReviewError | null | undefined
  if (cause?.code === '42501') {
    return 'Your account does not have permission to review payroll for this company or branch.'
  }
  return 'The review could not be saved. Refresh the run and try again; no approval was recorded.'
}
