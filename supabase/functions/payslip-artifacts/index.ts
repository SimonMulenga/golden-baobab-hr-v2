import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { approvedAppOrigins } from './origins.ts'
import { createPayslipAccessToken } from '../_shared/payslip-tokens.ts'
import { isLivePayslipDeliveryEnabled } from '../_shared/payslip-delivery-policy.ts'
import { buildPayslipPdf } from './pdf.ts'

const baseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
const reply = (status: number, body: Record<string, unknown>, origin?: string) => new Response(JSON.stringify(body), {
  status, headers: { ...baseHeaders, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) },
})
type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0 }
const text = (value: unknown) => typeof value === 'string' ? value : ''
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
function safeFailureCode(error: unknown) {
  const value = object(error)
  const code = text(value.code)
  const message = error instanceof Error ? error.message : text(value.message)
  if (code === '42501' || /not authorized|not permit/i.test(message)) return 'ISSUANCE_NOT_AUTHORIZED'
  if (code === 'P0002' || /finalized payslip source was not found/i.test(message)) return 'FINALIZED_PAYROLL_NOT_FOUND'
  if (/immutable.*conflict/i.test(message)) return 'IMMUTABLE_DOCUMENT_CONFLICT'
  if (/storage/i.test(message)) return 'PRIVATE_DOCUMENT_STORAGE_FAILED'
  return 'PAYSLIP_ISSUANCE_FAILED'
}

