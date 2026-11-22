export const fixedDiagnosticRecipient = 'simonmulenga155@gmail.com'

export type DiagnosticStatus = 'NOT_SENT' | 'ACCEPTED' | 'DELIVERED' | 'DELAYED' | 'FAILED' | 'UNKNOWN'

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

export function safeDeliveryHistory(rows: Array<{ status: string; updated_at: string }>) {
  const allowed = new Set(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED'])
  return rows
    .filter((row) => allowed.has(row.status))
    .slice(0, 20)
    .map((row) => ({ status: row.status, updatedAt: row.updated_at }))
}
