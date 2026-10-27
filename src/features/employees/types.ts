export type EmploymentStatus = 'Active' | 'On leave' | 'Probation' | 'Inactive'
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
  salaryFrequency: string
  paymentMethod: string
  bankName: string
  accountName: string
  accountNumber: string
  tpin: string
  napsaReference: string
  nhimaReference: string
}
