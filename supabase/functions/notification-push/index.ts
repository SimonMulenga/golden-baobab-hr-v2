import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const allowedOrigins = new Set(['https://goldenbaobab.luskamtravelagents.com', 'https://goldenbaobab.byteandberry.com'])
const corsHeaders = (request: Request) => ({
  ...(allowedOrigins.has(request.headers.get('origin') ?? '') ? { 'Access-Control-Allow-Origin': request.headers.get('origin')! } : {}),
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-gbhr-dispatch-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
})

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Push delivery is not configured.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function configureWebPush() {
  const subject = Deno.env.get('VAPID_SUBJECT')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!subject || !publicKey || !privateKey) throw new Error('Push delivery is not configured.')
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

function genericPayload(sourceType?: string) {
  const label = sourceType === 'PAYROLL' ? 'payroll' : sourceType === 'EMPLOYEE' ? 'employee' : sourceType === 'LEAVE' ? 'leave' : 'HR'
  return JSON.stringify({ title: 'Golden Baobab HR', body: `You have a new ${label} update. Sign in to review it.`, path: '/notifications' })
}

async function sendToUser(userId: string, payload: string, outboxId?: string, endpoint?: string) {
  const client = serviceClient()
  let query = client.from('user_push_subscriptions').select('id,endpoint,p256dh,auth_secret').eq('user_id', userId)
  if (endpoint) query = query.eq('endpoint', endpoint)
  const { data: subscriptions, error } = await query
  if (error) throw new Error('Subscription lookup failed.')
  let sent = 0
  let failed = 0
  for (const subscription of subscriptions ?? []) {
    let outcome: 'SENT' | 'EXPIRED' | 'FAILED' = 'FAILED'
    let errorCode: string | null = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, payload, { TTL: 300, urgency: 'normal' })
        outcome = 'SENT'; errorCode = null; break
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode ?? 0)
        if (status === 404 || status === 410) { outcome = 'EXPIRED'; errorCode = String(status); break }
        errorCode = status ? String(status) : 'NETWORK'
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 350))
      }
    }
    if (outcome === 'SENT') sent += 1
    else failed += 1
    if (outcome === 'EXPIRED') await client.from('user_push_subscriptions').delete().eq('id', subscription.id)
    if (outboxId) await client.from('notification_push_delivery_log').insert({ outbox_id: outboxId, subscription_id: subscription.id, outcome, error_code: errorCode })
  }
  return { sent, failed }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405)
  try {
    const body = await request.json().catch(() => null) as { action?: string; outbox_id?: string; endpoint?: string } | null
    if (body?.action === 'public-key') {
      const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
      return publicKey ? json(request, { publicKey }) : json(request, { error: 'Background notifications are not configured.' }, 503)
    }
    if (body?.action === 'dispatch') {
      const expected = Deno.env.get('PUSH_DISPATCH_SECRET')
      if (!expected || request.headers.get('x-gbhr-dispatch-secret') !== expected || !body.outbox_id) return json(request, { error: 'Unauthorized.' }, 401)
      configureWebPush()
      const client = serviceClient()
      const { data: claimed, error: claimError } = await client.from('notification_push_outbox')
        .update({ state: 'PROCESSING', attempt_count: 1 }).eq('id', body.outbox_id).eq('state', 'PENDING').select('id').maybeSingle()
      if (claimError) throw new Error('Push queue claim failed.')
      if (!claimed) return json(request, { status: 'already-claimed' })
      const { data: outbox, error: outboxError } = await client.from('notification_push_outbox')
        .select('id,notification:user_notifications(recipient_id,source_type)').eq('id', claimed.id).maybeSingle()
      if (outboxError || !outbox?.notification) throw new Error('Notification lookup failed.')
      const notification = Array.isArray(outbox.notification) ? outbox.notification[0] : outbox.notification
      const result = await sendToUser(notification.recipient_id, genericPayload(notification.source_type), claimed.id)
      await client.from('notification_push_outbox').update({ state: result.failed ? (result.sent ? 'DELIVERED' : 'FAILED') : 'DELIVERED', completed_at: new Date().toISOString(), last_error_code: result.failed ? 'DELIVERY_FAILED' : null }).eq('id', claimed.id)
      return json(request, { status: 'processed', ...result })
    }

    if (body?.action === 'test') {
      const authorization = request.headers.get('authorization') ?? ''
      if (!authorization.startsWith('Bearer ')) return json(request, { error: 'Authentication required.' }, 401)
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
      if (!supabaseUrl || !anonKey) throw new Error('Push test is not configured.')
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
      const { data: { user }, error } = await userClient.auth.getUser()
      if (error || !user) return json(request, { error: 'Authentication required.' }, 401)
      if (!body.endpoint || body.endpoint.length > 2048) return json(request, { error: 'A current device subscription is required.' }, 400)
      configureWebPush()
      const result = await sendToUser(user.id, JSON.stringify({ title: 'Golden Baobab HR', body: 'Your background notifications are working.', path: '/notifications' }), undefined, body.endpoint)
      return json(request, { status: 'test-sent', ...result })
    }
    return json(request, { error: 'Unsupported action.' }, 400)
  } catch {
    // Deliberately omit endpoints, payloads, credentials, and employee data.
    return json(request, { error: 'Notification delivery failed.' }, 500)
  }
})
