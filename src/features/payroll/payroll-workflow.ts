export type PayrollStatus = 'DRAFT' | 'CALCULATED' | 'SUBMITTED_FOR_APPROVAL' | 'UNDER_REVIEW' | 'APPROVED' | 'FINALIZED' | 'RETURNED_FOR_CORRECTION' | 'REJECTED' | 'REVERSED'
export type PayrollActorRole = 'BRANCH_MANAGER' | 'PAYROLL_PROCESSOR' | 'OVERALL_HR_MANAGER' | 'PORTFOLIO_ADMIN' | 'PLATFORM_SUPER_ADMIN'
export type PayrollWorkflowEvent = { type: string; actorId: string; at: string; reason?: string; version?: number; idempotencyKey?: string }
export type PayrollWorkflowRun = {
  id: string
  companyId: string
  branchId: string
  period: string
  createdBy: string
  version: number
  status: PayrollStatus
  approvedVersion?: number
  approvedBy?: string
  finalizationKey?: string
  events: PayrollWorkflowEvent[]
}

export function createPayrollRun(input: Pick<PayrollWorkflowRun, 'id' | 'companyId' | 'branchId' | 'period' | 'createdBy'>, at: string): PayrollWorkflowRun {
  return { ...input, version: 1, status: 'DRAFT', events: [{ type: 'CREATED', actorId: input.createdBy, at, version: 1 }] }
}

export function submitPayroll(run: PayrollWorkflowRun, actor: { id: string; role: PayrollActorRole; assignedBranchIds: string[] }, at: string): PayrollWorkflowRun {
  if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new Error('Only a draft or calculated run can be submitted; return decisions require a correction and recalculation first.')
  if (actor.role === 'BRANCH_MANAGER' || actor.role === 'PAYROLL_PROCESSOR') {
    if (!actor.assignedBranchIds.includes(run.branchId)) throw new Error('This user is not assigned to the payroll branch.')
  } else if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) {
    throw new Error('This role cannot submit payroll.')
  }
  return { ...run, status: 'SUBMITTED_FOR_APPROVAL', events: [...run.events, { type: 'SUBMITTED_FOR_APPROVAL', actorId: actor.id, at, version: run.version }] }
}

export function beginPayrollReview(run: PayrollWorkflowRun, actor: { id: string; role: PayrollActorRole }, at: string): PayrollWorkflowRun {
  if (run.status !== 'SUBMITTED_FOR_APPROVAL') throw new Error('Only submitted payroll can enter review.')
  if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) throw new Error('This role cannot review payroll.')
  if (actor.id === run.createdBy) throw new Error('The payroll preparer cannot review or approve their own run.')
  return { ...run, status: 'UNDER_REVIEW', events: [...run.events, { type: 'UNDER_REVIEW', actorId: actor.id, at, version: run.version }] }
}

export function decidePayrollReview(run: PayrollWorkflowRun, decision: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION', actor: { id: string; role: PayrollActorRole }, at: string, reason = ''): PayrollWorkflowRun {
  if (run.status !== 'UNDER_REVIEW') throw new Error('Payroll must be under review before a decision.')
  if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) throw new Error('This role cannot approve payroll.')
  if (actor.id === run.createdBy) throw new Error('The payroll preparer cannot approve their own run.')
  if (decision !== 'APPROVED' && !reason.trim()) throw new Error('Provide a reason when rejecting or returning payroll.')
  return {
    ...run,
    status: decision,
    ...(decision === 'APPROVED' ? { approvedVersion: run.version, approvedBy: actor.id } : { approvedVersion: undefined, approvedBy: undefined }),
    events: [...run.events, { type: decision, actorId: actor.id, at, version: run.version, ...(reason.trim() ? { reason: reason.trim() } : {}) }],
  }
}

export function amendPayrollRun(run: PayrollWorkflowRun, actor: { id: string; role: PayrollActorRole; assignedBranchIds: string[] }, reason: string, at: string): PayrollWorkflowRun {
  if (run.status === 'FINALIZED' || run.status === 'REVERSED') throw new Error('Finalized payroll cannot be edited; use an audited reversal workflow.')
  if (actor.role === 'BRANCH_MANAGER' || actor.role === 'PAYROLL_PROCESSOR') {
    if (!actor.assignedBranchIds.includes(run.branchId)) throw new Error('This user is not assigned to the payroll branch.')
  } else if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) {
    throw new Error('This role cannot amend payroll.')
  }
  if (!reason.trim()) throw new Error('Enter a reason for changing the payroll version.')
  const nextVersion = run.version + 1
  return {
    ...run,
    version: nextVersion,
    status: 'CALCULATED',
    approvedVersion: undefined,
    approvedBy: undefined,
    events: [...run.events, { type: 'AMENDED', actorId: actor.id, at, reason: reason.trim(), version: nextVersion }],
  }
}

export function finalizePayrollRun(run: PayrollWorkflowRun, actor: { id: string; role: PayrollActorRole }, idempotencyKey: string, at: string) {
  if (!idempotencyKey.trim()) throw new Error('A finalization idempotency key is required.')
  if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) throw new Error('This role cannot finalize payroll.')
  if (run.status === 'FINALIZED' && run.finalizationKey === idempotencyKey) return { run, alreadyFinalized: true }
  if (run.status !== 'APPROVED' || run.approvedVersion !== run.version) throw new Error('Only the exact approved payroll version can be finalized.')
  const finalized: PayrollWorkflowRun = {
    ...run,
    status: 'FINALIZED',
    finalizationKey: idempotencyKey,
    events: [...run.events, { type: 'FINALIZED', actorId: actor.id, at, version: run.version, idempotencyKey }],
  }
  return { run: finalized, alreadyFinalized: false }
}

export function reversePayrollRun(run: PayrollWorkflowRun, actor: { id: string; role: PayrollActorRole }, reason: string, at: string) {
  if (run.status !== 'FINALIZED') throw new Error('Only finalized payroll can be reversed.')
  if (!['OVERALL_HR_MANAGER', 'PORTFOLIO_ADMIN', 'PLATFORM_SUPER_ADMIN'].includes(actor.role)) throw new Error('This role cannot reverse payroll.')
  if (!reason.trim()) throw new Error('A reversal reason is required.')
  const reversed: PayrollWorkflowRun = {
    ...run,
    status: 'REVERSED',
    events: [...run.events, { type: 'REVERSAL_COMPENSATION', actorId: actor.id, at, version: run.version, reason: reason.trim() }],
  }
  return reversed
}
