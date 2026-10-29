import type { SupabaseClient } from '@supabase/supabase-js'

export type DepartmentRecord = {
  id: string; portfolio_id: string; company_id: string; name: string; code: string
  description: string; status: 'ACTIVE' | 'INACTIVE'; created_at: string; updated_at: string
}
export type JobRoleRecord = {
  id: string; portfolio_id: string; company_id: string; department_id: string | null
  title: string; code: string; description: string; status: 'ACTIVE' | 'INACTIVE'
  created_at: string; updated_at: string
}
export type EmployeeDocumentRecord = {
  id: string; employee_id: string; document_type: 'IDENTITY' | 'CONTRACT' | 'CERTIFICATE' | 'TAX' | 'OTHER'
  storage_path: string; file_name: string; content_type: string; byte_size: number; uploaded_by: string; created_at: string
}
export type AttendancePeriodHistoryRecord = {
  id: number; attendance_period_id: string; actor_id: string; action: string
  previous_status: string | null; new_status: string; reason: string | null; occurred_at: string
}
export type LeaveRequestRecord = {
  id: string; portfolio_id: string; company_id: string; branch_id: string; employee_id: string
  leave_policy_id: string | null; leave_type: string; pay_classification: 'PAID' | 'UNPAID'
  start_date: string; end_date: string; leave_days: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION' | 'CANCELED'
  requested_by: string; reviewed_by: string | null; reviewed_at: string | null
  reason: string | null; review_reason: string | null
}
export type LeavePolicyRecord = {
  id: string; portfolio_id: string; company_id: string; leave_type: string
  pay_classification: 'PAID' | 'UNPAID'; accrual_days_per_month: number
  maximum_balance_days: number | null; effective_from: string; effective_to: string | null
  enabled: boolean; day_count_method: 'WORKING_DAYS' | 'CALENDAR_DAYS'
  carry_forward_limit_days: number | null
}
export type LeaveCalendarExceptionRecord = {
  id: string; company_id: string; calendar_date: string; is_working_day: boolean; label: string
}
export type LeaveRequestHistoryRecord = {
  id: number; leave_request_id: string; actor_id: string; action: string
  previous_status: string | null; new_status: string; reason: string | null; occurred_at: string
}
export type LeaveBalanceRecord = {
  portfolio_id: string; company_id: string; branch_id: string; employee_id: string
  leave_policy_id: string; leave_type: string; pay_classification: 'PAID' | 'UNPAID'
  accrual_days_per_month: number; available_days: number
}

async function resultValue<T>(result: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const resolved = await result
  if (resolved.error) throw resolved.error
  if (resolved.data === null) throw new Error('The HR service returned no result.')
  return resolved.data
}