async function sha256(bytes: Uint8Array) {
  const digestInput = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(digestInput).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  const origins = approvedAppOrigins(Deno.env.get('APPROVED_APP_ORIGINS') ?? '')
  if (!origin || !origins.includes(origin)) return reply(403, { code: 'APP_ORIGIN_NOT_APPROVED', error: 'This application address is not enabled for secure payslip operations.' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...baseHeaders, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' }, origin)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const bearer = request.headers.get('authorization')
  if (!url || !anon || !serviceKey) return reply(503, { code: 'SERVICE_CONFIGURATION_MISSING', error: 'The secure payslip service is not fully configured.' }, origin)
  if (!bearer?.startsWith('Bearer ')) return reply(401, { code: 'AUTHENTICATION_REQUIRED', error: 'Sign in again to use secure payslip services.' }, origin)
  const caller = createClient(url, anon, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: identity, error: authError } = await caller.auth.getUser()
  if (authError || !identity.user) return reply(401, { code: 'SESSION_EXPIRED', error: 'Your session is no longer valid. Sign in again.' }, origin)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: Json
  try { body = object(await request.json()) } catch { return reply(400, { error: 'Invalid request.' }, origin) }
  const action = text(body.action)

  let operation = 'request'
  try {
    if (action === 'issue') {
      operation = 'issue'
      const runId = text(body.payrollRunId), employeeId = text(body.employeeId)
      const { data: snapshot, error: snapshotError } = await admin.rpc('payslip_issue_snapshot', {
        p_payroll_run_id: runId, p_employee_id: employeeId, p_actor_id: identity.user.id,
      })
      if (snapshotError) throw snapshotError
      const existing = await caller.from('payslip_documents').select('id').eq('payroll_run_id', runId).eq('employee_id', employeeId).maybeSingle()
      if (existing.error) throw existing.error
      let documentId = existing.data?.id as string | undefined
      if (!documentId) {
        const source = object(snapshot)
        const bytes = await buildPayslipPdf(source)
        const hash = await sha256(bytes)
        const path = `${source.portfolio_id}/${source.company_id}/${runId}/${source.payroll_version}/${employeeId}.pdf`
        const { error: uploadError } = await admin.storage.from('gb-payslips').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
        if (uploadError) {
          // Concurrent issuance or a retry must never overwrite an immutable file.
          // Accept an existing object only when its bytes match this exact source snapshot.
          const { data: existing, error: existingError } = await admin.storage.from('gb-payslips').download(path)
          if (existingError || !existing || await sha256(new Uint8Array(await existing.arrayBuffer())) !== hash) {
            throw new Error('IMMUTABLE_PAYSLIP_ARTIFACT_CONFLICT')
          }
        }
        const { data: registered, error: registerError } = await admin.rpc('payslip_register_document', {
          p_payroll_run_id: runId, p_employee_id: employeeId, p_storage_path: path,
          p_content_sha256: hash, p_actor_id: identity.user.id,
        })
        if (registerError) throw registerError
        documentId = registered as string
      }
      const { data: authorized, error: documentError } = await caller.rpc('payslip_authorized_document', { p_document_id: documentId })
      if (documentError) throw documentError
      const path = text(object(authorized).storage_path)
      const { data: signed, error: signedError } = await admin.storage.from('gb-payslips').createSignedUrl(path, 60, { download: true })
      if (signedError) throw signedError
      return reply(200, { documentId, signedUrl: signed.signedUrl }, origin)
    }
    if (action === 'download') {
      operation = 'download'
      const { data: authorized, error } = await caller.rpc('payslip_authorized_document', { p_document_id: text(body.documentId) })
      if (error) throw error
      const path = text(object(authorized).storage_path)
      const { data: signed, error: signedError } = await admin.storage.from('gb-payslips').createSignedUrl(path, 60, { download: true })
      if (signedError) throw signedError
      return reply(200, { signedUrl: signed.signedUrl }, origin)
    }
    if (action === 'distribution-preview') {
      operation = 'distribution-preview'
      const runId = text(body.payrollRunId)
      const page = Math.max(1, Math.trunc(num(body.page) || 1))
      const pageSize = Math.min(200, Math.max(1, Math.trunc(num(body.pageSize) || 100)))
      const { data, error } = await caller.rpc('payslip_distribution_preview', {
        p_payroll_run_id: runId, p_page: page, p_page_size: pageSize,
      })
      if (error) throw error
      return reply(200, { items: data ?? [], total: Number(object(Array.isArray(data) ? data[0] : null).total_count ?? 0) }, origin)
    }
    if (action === 'revoke-access') {
      operation = 'revoke-access'
      const { error } = await caller.rpc('payslip_email_revoke_access', { p_delivery_id: text(body.deliveryId) })
      if (error) throw error
      return reply(200, { revoked: true }, origin)
    }
    if (action === 'event-history') {
      operation = 'event-history'
      const { data, error } = await caller.rpc('payslip_email_event_history', { p_document_id: text(body.documentId) })
      if (error) throw error
      return reply(200, { events: data ?? [] }, origin)
    }
    if (action === 'email' || action === 'retry-email') {
      operation = 'email'
      const idResult = action === 'email'
        ? await caller.rpc('payslip_email_enqueue', { p_document_id: text(body.documentId) })
        : await caller.rpc('payslip_email_retry', { p_delivery_id: text(body.deliveryId) })
      if (idResult.error) throw idResult.error
      const deliveryId = idResult.data as string
      const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('PAYSLIP_FROM_EMAIL')
      const accessSecret = Deno.env.get('PAYSLIP_ACCESS_TOKEN_SECRET')
      const publicAppUrl = Deno.env.get('PAYSLIP_PUBLIC_APP_URL')
      const senderVerified = Deno.env.get('PAYSLIP_SENDER_DOMAIN_VERIFIED') === 'true'
      const liveDeliveryEnabled = isLivePayslipDeliveryEnabled({
        deliveryEnabled: Deno.env.get('PAYSLIP_LIVE_DELIVERY_ENABLED'),
        firstLiveSendApproved: Deno.env.get('PAYSLIP_FIRST_LIVE_SEND_APPROVED'),
      })
      let accessPageUrl: URL | null = null
      try {
        if (publicAppUrl) {
          const configuredUrl = new URL(publicAppUrl)
          if (configuredUrl.protocol === 'https:' && origins.includes(configuredUrl.origin)) {
            accessPageUrl = new URL('/payslip-access', configuredUrl.origin)
          }
        }
      } catch { /* Invalid public URL leaves the queue disabled. */ }
      const exactSender = 'Golden Baobab HR <payslips@luskamtravelagents.com>'
      const deliveryConfigured = Boolean(key && from?.trim() === exactSender && senderVerified && accessSecret && accessSecret.length >= 32 && accessPageUrl)
      if (!liveDeliveryEnabled || !deliveryConfigured) {
        return reply(202, { deliveryId, status: 'QUEUED', deliveryConfigured: false, liveDeliveryEnabled: false,
          message: 'Delivery is queued. Live sending remains disabled until the sender domain is verified and an authorized administrator enables it.' }, origin)
      }
      const { data: claimed, error: claimError } = await admin.rpc('payslip_email_claim', { p_delivery_id: deliveryId, p_actor_id: identity.user.id })
      if (claimError) throw claimError
      const job = object(claimed)
      if (!job.id) {
        const { data: state } = await admin.from('payslip_email_deliveries').select('status').eq('id', deliveryId).maybeSingle()
        return reply(200, { deliveryId, status: state?.status ?? 'UNKNOWN', deliveryConfigured: true }, origin)
      }
      const recipient = text(job.recipient_email).toLowerCase()
      try {
        const access = await createPayslipAccessToken(accessSecret!)
        const { error: tokenError } = await admin.rpc('payslip_email_prepare_access', {
          p_delivery_id: deliveryId, p_token_hash: access.tokenHash, p_actor_id: identity.user.id,
        })
        if (tokenError) throw new Error('PRIVATE_ACCESS_LINK_FAILED')
        const accessUrl = new URL(accessPageUrl!.toString())
        accessUrl.hash = `token=${encodeURIComponent(access.token)}`
        const safeUrl = escapeHtml(accessUrl.toString())
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `gb-payslip-${deliveryId}` },
          body: JSON.stringify({ from, to: [recipient], subject: 'Your finalized payslip',
            tags: [{ name: 'product', value: 'golden-baobab-payslip' }],
            html: `<p>Your finalized payslip is ready.</p><p><a href="${safeUrl}">Verify your identity and open your private payslip</a></p><p>This link expires in 48 hours. You will need your employee number and date of birth to open it. Do not forward it.</p><p>Golden Baobab HR</p>`,
            text: `Your finalized payslip is ready. Verify your identity and open it here: ${accessUrl.toString()}\nThis link expires in 48 hours. You will need your employee number and date of birth. Do not forward it.\nGolden Baobab HR` }),
        })
        if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`)
        const result = object(await response.json())
        const { data: markedSent, error: updateError } = await admin.rpc('payslip_email_mark_sent', {
          p_delivery_id: deliveryId, p_provider_message_id: text(result.id), p_actor_id: identity.user.id,
        })
        if (updateError || markedSent !== true) throw new Error('DELIVERY_STATE_UPDATE_FAILED')
        return reply(200, { deliveryId, status: 'SENT', deliveryConfigured: true }, origin)
      } catch (error) {
        const code = error instanceof Error ? error.message : 'DELIVERY_FAILED'
        await admin.rpc('payslip_email_mark_failed', {
          p_delivery_id: deliveryId, p_safe_error_code: code, p_actor_id: identity.user.id,
        })
        return reply(502, { deliveryId, status: 'FAILED', error: 'Payslip delivery failed. Review delivery history before retrying.' }, origin)
      }
    }
    return reply(400, { error: 'Unsupported payslip action.' }, origin)
  } catch (error) {
    // Return only a fixed allow-listed error code; database/provider detail and
    // employee/payroll data remain in the trusted logs and never reach clients.
    const code = safeFailureCode(error)
    console.error(`Payslip ${operation} failed (${code})`)
    const userMessage = code === 'ISSUANCE_NOT_AUTHORIZED'
      ? 'Your account does not have payslip issuance access for this company and branch.'
      : code === 'FINALIZED_PAYROLL_NOT_FOUND'
        ? 'This payroll run has no finalized payslip for the selected employee.'
        : code === 'IMMUTABLE_DOCUMENT_CONFLICT'
          ? 'A payslip already exists for this finalized payroll version and could not be replaced.'
          : 'The secure payslip operation could not be completed. Check the service configuration or contact an administrator.'
    return reply(code === 'ISSUANCE_NOT_AUTHORIZED' ? 403 : 400, { code, error: userMessage }, origin)
  }
})
