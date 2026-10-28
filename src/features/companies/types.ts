export type CompanyStatus = 'Active' | 'Inactive' | 'Pending'

export type Branch = {
  id: string
  name: string
  code: string
  province: string
  town: string
  address: string
  manager: string
  phone: string
  status: CompanyStatus
  employeeCount: number
}

export type Company = {
  id: string
  /** Present for LIVE records; used only as an identifier checked again by RLS. */
  portfolioId?: string
  name: string
  registrationNumber: string
  tpin: string
  industry: string
  email: string
  phone: string
  address: string
  province: string
  town: string
  logo: string
  contactPerson: string
  status: CompanyStatus
  employeeCount: number
  createdAt: string
  branches: Branch[]
}

export type CompanyInput = Omit<Company, 'id' | 'createdAt' | 'employeeCount' | 'branches'>
export type BranchInput = Omit<Branch, 'id' | 'employeeCount'>

