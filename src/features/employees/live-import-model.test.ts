import { describe, expect, it } from 'vitest'
import { dateForImport, findImportHeaderRow, importAttemptKey, mapImportHeader, rotateImportAttemptKey } from './live-import-model'

describe('LIVE employee import mapping', () => {
  it('finds a flexible header row after report title rows and maps known aliases', () => {
    const matrix = [
      ['Copperbelt company employee list'],
      ['Generated on', '28 October 2026'],
      ['Staff ID', 'Given Name', 'Surname', 'NRC Number', 'Department', 'Basic Salary'],
      ['SYN-001', 'Demo', 'Person', 'SYN-NRC-001', 'Finance', 6000],
    ]
    const index = findImportHeaderRow(matrix)
    expect(index).toBe(2)
    expect(mapImportHeader(matrix[index].map(String))).toMatchObject({
      employee_number: 'Staff ID', first_name: 'Given Name', last_name: 'Surname',
      identity_document_number: 'NRC Number', department: 'Department', basic_pay: 'Basic Salary',
    })
  })

  it('normalizes explicit date values without guessing ambiguous timestamps', () => {
    expect(dateForImport('2026-10-28')).toBe('2026-10-28')
    expect(dateForImport('3/2/2026')).toBe('2026-02-03')
    expect(dateForImport('28 October 2026')).toBe('')
  })

  it('retains an interrupted import key in the current tab and rotates only for a new attempt', () => {
    sessionStorage.clear()
    const first = importAttemptKey('synthetic-company', 'synthetic-branch')
    expect(importAttemptKey('synthetic-company', 'synthetic-branch')).toBe(first)
    const next = rotateImportAttemptKey('synthetic-company', 'synthetic-branch')
    expect(next).not.toBe(first)
    expect(importAttemptKey('synthetic-company', 'synthetic-branch')).toBe(next)
  })
})
