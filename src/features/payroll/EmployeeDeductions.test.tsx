import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeContext } from '../employees/EmployeeContext'
import { mockEmployees } from '../employees/mockData'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { EmployeeDeductions } from './EmployeeDeductions'
import { PayrollContext, type DemoDeduction } from './PayrollContext'
import { useState } from 'react'

function DemoStore() {
  const [deductions, setDeductions] = useState<DemoDeduction[]>([])
  const store = { deductions, runs: [], saveDeduction: (item: DemoDeduction) => setDeductions((current) => current.some((record) => record.id === item.id) ? current.map((record) => record.id === item.id ? item : record) : [item, ...current]), saveRun: vi.fn(), finalizeRun: vi.fn() }
  return <PayrollContext.Provider value={store}><EmployeeDeductions /></PayrollContext.Provider>
}

describe('employee deduction demo workflow', () => {
  it('previews a schedule and creates only a simulated approval request', () => {
    render(<WorkspaceContext.Provider value={{ companies: mockCompanies, saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: 'all' }}>
      <EmployeeContext.Provider value={{ employees: mockEmployees, saveEmployee: vi.fn(), saveEmployees: vi.fn() }}><DemoStore /></EmployeeContext.Provider>
    </WorkspaceContext.Provider>)

    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: mockEmployees[0].id } })
    fireEvent.change(screen.getByLabelText('Reason / description'), { target: { value: 'Synthetic medical advance example' } })
    expect(screen.getByText('Installment 6')).toBeInTheDocument()
    fireEvent.submit(screen.getByRole('button', { name: 'Submit demo request' }).closest('form')!)
    expect(screen.getByRole('button', { name: 'Overall HR approve' })).toBeInTheDocument()
    expect(screen.getByText(/No payroll deduction has been posted/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Overall HR approve' }))
    expect(screen.getByText(/ACTIVE · Demo Overall HR reviewer/)).toBeInTheDocument()
  })
})

