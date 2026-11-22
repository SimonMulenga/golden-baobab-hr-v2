import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { diagnosticGatesDisabled, diagnosticRecipient, diagnosticSubject, diagnosticText, validDiagnosticConfiguration } from './policy.ts'
import { approvedAppOrigins } from '../payslip-artifacts/origins.ts'

const corsHeaders = (request: Request) => {
  const origin = request.headers.get('origin') ?? ''
  const allowedOrigins = approvedAppOrigins(Deno.env.get('APPROVED_APP_ORIGINS') ?? '')
  return {
    ...(allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
  if (request.method !== 'POST') return respond(405, { error: 'Method not allowed.' })
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'Authentication required.' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const configuredRecipient = Deno.env.get('PAYSLIP_DIAGNOSTIC_RECIPIENT_EMAIL')?.trim().toLowerCase()
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const webhookSecretConfigured = Boolean(Deno.env.get('RESEND_WEBHOOK_SECRET')?.trim())
  const from = Deno.env.get('PAYSLIP_FROM_EMAIL')?.trim()
  const gatesDisabled = diagnosticGatesDisabled(
    Deno.env.get('PAYSLIP_LIVE_DELIVERY_ENABLED'),
    Deno.env.get('PAYSLIP_FIRST_LIVE_SEND_APPROVED'),
  )
  if (!url || !anonKey || !serviceKey || !configuredRecipient || !resendKey || !webhookSecretConfigured || !from) {
    return respond(503, { error: 'Diagnostic service is not configured.' })
  }
  if (!validDiagnosticConfiguration(configuredRecipient, from)) {
    return respond(503, { error: 'Diagnostic sender or recipient configuration is invalid.' })
  }
  if (!gatesDisabled) return respond(409, { error: 'Diagnostic sending is blocked while a payslip delivery gate is enabled.' })

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: identity, error: authError } = await caller.auth.getUser()
  if (authError || !identity.user) return respond(401, { error: 'Authentication required.' })

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: owner, error: ownerError } = await admin.from('platform_administrators')
    .select('user_id').eq('user_id', identity.user.id).is('revoked_at', null).maybeSingle()
  if (ownerError || !owner) return respond(403, { error: 'Platform owner authorization required.' })

  // The database claim is atomic and permanent. Failed provider attempts also
  // consume the one-send allowance, including across concurrent workers/restarts.
  const { data: claimed, error: claimError } = await admin.rpc('payslip_resend_diagnostic_claim_once', {
    p_owner_id: identity.user.id,
  })
  if (claimError || claimed !== true) return respond(409, { error: 'The one-time diagnostic has already been claimed.' })

  const recordResult = async (attemptState: 'ACCEPTED' | 'FAILED' | 'UNKNOWN', messageId: string | null, errorCode: string | null) => {
    const { error } = await admin.rpc('payslip_resend_diagnostic_record_result', {
      p_owner_id: identity.user.id,
      p_attempt_state: attemptState,
      p_provider_message_id: messageId,
      p_error_code: errorCode,
    })
    if (error) console.error('Resend diagnostic result persistence failed')
    return !error
  }

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'gbhr-resend-diagnostic-once-v1' },
      body: JSON.stringify({
        from,
        to: [diagnosticRecipient],
        subject: diagnosticSubject,
        text: diagnosticText,
        tags: [
          { name: 'product', value: 'golden-baobab-payslip' },
          { name: 'purpose', value: 'infrastructure-diagnostic' },
        ],
      }),
    })
  } catch {
    await recordResult('UNKNOWN', null, 'OUTCOME_UNKNOWN')
    return respond(502, { result: 'UNKNOWN', error: 'The provider outcome could not be confirmed. The one-time attempt remains consumed.' })
  }

  if (!response.ok) {
    await recordResult('FAILED', null, 'PROVIDER_REJECTED')
    return respond(502, { result: 'FAILED', error: 'The email provider rejected the diagnostic. The one-time attempt remains consumed.' })
  }

  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  const providerMessageId = typeof result.id === 'string' && result.id.length <= 255 ? result.id : null
  const statusPersisted = await recordResult('ACCEPTED', providerMessageId, null)
  return respond(200, {
    accepted: true,
    result: 'ACCEPTED',
    diagnosticId: providerMessageId,
    statusPersisted,
  })
})
