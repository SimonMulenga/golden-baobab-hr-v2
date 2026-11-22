import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { approvedAppOrigins } from '../payslip-artifacts/origins.ts'
import { validDiagnosticConfiguration } from '../payslip-resend-diagnostic/policy.ts'
import { buildDeliverySummary, configuredBoolean, diagnosticStatus, fixedDiagnosticRecipient, isFixedRecipient, safeDeliveryHistory, safeEventHistory } from './policy.ts'

const corsHeaders = (request: Request) => {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigins = approvedAppOrigins(Deno.env.get('APPROVED_APP_ORIGINS') ?? '')
  return {
    ...(allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  }
}
const response = (request: Request, status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})
const text = (value: unknown) => typeof value === 'string' ? value : ''

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'GET') return response(request, 405, { error: 'Method not allowed.' })

  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return response(request, 401, { error: 'Authentication required.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return response(request, 503, { error: 'Email status is unavailable.' })

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: identity, error: authError } = await caller.auth.getUser()
  if (authError || !identity.user) return response(request, 401, { error: 'Authentication required.' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: owner, error: ownerError } = await admin.from('platform_administrators')
    .select('user_id').eq('user_id', identity.user.id).is('revoked_at', null).maybeSingle()
  if (ownerError || !owner) return response(request, 403, { error: 'Platform owner authorization required.' })

  const [{ data: claim, error: claimError }, { data: attempt, error: attemptError }] = await Promise.all([
    admin.from('payslip_resend_diagnostic_claims').select('claimed_at').eq('singleton', true).maybeSingle(),
    admin.from('payslip_resend_diagnostic_status')
      .select('attempt_state,provider_status,provider_message_id,error_code,claimed_at,result_recorded_at,last_event_at')
      .eq('singleton', true).maybeSingle(),
  ])
  if (claimError || attemptError) return response(request, 503, { error: 'Email status is unavailable.' })

  const resendApiKeyConfigured = Boolean(Deno.env.get('RESEND_API_KEY')?.trim())
  const resendWebhookSecretConfigured = Boolean(Deno.env.get('RESEND_WEBHOOK_SECRET')?.trim())
  const sender = Deno.env.get('PAYSLIP_FROM_EMAIL')?.trim() ?? ''
  const senderDomainVerified = configuredBoolean(Deno.env.get('PAYSLIP_SENDER_DOMAIN_VERIFIED'))
  const recipientConfigured = isFixedRecipient(Deno.env.get('PAYSLIP_DIAGNOSTIC_RECIPIENT_EMAIL'))
  const attemptConsumed = Boolean(claim || attempt)
  const senderAddressValid = validDiagnosticConfiguration(fixedDiagnosticRecipient, sender)
  const livePayslipDeliveryEnabled = configuredBoolean(Deno.env.get('PAYSLIP_LIVE_DELIVERY_ENABLED'))
  const firstLiveSendApproved = configuredBoolean(Deno.env.get('PAYSLIP_FIRST_LIVE_SEND_APPROVED'))
  const configurationReady = resendApiKeyConfigured && resendWebhookSecretConfigured && senderAddressValid
    && senderDomainVerified && recipientConfigured && !livePayslipDeliveryEnabled && !firstLiveSendApproved

  let events: Array<{ eventType: string; occurredAt: string }> = []
  let eventHistoryAvailable = true
  if (attempt?.provider_message_id) {
    const { data: rows, error: eventError } = await admin.from('payslip_email_events')
      .select('event_type,occurred_at,received_at')
      .eq('provider_message_id', attempt.provider_message_id)
      .is('delivery_id', null)
      .order('received_at', { ascending: false })
      .limit(20)
    if (eventError) eventHistoryAvailable = false
    else events = safeEventHistory((rows ?? []).map((row) => ({
      event_type: text(row.event_type),
      occurred_at: typeof row.occurred_at === 'string' ? row.occurred_at : null,
      received_at: text(row.received_at),
    })))
  }

  const { data: deliveryRows, error: deliveryHistoryError } = await admin.from('payslip_email_deliveries')
    .select('status,updated_at,created_at,sent_at,delivered_at,bounced_at,provider_message_id,last_error_code,attempts')
    .order('updated_at', { ascending: false })
    .limit(20)
  const messageIds = (deliveryRows ?? []).map((row) => text(row.provider_message_id)).filter(Boolean)
  let eventStateError = false
  const latestEvents = new Map<string, string>()
  if (messageIds.length) {
    const { data: deliveryEvents, error: deliveryEventsError } = await admin.from('payslip_email_events')
      .select('provider_message_id,event_type')
      .in('provider_message_id', messageIds)
      .order('received_at', { ascending: false })
      .limit(1000)
    eventStateError = Boolean(deliveryEventsError)
    if (!deliveryEventsError) for (const event of deliveryEvents ?? []) {
      const id = text(event.provider_message_id)
      if (id && !latestEvents.has(id)) latestEvents.set(id, text(event.event_type))
    }
  }
  const deliveryHistoryAvailable = !deliveryHistoryError && !eventStateError
  const deliveryHistory = deliveryHistoryAvailable
    ? safeDeliveryHistory((deliveryRows ?? []).map((row) => ({
      status: text(row.status),
      updated_at: text(row.updated_at),
      created_at: text(row.created_at),
      sent_at: text(row.sent_at),
      delivered_at: text(row.delivered_at),
      bounced_at: text(row.bounced_at),
      provider_message_id: text(row.provider_message_id),
      last_error_code: text(row.last_error_code),
      attempts: typeof row.attempts === 'number' ? row.attempts : 0,
      latest_event_type: latestEvents.get(text(row.provider_message_id)) ?? null,
    })))
    : []

  const deliveryStates = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED'] as const
  const [stateCounts, rejectedResult, delayedEventResult] = await Promise.all([
    Promise.all(deliveryStates.map(async (state) => {
      const { count, error } = await admin.from('payslip_email_deliveries').select('id', { count: 'exact', head: true }).eq('status', state)
      return { state, count: count ?? 0, error }
    })),
    admin.from('payslip_email_deliveries').select('id', { count: 'exact', head: true }).eq('status', 'FAILED').like('last_error_code', 'PROVIDER_HTTP_4%'),
    admin.from('payslip_email_events').select('id', { count: 'exact', head: true }).eq('event_type', 'email.delivery_delayed'),
  ])
  const deliverySummaryAvailable = stateCounts.every((entry) => !entry.error) && !rejectedResult.error && !delayedEventResult.error
  const deliverySummary = deliverySummaryAvailable
    ? buildDeliverySummary(Object.fromEntries(stateCounts.map((entry) => [entry.state, entry.count])), rejectedResult.count ?? 0, delayedEventResult.count ?? 0)
    : null

  const providerStatus = ['ACCEPTED', 'DELIVERED', 'DELAYED', 'FAILED'].includes(text(attempt?.provider_status))
    ? text(attempt?.provider_status)
    : undefined
  const status = diagnosticStatus(attemptConsumed, text(attempt?.attempt_state) || undefined, providerStatus)
  return response(request, 200, {
    authorized: true,
    configuration: {
      resendApiKeyConfigured,
      resendWebhookSecretConfigured,
      senderConfigured: Boolean(sender),
      sender,
      senderAddressValid,
      senderDomainVerified,
      livePayslipDeliveryEnabled,
      firstLiveSendApproved,
      diagnosticRecipient: fixedDiagnosticRecipient,
      diagnosticRecipientConfigured: recipientConfigured,
      diagnosticConfigurationReady: configurationReady,
    },
    diagnostic: {
      status,
      attemptConsumed,
      attemptAvailable: !attemptConsumed && configurationReady,
      claimedAt: attempt?.claimed_at ?? claim?.claimed_at ?? null,
      resultRecordedAt: attempt?.result_recorded_at ?? null,
      lastEventAt: attempt?.last_event_at ?? null,
      eventHistoryAvailable,
      events,
      errorCode: ['PROVIDER_REJECTED', 'OUTCOME_UNKNOWN', 'STATUS_PERSISTENCE_FAILED'].includes(text(attempt?.error_code))
        ? text(attempt?.error_code)
        : null,
    },
    deliverySummaryAvailable,
    deliverySummary,
    deliveryHistoryAvailable,
    deliveryHistory,
  })
})
