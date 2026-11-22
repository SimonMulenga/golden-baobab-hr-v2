import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyResendWebhookSignature } from '../_shared/payslip-tokens.ts'
import { hasDiagnosticPurposeTag, hasPayslipProductTag, supportedResendEvents } from './policy.ts'

const reply = (status: number, value: Record<string, unknown>) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' })
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) return reply(503, { error: 'Webhook verification is not configured.' })
  const rawBody = await request.text()
  const eventId = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  const verified = await verifyResendWebhookSignature({ secret, eventId, timestamp, signature, rawBody })
  if (!verified) return reply(401, { error: 'Webhook signature is invalid.' })
  let parsed: Record<string, unknown>
  try { parsed = object(JSON.parse(rawBody)) } catch { return reply(400, { error: 'Invalid event payload.' }) }
  const type = text(parsed.type)
  const data = object(parsed.data)
  const diagnostic = hasDiagnosticPurposeTag(data.tags)
  if (!hasPayslipProductTag(data.tags)) {
    return reply(202, { received: true, ignored: true })
  }
  const messageId = text(data.email_id || data.id)
  const eventTime = text(parsed.created_at || data.created_at)
  if (!supportedResendEvents.has(type) || !messageId) {
    // A correctly signed but unrelated event is acknowledged and ignored.
    return reply(202, { received: true, ignored: true })
  }
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply(503, { error: 'Webhook storage is not configured.' })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: applied, error } = await admin.rpc('payslip_email_apply_webhook', {
    p_provider_event_id: eventId,
    p_provider_message_id: messageId,
    p_event_type: type,
    p_occurred_at: Number.isFinite(Date.parse(eventTime)) ? new Date(eventTime).toISOString() : null,
  })
  if (error) {
    // Do not log provider payloads, recipient addresses, or payroll details.
    console.error('Resend payslip webhook persistence failed')
    return reply(500, { error: 'Delivery event could not be recorded.' })
  }
  if (diagnostic) {
    const { error: diagnosticError } = await admin.rpc('payslip_resend_diagnostic_apply_event', {
      p_provider_event_id: eventId,
      p_provider_message_id: messageId,
      p_event_type: type,
      p_occurred_at: Number.isFinite(Date.parse(eventTime)) ? new Date(eventTime).toISOString() : null,
    })
    if (diagnosticError) {
      console.error('Resend diagnostic event status update failed')
      return reply(500, { error: 'Diagnostic event status could not be recorded.' })
    }
  }
  return reply(200, { received: true, applied: applied === true })
})
