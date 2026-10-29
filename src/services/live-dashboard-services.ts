import type { SupabaseClient } from '@supabase/supabase-js'

export type DashboardMetrics = {
  employees: number
  activeEmployees: number
  attendancePeriods: number
  pendingLeave: number
  payrollRuns: number
  pendingApprovals: number
  finalizedPayrollTotal: number | null
}

type CountResult = { count: number | null; error: unknown }
const emptyMetrics = (): DashboardMetrics => ({ employees: 0, activeEmployees: 0, attendancePeriods: 0, pendingLeave: 0, payrollRuns: 0, pendingApprovals: 0, finalizedPayrollTotal: null })

export async function loadDashboardMetrics(client: SupabaseClient, companyIds: string[], branchIds: string[] = []): Promise<DashboardMetrics> {
  if (!companyIds.length) return emptyMetrics()
  const count = async (table: string, configure: (query: any) => any): Promise<number> => {
    let query = client.from(table).select('id', { count: 'exact', head: true })
    query = configure(query)
    const result = await query as CountResult
    if (result.error) throw result.error
    return result.count ?? 0
  }
  const inScope = (query: any, field: string) => branchIds.length ? query.in(field, branchIds) : query.in('company_id', companyIds)
  const baseEmployee = (query: any) => inScope(query, 'workplace_branch_id')
  const [employees, activeEmployees, attendancePeriods, pendingLeave, payrollRuns, employeeApprovals, leaveApprovals, attendanceApprovals, payrollApprovals] = await Promise.all([
    count('employees', baseEmployee),
    count('employees', (q) => baseEmployee(q).eq('approval_status', 'APPROVED').eq('employment_status', 'ACTIVE')),
    count('attendance_periods', (q) => inScope(q, 'branch_id')),
    count('leave_requests', (q) => inScope(q, 'branch_id').eq('status', 'PENDING')),
    count('payroll_runs', (q) => inScope(q, 'branch_id')),
    count('employees', (q) => baseEmployee(q).eq('approval_status', 'SUBMITTED_FOR_HR_APPROVAL')),
    count('leave_requests', (q) => inScope(q, 'branch_id').eq('status', 'PENDING')),
    count('attendance_periods', (q) => inScope(q, 'branch_id').eq('status', 'SUBMITTED')),
    count('payroll_runs', (q) => inScope(q, 'branch_id').in('status', ['SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW'])),
  ])
  let finalizedPayrollTotal: number | null = null
  try {
    let query = client.from('payroll_run_items').select('net_pay,payroll_runs!inner(status,company_id,branch_id)', { count: 'exact' }).eq('payroll_runs.status', 'FINALIZED')
    query = branchIds.length ? query.in('payroll_runs.branch_id', branchIds) : query.in('payroll_runs.company_id', companyIds)
    const result = await query.range(0, 9999) as { data: Array<{ net_pay: number | string }> | null; error: unknown }
    if (result.error) throw result.error
    finalizedPayrollTotal = (result.data ?? []).reduce((sum, row) => sum + Number(row.net_pay || 0), 0)
  } catch {
    // RLS may allow run visibility while withholding payroll row access. Keep salary data unavailable.
  }
  return { employees, activeEmployees, attendancePeriods, pendingLeave, payrollRuns, pendingApprovals: employeeApprovals + leaveApprovals + attendanceApprovals + payrollApprovals, finalizedPayrollTotal }
}
