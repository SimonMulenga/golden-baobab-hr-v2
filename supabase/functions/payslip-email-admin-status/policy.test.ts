import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildDeliverySummary, configuredBoolean, diagnosticStatus, fixedDiagnosticRecipient, isFixedRecipient, safeDeliveryHistory, safeEventHistory } from './policy.ts'

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

Deno.test('payslip history exposes sanitized delivery metadata and omits employee fields', () => {
  assertEquals(safeDeliveryHistory([
    { status: 'DELIVERED', updated_at: '2026-11-22T09:00:00Z', created_at: '2026-11-22T08:00:00Z', sent_at: '2026-11-22T08:01:00Z', delivered_at: '2026-11-22T09:00:00Z', provider_message_id: 'msg_01', attempts: 1, employee_email: 'private@example.test' } as { status: string; updated_at: string },
    { status: 'INTERNAL', updated_at: '2026-11-22T09:00:01Z' },
  ]), [{ status: 'DELIVERED', updatedAt: '2026-11-22T09:00:00Z', createdAt: '2026-11-22T08:00:00Z', sentAt: '2026-11-22T08:01:00Z', deliveredAt: '2026-11-22T09:00:00Z', bouncedAt: null, providerMessageId: 'msg_01', errorCode: null, attempts: 1, latestEventType: null, retryEligibleByDeliveryState: false }])
})

Deno.test('payslip history derives delayed from signed event metadata and limits retries by state and attempt count', () => {
  const now = Date.parse('2026-11-22T12:00:00Z')
  assertEquals(safeDeliveryHistory([
    { status: 'SENT', updated_at: '2026-11-22T10:00:00Z', latest_event_type: 'email.delivery_delayed', provider_message_id: 'msg_02' },
    { status: 'FAILED', updated_at: '2026-11-22T11:00:00Z', attempts: 2 },
    { status: 'FAILED', updated_at: '2026-11-22T11:00:00Z', attempts: 3, last_error_code: 'unsafe employee data' },
    { status: 'SENDING', updated_at: '2026-11-22T11:40:00Z', attempts: 1 },
  ], now).map((row) => ({ status: row.status, retryEligibleByDeliveryState: row.retryEligibleByDeliveryState, errorCode: row.errorCode })), [
    { status: 'DELAYED', retryEligibleByDeliveryState: false, errorCode: null },
    { status: 'FAILED', retryEligibleByDeliveryState: true, errorCode: null },
    { status: 'FAILED', retryEligibleByDeliveryState: false, errorCode: null },
    { status: 'SENDING', retryEligibleByDeliveryState: true, errorCode: null },
  ])
})

Deno.test('delivery summary counts stored states and keeps delay-event count distinct', () => {
  assertEquals(buildDeliverySummary({ QUEUED: 2, SENDING: 1, SENT: 3, DELIVERED: 4, FAILED: 2, BOUNCED: 1 }, 1, 5), {
    totalProcessed: 13, queued: 2, sending: 1, sent: 3, delivered: 4, failed: 2, rejected: 1, bounced: 1, deliveryDelayEvents: 5,
  })
})
