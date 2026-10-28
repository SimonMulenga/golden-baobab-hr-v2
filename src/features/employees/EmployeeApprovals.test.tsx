import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { EmployeeContext } from './EmployeeContext'
import { mockEmployees } from './mockData'
import { EmployeeApprovals } from './EmployeeApprovals'

const pendingEmployee = {
  ...mockEmployees[0],
  id: 'approval-pending-01',
  firstName: 'Demo',
  lastName: 'Applicant',
  approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' as const,
}

function renderQueue() {
  const saveEmployee = vi.fn()
  render(
    <WorkspaceContext.Provider value={{ companies: mockCompanies, saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: 'all' }}>
      <EmployeeContext.Provider value={{ employees: [pendingEmployee], saveEmployee, saveEmployees: vi.fn() }}>
        <EmployeeApprovals />
      </EmployeeContext.Provider>
    </WorkspaceContext.Provider>,
  )
  return saveEmployee
}

describe('employee approval queue', () => {
  it('records a synthetic HR approval and removes the item from the pending queue', async () => {
    const saveEmployee = renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Approve Demo Applicant' }))

    await waitFor(() => expect(saveEmployee).toHaveBeenCalledOnce())
    expect(saveEmployee.mock.calls[0][0]).toMatchObject({
      approvalStatus: 'APPROVED',
      reviewedBy: 'Demo HR reviewer',
      approvalHistory: [{ from: 'SUBMITTED_FOR_HR_APPROVAL', to: 'APPROVED' }],
    })
  })

  it('requires and records a reason when rejecting a submission', async () => {
    const saveEmployee = renderQueue()

    fireEvent.click(screen.getByRole('button', { name: 'Reject Demo Applicant' }))
    fireEvent.change(screen.getByPlaceholderText('Describe what needs attention'), { target: { value: 'Missing required documents' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }))

    await waitFor(() => expect(saveEmployee).toHaveBeenCalledOnce())
    expect(saveEmployee.mock.calls[0][0]).toMatchObject({
      approvalStatus: 'REJECTED',
      rejectionReason: 'Missing required documents',
      approvalHistory: [{ reason: 'Missing required documents' }],
    })
  })
})

