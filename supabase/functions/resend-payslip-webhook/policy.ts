export const supportedResendEvents = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.failed',
  'email.delivery_delayed',
])

export function hasDiagnosticPurposeTag(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => item && typeof item === 'object' && !Array.isArray(item)
    && (item as Record<string, unknown>).name === 'purpose'
    && (item as Record<string, unknown>).value === 'infrastructure-diagnostic')
}
