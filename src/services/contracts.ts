import type { Branch, Company } from '../features/companies/types'
import type { Employee } from '../features/employees/types'

export interface PageRequest {
  search?: string
  page?: number
  pageSize?: number
  companyId?: string
  branchId?: string
}

export interface PageResult<T> {
  items: T[]
  total: number
}

export interface AuthUser {
  id: string
  email: string
  displayName: string
}

export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>
  signIn(email: string, password: string): Promise<AuthUser>
  signOut(): Promise<void>
}

export interface CompaniesService {
  list(request?: PageRequest): Promise<PageResult<Company>>
  getById(id: string): Promise<Company | null>
  create(input: Omit<Company, 'id'>): Promise<Company>
  update(id: string, input: Partial<Company>): Promise<Company>
}

export interface BranchesService {
  list(request?: PageRequest): Promise<PageResult<Branch>>
  getById(id: string): Promise<Branch | null>
  create(input: Omit<Branch, 'id'>): Promise<Branch>
  update(id: string, input: Partial<Branch>): Promise<Branch>
}

export interface EmployeesService {
  list(request?: PageRequest): Promise<PageResult<Employee>>
  getById(id: string): Promise<Employee | null>
  create(input: Omit<Employee, 'id'>): Promise<Employee>
  update(id: string, input: Partial<Employee>): Promise<Employee>
}

export interface AttendanceRecord {
  id: string
  employeeId: string
  branchId: string
  date: string
  status: 'present' | 'absent' | 'late' | 'on-leave' | 'holiday' | 'off-duty'
}

export interface AttendanceService {
  list(request?: PageRequest & { from?: string; to?: string }): Promise<PageResult<AttendanceRecord>>
}

export interface LeaveRecord {
  id: string
  employeeId: string
  type: string
  startDate: string
  endDate: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
}

export interface LeaveService {
  list(request?: PageRequest): Promise<PageResult<LeaveRecord>>
  submit(input: Omit<LeaveRecord, 'id' | 'status'>): Promise<LeaveRecord>
}

export interface PayrollRunSummary {
  id: string
  companyId: string
  period: string
  status: 'draft' | 'calculated' | 'pending-approval' | 'approved' | 'finalized' | 'cancelled'
  employeeCount: number
}

export interface PayrollService {
  listRuns(request?: PageRequest): Promise<PageResult<PayrollRunSummary>>
  getRunById(id: string): Promise<PayrollRunSummary | null>
}

export interface ReportRequest extends PageRequest {
  reportId: string
  from?: string
  to?: string
}

export interface ReportResult {
  columns: string[]
  rows: Array<Record<string, string | number | null>>
}

export interface ReportsService {
  run(request: ReportRequest): Promise<ReportResult>
}