export function createLiveHrServices(client: SupabaseClient) {
  return {
    catalog: {
      async departments(companyId: string, includeInactive = true): Promise<DepartmentRecord[]> {
        let query = client.from('departments').select('id,portfolio_id,company_id,name,code,description,status,created_at,updated_at').eq('company_id', companyId).order('name')
        if (!includeInactive) query = query.eq('status', 'ACTIVE')
        const response = await query
        if (response.error) throw response.error
        return (response.data ?? []) as DepartmentRecord[]
      },
      async jobRoles(companyId: string, includeInactive = true): Promise<JobRoleRecord[]> {
        let query = client.from('job_roles').select('id,portfolio_id,company_id,department_id,title,code,description,status,created_at,updated_at').eq('company_id', companyId).order('title')
        if (!includeInactive) query = query.eq('status', 'ACTIVE')
        const response = await query
        if (response.error) throw response.error
        return (response.data ?? []) as JobRoleRecord[]
      },
      saveDepartment(input: { companyId: string; id?: string; name: string; code: string; description: string }): Promise<string> {
        return resultValue(client.rpc('department_save', { p_company_id: input.companyId, p_department_id: input.id ?? null, p_name: input.name, p_code: input.code, p_description: input.description }))
      },
      deactivateDepartment(id: string): Promise<string> { return resultValue(client.rpc('department_deactivate', { p_department_id: id })) },
      activateDepartment(id: string): Promise<string> { return resultValue(client.rpc('department_activate', { p_department_id: id })) },
      saveJobRole(input: { companyId: string; id?: string; departmentId: string | null; title: string; code: string; description: string }): Promise<string> {
        return resultValue(client.rpc('job_role_save', { p_company_id: input.companyId, p_job_role_id: input.id ?? null, p_department_id: input.departmentId, p_title: input.title, p_code: input.code, p_description: input.description }))
      },
      deactivateJobRole(id: string): Promise<string> { return resultValue(client.rpc('job_role_deactivate', { p_job_role_id: id })) },
    },
    employeeDocuments: {
      async list(employeeId: string): Promise<EmployeeDocumentRecord[]> {
        const response = await client.from('employee_documents').select('id,employee_id,storage_path,document_type,file_name,content_type,byte_size,uploaded_by,created_at').eq('employee_id', employeeId).order('created_at', { ascending: false })
        if (response.error) throw response.error
        return (response.data ?? []) as EmployeeDocumentRecord[]
      },
      async upload(input: { employee: { id: string; portfolio_id: string; company_id: string; workplace_branch_id: string }; file: File; type: EmployeeDocumentRecord['document_type'] }): Promise<void> {
        const file = input.file
        const mime = file.type.toLowerCase()
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mime)) throw new Error('Choose a PDF, JPEG or PNG document.')
        if (file.size < 1 || file.size > 15 * 1024 * 1024) throw new Error('Documents must be 15 MB or smaller.')
        const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : 'png'
        const path = `${input.employee.portfolio_id}/${input.employee.company_id}/${input.employee.workplace_branch_id}/${input.employee.id}/${crypto.randomUUID()}.${extension}`
        const storage = client.storage.from('gb-employee-documents')
        const uploaded = await storage.upload(path, file, { contentType: mime, upsert: false })
        if (uploaded.error) throw uploaded.error
        const registered = await client.rpc('employee_document_register', {
          p_employee_id: input.employee.id, p_storage_path: path, p_document_type: input.type,
          p_file_name: file.name.slice(0, 180), p_content_type: mime, p_byte_size: file.size,
        })
        if (registered.error) {
          const cleanup = await storage.remove([path])
          if (cleanup.error) throw new Error('Document registration failed and its unregistered private upload could not be cleaned up. Contact an administrator.')
          throw registered.error
        }
      },
      async signedDownload(storagePath: string): Promise<string> {
        const result = await client.storage.from('gb-employee-documents').createSignedUrl(storagePath, 60)
        if (result.error) throw result.error
        return result.data.signedUrl
      },
    },
    attendance: {
      async history(periodId: string): Promise<AttendancePeriodHistoryRecord[]> {
        const response = await client.from('attendance_period_history').select('id,attendance_period_id,actor_id,action,previous_status,new_status,reason,occurred_at').eq('attendance_period_id', periodId).order('occurred_at', { ascending: true })
        if (response.error) throw response.error
        return (response.data ?? []) as AttendancePeriodHistoryRecord[]
      },
    },
    leave: {
      async requests(input: { companyId: string; branchId?: string; page: number; pageSize: number; status?: string }): Promise<{ items: LeaveRequestRecord[]; total: number }> {
        const page = Math.max(0, input.page - 1)
        const size = Math.min(100, Math.max(1, input.pageSize))
        let query = client.from('leave_requests').select('id,portfolio_id,company_id,branch_id,employee_id,leave_policy_id,leave_type,pay_classification,start_date,end_date,leave_days,status,requested_by,reviewed_by,reviewed_at,reason,review_reason', { count: 'exact' }).eq('company_id', input.companyId).order('created_at', { ascending: false }).range(page * size, page * size + size - 1)
        if (input.branchId) query = query.eq('branch_id', input.branchId)
        if (input.status) query = query.eq('status', input.status)
        const response = await query
        if (response.error) throw response.error
        return { items: (response.data ?? []) as LeaveRequestRecord[], total: response.count ?? 0 }
      },
      async policies(companyId: string): Promise<LeavePolicyRecord[]> {
        const response = await client.from('leave_policies').select('id,portfolio_id,company_id,leave_type,pay_classification,accrual_days_per_month,maximum_balance_days,effective_from,effective_to,enabled,day_count_method,carry_forward_limit_days').eq('company_id', companyId).eq('enabled', true).order('effective_from', { ascending: false })
        if (response.error) throw response.error
        return (response.data ?? []) as LeavePolicyRecord[]
      },
      async balances(companyId: string): Promise<LeaveBalanceRecord[]> {
        const response = await client.from('leave_balances').select('portfolio_id,company_id,branch_id,employee_id,leave_policy_id,leave_type,pay_classification,accrual_days_per_month,available_days').eq('company_id', companyId)
        if (response.error) throw response.error
        return (response.data ?? []) as LeaveBalanceRecord[]
      },
      async calendar(companyId: string): Promise<LeaveCalendarExceptionRecord[]> {
        const response = await client.from('leave_calendar_exceptions').select('id,company_id,calendar_date,is_working_day,label').eq('company_id', companyId).order('calendar_date')
        if (response.error) throw response.error
        return (response.data ?? []) as LeaveCalendarExceptionRecord[]
      },
      saveCalendarException(input: { companyId: string; date: string; isWorkingDay: boolean; label: string }): Promise<string> {
        return resultValue(client.rpc('leave_calendar_exception_save', { p_company_id: input.companyId, p_calendar_date: input.date, p_is_working_day: input.isWorkingDay, p_label: input.label }))
      },
      removeCalendarException(id: string): Promise<string> { return resultValue(client.rpc('leave_calendar_exception_remove', { p_exception_id: id })) },
      savePolicy(input: { companyId: string; id?: string; leaveType: string; classification: 'PAID' | 'UNPAID'; accrualPerMonth: number; cap: number | null; effectiveFrom: string; effectiveTo: string | null; dayCountMethod: 'WORKING_DAYS' | 'CALENDAR_DAYS'; carryForwardLimit: number | null }): Promise<string> {
        return resultValue(client.rpc('leave_policy_save_configured', { p_company_id: input.companyId, p_leave_policy_id: input.id ?? null, p_leave_type: input.leaveType, p_pay_classification: input.classification, p_accrual_days_per_month: input.accrualPerMonth, p_maximum_balance_days: input.cap, p_effective_from: input.effectiveFrom, p_effective_to: input.effectiveTo, p_day_count_method: input.dayCountMethod, p_carry_forward_limit_days: input.carryForwardLimit }))
      },
      async createRequest(input: { portfolioId: string; companyId: string; branchId: string; employeeId: string; policyId: string; startDate: string; endDate: string; reason: string; idempotencyKey: string }): Promise<string> {
        return resultValue(client.rpc('leave_create_request_calculated', { p_portfolio_id: input.portfolioId, p_company_id: input.companyId, p_branch_id: input.branchId, p_employee_id: input.employeeId, p_leave_policy_id: input.policyId, p_start_date: input.startDate, p_end_date: input.endDate, p_reason: input.reason, p_idempotency_key: input.idempotencyKey }))
      },
      transition(requestId: string, decision: 'APPROVE' | 'REJECT' | 'RETURN' | 'SUBMIT' | 'CANCEL', reason?: string): Promise<string> {
        return resultValue(client.rpc('leave_request_transition', { p_leave_request_id: requestId, p_decision: decision, p_reason: reason ?? null }))
      },
      async history(requestId: string): Promise<LeaveRequestHistoryRecord[]> {
        const response = await client.from('leave_request_history').select('id,leave_request_id,actor_id,action,previous_status,new_status,reason,occurred_at').eq('leave_request_id', requestId).order('occurred_at', { ascending: true })
        if (response.error) throw response.error
        return (response.data ?? []) as LeaveRequestHistoryRecord[]
      },
      accrueMonth(policyId: string, periodStart: string): Promise<number> {
        return resultValue(client.rpc('leave_accrue_month', { p_policy_id: policyId, p_period_start: periodStart }))
      },
    },
  }
}
