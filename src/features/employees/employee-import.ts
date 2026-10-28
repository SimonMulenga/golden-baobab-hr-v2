import type { Employee, EmployeeApprovalEvent } from './types'

export type EmployeeImportRow = {
  firstName: string
  lastName: string
  email: string
  employeeNumber: string
  department: string
  jobTitle: string
  phone: string
}

export function createImportedEmployee(
  row: EmployeeImportRow,
  assignment: { id: string; employeeNumber: string; companyId: string; branchId: string; submittedAt?: string },
): Employee {
  const submittedAt = assignment.submittedAt ?? new Date().toISOString()
  const approvalEvent: EmployeeApprovalEvent = {
    id: `approval-${assignment.id}-1`,
    from: null,
    to: 'SUBMITTED_FOR_HR_APPROVAL',
    actor: 'Demo importer',
    at: submittedAt,
  }
  return {
    id: assignment.id,
    employeeNumber: row.employeeNumber || assignment.employeeNumber,
    firstName: row.firstName,
    middleName: '',
    lastName: row.lastName,
    dateOfBirth: '',
    gender: '',
    nationality: '',
    idReference: '',
    phone: row.phone,
    email: row.email,
    address: '',
    companyId: assignment.companyId,
    branchId: assignment.branchId,
    department: row.department,
    jobTitle: row.jobTitle,
    employmentType: '',
    contractType: '',
    startDate: '',
    contractEndDate: '',
    status: 'Active',
    manager: '',
    basicSalary: 0,
    salaryFrequency: '',
    paymentMethod: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    tpin: '',
    napsaReference: '',
    nhimaReference: '',
    approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL',
    approvalHistory: [approvalEvent],
    createdBy: 'demo-import',
    submittedAt,
  }
}

export function createImportedEmployees(
  rows: EmployeeImportRow[],
  assignment: { companyId: string; branchId: string; employeeNumberStart: number },
  options: { submittedAt?: string; batchId?: string } = {},
): Employee[] {
  const submittedAt = options.submittedAt ?? new Date().toISOString()
  const batchId = options.batchId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return rows.map((row, index) => createImportedEmployee(row, {
    id: `imp-${batchId}-${index}`,
    employeeNumber: row.employeeNumber || `GB-I${String(assignment.employeeNumberStart + index).padStart(5, '0')}`,
    companyId: assignment.companyId,
    branchId: assignment.branchId,
    submittedAt,
  }))
}

