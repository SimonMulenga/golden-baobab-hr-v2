import { describe, expect, it } from 'vitest'
import { createImportedEmployee } from './employee-import'

describe('synthetic employee import mapping', () => {
  it('keeps unknown personal and banking values blank and assigns the chosen workplace branch', () => {
    const employee = createImportedEmployee({
      firstName: 'Demo', lastName: 'Person', email: 'demo@example.test', employeeNumber: '', department: '', jobTitle: '', phone: '',
    }, { id: 'import-1', employeeNumber: 'GB-I00001', companyId: 'company-1', branchId: 'workplace-branch-2', submittedAt: '2026-10-28T10:00:00.000Z' })

    expect(employee).toMatchObject({
      employeeNumber: 'GB-I00001', companyId: 'company-1', branchId: 'workplace-branch-2',
      nationality: '', idReference: '', dateOfBirth: '', address: '', bankName: '', accountName: '', accountNumber: '',
      employmentType: '', contractType: '', startDate: '', approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL',
    })
    expect(employee.approvalHistory?.[0]).toMatchObject({ to: 'SUBMITTED_FOR_HR_APPROVAL', actor: 'Demo importer' })
  })
})

