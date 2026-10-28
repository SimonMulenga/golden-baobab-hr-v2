import { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContext } from '../companies/WorkspaceContext'
import { mockCompanies } from '../companies/mockData'
import { EmployeeContext } from '../employees/EmployeeContext'
import { mockEmployees } from '../employees/mockData'
import { PayrollContext, type DemoDeduction, type DemoPayrollRun } from './PayrollContext'
import { IntegratedPayrollScreen } from './IntegratedPayrollScreen'

let observedDeductions: DemoDeduction[] = []
function Harness() {
  const [runs, setRuns] = useState<DemoPayrollRun[]>([])
  const [deductions, setDeductions] = useState<DemoDeduction[]>([{
    id: 'demo-advance-1', employeeId: mockEmployees[0].id, employeeName: `${mockEmployees[0].firstName} ${mockEmployees[0].lastName}`,
    companyId: 'co-copperbelt', branchId: 'br-kitwe', type: 'Medical advance', principalCents: 600_000,
    balanceCents: 600_000, reason: 'Synthetic six-month advance', status: 'ACTIVE',
    schedule: Array.from({ length: 6 }, (_, index) => ({ sequence: index + 1, periodStart: `2026-${String(index + 11).padStart(2, '0')}-01`, amountCents: 100_000 })), postedRunIds: [],
  }])
  useEffect(() => { observedDeductions = deductions }, [deductions])
  const store = {
    deductions, runs,
    saveDeduction: (record: DemoDeduction) => setDeductions((items) => items.some((item) => item.id === record.id) ? items.map((item) => item.id === record.id ? record : item) : [record, ...items]),
    saveRun: (run: DemoPayrollRun) => setRuns((items) => items.some((item) => item.id === run.id) ? items.map((item) => item.id === run.id ? run : item) : [run, ...items]),
    finalizeRun: (runId: string) => {
      const run = runs.find((item) => item.id === runId)
      if (!run || run.status !== 'APPROVED') return
      setRuns((items) => items.map((item) => item.id === runId ? { ...item, status: 'FINALIZED' } : item))
      setDeductions((items) => items.map((item) => {
        const due = item.schedule.find((part) => part.periodStart === run.period)
        if (item.status !== 'ACTIVE' || !run.postedDeductionIds.includes(item.id) || !due || item.postedRunIds.includes(runId)) return item
        return { ...item, balanceCents: item.balanceCents - due.amountCents, postedRunIds: [...item.postedRunIds, runId] }
      }))
    },
  }
  const employees = [...mockEmployees, { ...mockEmployees[0], id: 'pending-demo', firstName: 'Pending', approvalStatus: 'SUBMITTED_FOR_HR_APPROVAL' as const }]
  return <WorkspaceContext.Provider value={{ companies: mockCompanies, saveCompany: vi.fn(), deleteCompany: vi.fn(), setActiveCompany: vi.fn(), activeCompanyId: 'all' }}><EmployeeContext.Provider value={{ employees, saveEmployee: vi.fn(), saveEmployees: vi.fn() }}><PayrollContext.Provider value={store}><IntegratedPayrollScreen /></PayrollContext.Provider></EmployeeContext.Provider></WorkspaceContext.Provider>
}

describe('integrated mock payroll workflow', () => {
  it('excludes pending employees and posts a scheduled advance only after HR finalizes', async () => {
    observedDeductions = []
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'co-copperbelt' } })
    fireEvent.change(screen.getByLabelText('Simulated preparer role'), { target: { value: 'BRANCH_MANAGER' } })
    fireEvent.change(screen.getByLabelText('Branch scope'), { target: { value: 'br-kitwe' } })
    fireEvent.change(screen.getByLabelText('Payroll period'), { target: { value: '2026-11' } })
    expect(screen.getByText('23')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit demo payroll' }))
    expect(await screen.findByText('SUBMITTED FOR APPROVAL')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Begin HR review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finalize demo' }))
    await waitFor(() => expect(observedDeductions[0].balanceCents).toBe(500_000))
    expect(observedDeductions[0].postedRunIds).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})

