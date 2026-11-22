export const supportedResendEvents = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.failed',
  'email.delivery_delayed',
])

export function hasDiagnosticPurposeTag(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => item && typeof item === 'object' && !Array.isArray(item)
    && (item as Record<string, unknown>).name === 'purpose'
    && (item as Record<string, unknown>).value === 'infrastructure-diagnostic')
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).purpose === 'infrastructure-diagnostic'
}

export function hasPayslipProductTag(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => item && typeof item === 'object' && !Array.isArray(item)
    && (item as Record<string, unknown>).name === 'product'
    && (item as Record<string, unknown>).value === 'golden-baobab-payslip')
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).product === 'golden-baobab-payslip'
}
