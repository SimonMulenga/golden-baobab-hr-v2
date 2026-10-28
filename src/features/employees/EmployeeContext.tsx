import { createContext, useContext } from 'react'
import type { Employee } from './types'

export type EmployeeStore = { employees: Employee[]; saveEmployee: (employee: Employee) => void; saveEmployees: (employees: Employee[]) => void }
export const EmployeeContext = createContext<EmployeeStore | null>(null)
export function useEmployees() {
  const state = useContext(EmployeeContext)
  if (!state) throw new Error('Employee state is not available')
  return state
}
