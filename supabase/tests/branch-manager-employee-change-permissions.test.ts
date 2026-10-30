import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261030003900_branch_manager_employee_change_permissions.sql'), 'utf8')
const branchRole = migration.match(/\('BRANCH_MANAGER',[\s\S]*?\n\s*\('PAYROLL_PROCESSOR'/)?.[0] ?? ''

describe('assigned-branch employee-change permission migration', () => {
  it('adds employee and compensation request permissions only to the existing branch role', () => {
    expect(branchRole).toContain("('BRANCH_MANAGER', 'employee.edit')")
    expect(branchRole).toContain("('BRANCH_MANAGER', 'compensation.view')")
    expect(branchRole).toContain("('BRANCH_MANAGER', 'compensation.edit')")
    expect(branchRole).not.toContain("('BRANCH_MANAGER', 'employee.approve')")
    expect(branchRole).not.toContain("('BRANCH_MANAGER', 'employee.private.view')")
  })

  it('continues to require an active assignment to the requested branch', () => {
    expect(migration).toContain('from public.branch_assignments ba')
    expect(migration).toContain('ba.branch_id = p_branch_id')
    expect(migration).toContain('ba.revoked_at is null')
  })
})
