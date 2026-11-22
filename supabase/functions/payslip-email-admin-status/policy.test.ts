import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { configuredBoolean, diagnosticStatus, fixedDiagnosticRecipient, isFixedRecipient, safeDeliveryHistory, safeEventHistory } from './policy.ts'

Deno.test('status booleans are true only for an exact true value', () => {
  assertEquals(configuredBoolean('true'), true)
  assertEquals(configuredBoolean('TRUE'), true)
  assertEquals(configuredBoolean('false'), false)
  assertEquals(configuredBoolean(undefined), false)
})

Deno.test('diagnostic recipient is fixed and cannot be changed by a caller', () => {
  assertEquals(fixedDiagnosticRecipient, 'simonmulenga155@gmail.com')
  assertEquals(isFixedRecipient('SIMONMULENGA155@gmail.com'), true)
  assertEquals(isFixedRecipient('other@example.test'), false)
  assertEquals(isFixedRecipient(undefined), false)
})

Deno.test('diagnostic result separates acceptance from webhook delivery evidence', () => {
  assertEquals(diagnosticStatus(false, undefined, undefined), 'NOT_SENT')
  assertEquals(diagnosticStatus(true, 'ACCEPTED', undefined), 'ACCEPTED')
  assertEquals(diagnosticStatus(true, 'ACCEPTED', 'DELIVERED'), 'DELIVERED')
  assertEquals(diagnosticStatus(true, 'ACCEPTED', 'DELAYED'), 'DELAYED')
  assertEquals(diagnosticStatus(true, 'FAILED', undefined), 'FAILED')
  assertEquals(diagnosticStatus(true, 'IN_PROGRESS', undefined), 'UNKNOWN')
})

Deno.test('event history exposes only allowlisted event type and timestamp fields', () => {
  assertEquals(safeEventHistory([
    { event_type: 'email.delivered', occurred_at: '2026-11-22T09:00:00Z', received_at: '2026-11-22T09:00:01Z' },
    { event_type: 'unsafe.internal', occurred_at: null, received_at: '2026-11-22T09:00:02Z' },
  ]), [{ eventType: 'email.delivered', occurredAt: '2026-11-22T09:00:00Z' }])
})

Deno.test('payslip history contains only normalized status and timestamp fields', () => {
  assertEquals(safeDeliveryHistory([
    { status: 'DELIVERED', updated_at: '2026-11-22T09:00:00Z', employee_email: 'private@example.test' } as { status: string; updated_at: string },
    { status: 'INTERNAL', updated_at: '2026-11-22T09:00:01Z' },
  ]), [{ status: 'DELIVERED', updatedAt: '2026-11-22T09:00:00Z' }])
})
