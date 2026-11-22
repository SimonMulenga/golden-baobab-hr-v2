export const fixedDiagnosticRecipient = 'simonmulenga155@gmail.com'

export type DiagnosticStatus = 'NOT_SENT' | 'ACCEPTED' | 'DELIVERED' | 'DELAYED' | 'FAILED' | 'UNKNOWN'
export type PayslipDeliveryStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'DELAYED' | 'FAILED' | 'BOUNCED'

export function configuredBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isFixedRecipient(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === fixedDiagnosticRecipient
}

export function diagnosticStatus(hasClaim: boolean, attemptState: string | undefined, providerStatus: string | undefined): DiagnosticStatus {
  if (!hasClaim) return 'NOT_SENT'
  if (providerStatus === 'DELIVERED') return 'DELIVERED'
  if (providerStatus === 'DELAYED') return 'DELAYED'
  if (providerStatus === 'FAILED') return 'FAILED'
  if (providerStatus === 'ACCEPTED' || attemptState === 'ACCEPTED') return 'ACCEPTED'
  if (attemptState === 'FAILED') return 'FAILED'
  return 'UNKNOWN'
}

export function safeEventHistory(rows: Array<{ event_type: string; occurred_at: string | null; received_at: string }>) {
  const allowed = new Set(['email.sent', 'email.delivered', 'email.bounced', 'email.failed', 'email.delivery_delayed'])
  return rows
    .filter((row) => allowed.has(row.event_type))
    .slice(0, 20)
    .map((row) => ({ eventType: row.event_type, occurredAt: row.occurred_at ?? row.received_at }))
}

export function safeDeliveryHistory(rows: Array<{
  status: string
  updated_at: string
  created_at?: string | null
  sent_at?: string | null
  delivered_at?: string | null
  bounced_at?: string | null
  provider_message_id?: string | null
  last_error_code?: string | null
  attempts?: number | null
  latest_event_type?: string | null
}>, nowMs = Date.now()) {
  const allowed = new Set(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED'])
  const allowedEvents = new Set(['email.sent', 'email.delivered', 'email.bounced', 'email.failed', 'email.delivery_delayed'])
  const safeErrorCodes = new Set(['DELIVERY_FAILED', 'PROVIDER_REPORTED_FAILURE'])
  return rows
    .filter((row) => allowed.has(row.status) && typeof row.updated_at === 'string')
    .slice(0, 20)
    .map((row) => {
      const latestEvent = typeof row.latest_event_type === 'string' && allowedEvents.has(row.latest_event_type) ? row.latest_event_type : null
      const status: PayslipDeliveryStatus = row.status === 'SENT' && latestEvent === 'email.delivery_delayed' ? 'DELAYED' : row.status as PayslipDeliveryStatus
      const attempts = Number.isInteger(row.attempts) && Number(row.attempts) >= 0 ? Number(row.attempts) : 0
      const updatedAtMs = Date.parse(row.updated_at)
      const staleSending = row.status === 'SENDING' && Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= 10 * 60 * 1000
      const providerMessageId = typeof row.provider_message_id === 'string'
        && row.provider_message_id.length <= 255 && /^[\w.<>:@+-]+$/u.test(row.provider_message_id)
        ? row.provider_message_id : null
      const rawError = typeof row.last_error_code === 'string' ? row.last_error_code : ''
      const errorCode = /^PROVIDER_HTTP_4\d{2}$/u.test(rawError) || /^PROVIDER_HTTP_5\d{2}$/u.test(rawError) || safeErrorCodes.has(rawError)
        ? rawError : null
      return {
        status,
        updatedAt: row.updated_at,
        createdAt: row.created_at ?? null,
        sentAt: row.sent_at ?? null,
        deliveredAt: row.delivered_at ?? null,
        bouncedAt: row.bounced_at ?? null,
        providerMessageId,
        errorCode,
        attempts,
        latestEventType: latestEvent,
        retryEligibleByDeliveryState: attempts < 3 && (row.status === 'FAILED' || staleSending),
      }
    })
}

export function buildDeliverySummary(counts: Record<string, number>, rejectedCount: number, delayedEventCount: number) {
  const statuses = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED']
  const safeCount = (status: string) => Number.isFinite(counts[status]) && counts[status] >= 0 ? Math.trunc(counts[status]) : 0
  return {
    totalProcessed: statuses.reduce((total, status) => total + safeCount(status), 0),
    queued: safeCount('QUEUED'),
    sending: safeCount('SENDING'),
    sent: safeCount('SENT'),
    delivered: safeCount('DELIVERED'),
    failed: safeCount('FAILED'),
    rejected: Number.isFinite(rejectedCount) && rejectedCount >= 0 ? Math.trunc(rejectedCount) : 0,
    bounced: safeCount('BOUNCED'),
    deliveryDelayEvents: Number.isFinite(delayedEventCount) && delayedEventCount >= 0 ? Math.trunc(delayedEventCount) : 0,
  }
}
