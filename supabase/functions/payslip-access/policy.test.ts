import { assertEquals } from 'jsr:@std/assert'
import { isValidDateOfBirth } from './policy.ts'

const today = { year: 2026, month: 11, day: 23 }

Deno.test('accepts a real date of birth in YYYY-MM-DD format', () => {
  assertEquals(isValidDateOfBirth('1990-04-02', today), true)
  assertEquals(isValidDateOfBirth('2000-02-29', today), true)
})

Deno.test('rejects impossible calendar dates and malformed input', () => {
  assertEquals(isValidDateOfBirth('2001-02-29', today), false)
  assertEquals(isValidDateOfBirth('2026-04-31', today), false)
  assertEquals(isValidDateOfBirth('1990-4-02', today), false)
  assertEquals(isValidDateOfBirth(null, today), false)
})

Deno.test('rejects future dates using the configured Lusaka calendar day', () => {
  assertEquals(isValidDateOfBirth('2026-11-24', today), false)
  assertEquals(isValidDateOfBirth('2026-11-23', today), true)
})
