export type EmploymentStatus = 'Active' | 'On leave' | 'Probation' | 'Inactive'
export type EmployeeApprovalStatus = 'DRAFT' | 'SUBMITTED_FOR_HR_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION'
export type EmployeeApprovalEvent = {
  id: string
  from: EmployeeApprovalStatus | null
  to: EmployeeApprovalStatus
  actor: string
  at: string
  reason?: string
}
export type Employee = {
  id: string
  employeeNumber: string
  firstName: string
  middleName: string
  lastName: string
  dateOfBirth: string
  gender: string
  nationality: string
  idReference: string
  phone: string
  email: string
  emailUnavailableReason?: string
  address: string
  companyId: string
  branchId: string
  department: string
  jobTitle: string
  employmentType: string
  startDate: string
  contractEndDate: string
  status: EmploymentStatus
  manager: string
  basicSalary: number
  housingAllowance?: number
  mealAllowance?: number
  transportAllowance?: number
  otherAllowances?: number
  overtimeEligible?: boolean
  salaryFrequency: string
  paymentMethod: string
  bankName: string
  accountName: string
  accountNumber: string
  tpin: string
  napsaReference: string
  nhimaReference: string
  approvalStatus?: EmployeeApprovalStatus
  approvalHistory?: EmployeeApprovalEvent[]
  createdBy?: string
  submittedAt?: string
  reviewedBy?: string
  reviewedAt?: string
  rejectionReason?: string
  emergencyContactName?: string
  emergencyContactRelationship?: string
  emergencyContactPhone?: string
  contractType?: string
  retirementAge?: number
  retirementStatus?: 'NOT_RETIRED' | 'RETIRED'
  contributionTreatment?: 'STANDARD' | 'EXEMPT' | 'UNVERIFIED'
}

