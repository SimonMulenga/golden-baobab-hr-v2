import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

const baseHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' }
const reply = (status: number, body: Record<string, unknown>, origin?: string) => new Response(JSON.stringify(body), {
  status, headers: { ...baseHeaders, ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) },
})
type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0 }
const text = (value: unknown) => typeof value === 'string' ? value : ''
const money = (value: unknown) => `K${num(value).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const safeText = (value: unknown) => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?')

function buildPdf(snapshot: Json): Promise<Uint8Array> {
  return (async () => {
    const pdf = await PDFDocument.create()
    const regular = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const finalized = new Date(text(snapshot.finalized_at))
    if (Number.isFinite(finalized.getTime())) pdf.setCreationDate(finalized)
    pdf.setTitle('Employee payslip')
    pdf.setSubject('Finalized payroll record')
    pdf.setProducer('Golden Baobab HR')
    let page = pdf.addPage([595.28, 841.89])
    const { width, height } = page.getSize()
    let y = height - 48
    const write = (value: unknown, x = 44, size = 10, font = regular, color = rgb(0.13, 0.17, 0.2)) => {
      const content = safeText(value).slice(0, 110)
      page.drawText(content, { x, y, size, font, color })
    }
    const line = () => { page.drawLine({ start: { x: 44, y: y - 8 }, end: { x: width - 44, y: y - 8 }, thickness: 0.7, color: rgb(0.84, 0.87, 0.88) }); y -= 20 }
    const row = (label: string, value: unknown) => { write(label, 48); write(money(value), width - 135, 10, bold); y -= 18 }
    const company = object(snapshot.company), employee = object(snapshot.employee), item = object(snapshot.payroll_item)
    const statutory = object(item.statutory_deductions)
    const breakdown = object(item.calculation_breakdown)
    const additional = Array.isArray(breakdown.approved_earning_items) ? breakdown.approved_earning_items.map(object) : []
    const installments = Array.isArray(breakdown.due_deduction_items) ? breakdown.due_deduction_items.map(object) : []
    const periodStart = new Date(`${text(snapshot.period_start)}T00:00:00Z`)
    const periodName = Number.isFinite(periodStart.getTime()) ? periodStart.toLocaleDateString('en-ZM', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Payroll period'

    page.drawRectangle({ x: 0, y: height - 118, width, height: 118, color: rgb(0.04, 0.24, 0.2) })
    page.drawText('GB', { x: 44, y: height - 65, size: 24, font: bold, color: rgb(1, 1, 1) })
    page.drawText(safeText(company.name || 'Company').slice(0, 60), { x: 96, y: height - 56, size: 17, font: bold, color: rgb(1, 1, 1) })
    page.drawText('Golden Baobab HR  |  PAYSLIP', { x: 96, y: height - 80, size: 9, font: regular, color: rgb(0.84, 0.92, 0.89) })
    page.drawText(safeText([company.address, company.town, company.province].filter(Boolean).join(', ')).slice(0, 80), { x: 44, y: height - 103, size: 8, font: regular, color: rgb(0.9, 0.94, 0.92) })
    y = height - 153
    write(`${periodName} salary statement`, 44, 18, bold); y -= 28
    write(`Reference: GBHR-${text(snapshot.payroll_run_id).slice(0, 8).toUpperCase()}-${text(employee.employee_number)}`, 44, 9); y -= 24
    write(`Employee: ${[employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' ')}`, 44, 11, bold); y -= 18
    write(`Number: ${employee.employee_number}     Role: ${employee.job_title}     Department: ${employee.department}`, 44, 9); y -= 16
    write(`Branch: ${object(snapshot.branch).name}`, 44, 9); y -= 24
    write('EARNINGS', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
    row('Basic salary', item.basic_pay)
    row('Housing allowance', item.housing_allowance)
    row('Meal allowance', item.meal_allowance)
    row('Transport allowance', item.transport_allowance)
    row('Other allowances', item.other_allowances)
    if (num(item.attendance_deduction)) {
      write('Unpaid leave adjustment (already reflected in gross)', 48)
      write(`(${money(item.attendance_deduction)})`, width - 135, 10, bold)
      y -= 18
    }
    if (num(item.overtime)) row('Approved overtime', item.overtime)
    if (num(item.bonuses_and_other_earnings) && !additional.length) row('Bonuses and other earnings', item.bonuses_and_other_earnings)
    for (const earning of additional) row(text(earning.earning_type).replaceAll('_', ' '), earning.amount)
    row('Gross earnings', item.gross_pay); line()
    write('DEDUCTIONS', 44, 10, bold, rgb(0.04, 0.35, 0.28)); y -= 22
    row('PAYE', statutory.PAYE)
    row('NAPSA employee', statutory.NAPSA_EMPLOYEE)
    row('NHIMA employee', statutory.NHIMA_EMPLOYEE)
    for (const deduction of installments) row(text(deduction.deduction_type).replaceAll('_', ' '), deduction.scheduled_amount)
    const known = installments.reduce((sum, deduction) => sum + Math.round(num(deduction.scheduled_amount) * 100), 0) / 100
    const other = Math.max(0, num(item.voluntary_deductions) - known)
    if (other > 0) row('Other approved deductions', other)
    const statutoryTotal = num(statutory.PAYE) + num(statutory.NAPSA_EMPLOYEE) + num(statutory.NHIMA_EMPLOYEE)
    row('Total deductions', statutoryTotal + num(item.voluntary_deductions)); line()
    page.drawRectangle({ x: 44, y: y - 38, width: width - 88, height: 46, color: rgb(0.91, 0.96, 0.94) })
    page.drawText('NET SALARY', { x: 54, y: y - 19, size: 11, font: bold, color: rgb(0.04, 0.24, 0.2) })
    page.drawText(money(item.net_pay), { x: width - 150, y: y - 20, size: 14, font: bold, color: rgb(0.04, 0.24, 0.2) })
    page.drawText(`Finalized payroll version ${snapshot.payroll_version}. This statement is not proof of bank payment.`, { x: 44, y: 42, size: 8, font: regular, color: rgb(0.38, 0.42, 0.44) })
    return await pdf.save({ useObjectStreams: true })
  })()
}

const b64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary) }
async function sha256(bytes: Uint8Array) {
  const digestInput = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(digestInput).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  const origins = (Deno.env.get('APPROVED_APP_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!origin || !origins.includes(origin)) return reply(403, { error: 'This application origin is not approved.' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...baseHeaders, 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' }, origin)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const bearer = request.headers.get('authorization')
  if (!url || !anon || !serviceKey || !bearer?.startsWith('Bearer ')) return reply(401, { error: 'Authenticated payslip service is unavailable.' }, origin)
  const caller = createClient(url, anon, { global: { headers: { Authorization: bearer } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: identity, error: authError } = await caller.auth.getUser()
  if (authError || !identity.user) return reply(401, { error: 'Your session is no longer valid.' }, origin)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let body: Json
  try { body = object(await request.json()) } catch { return reply(400, { error: 'Invalid request.' }, origin) }
  const action = text(body.action)

  try {
    if (action === 'issue') {
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
        const bytes = await buildPdf(source)
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
      const { data: authorized, error } = await caller.rpc('payslip_authorized_document', { p_document_id: text(body.documentId) })
      if (error) throw error
      const path = text(object(authorized).storage_path)
      const { data: signed, error: signedError } = await admin.storage.from('gb-payslips').createSignedUrl(path, 60, { download: true })
      if (signedError) throw signedError
      return reply(200, { signedUrl: signed.signedUrl }, origin)
    }
    if (action === 'email' || action === 'retry-email') {
      const idResult = action === 'email'
        ? await caller.rpc('payslip_email_enqueue', { p_document_id: text(body.documentId) })
        : await caller.rpc('payslip_email_retry', { p_delivery_id: text(body.deliveryId) })
      if (idResult.error) throw idResult.error
      const deliveryId = idResult.data as string
      const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('PAYSLIP_FROM_EMAIL')
      const allowlist = (Deno.env.get('PAYSLIP_EMAIL_ALLOWED_RECIPIENTS') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
      if (!key || !from || !allowlist.length) return reply(202, { deliveryId, status: 'QUEUED', deliveryConfigured: false, message: 'Delivery is queued. Configure the server email provider and recipient allowlist to send.' }, origin)
      const { data: claimed, error: claimError } = await admin.rpc('payslip_email_claim', { p_delivery_id: deliveryId, p_actor_id: identity.user.id })
      if (claimError) throw claimError
      const job = object(claimed)
      if (!job.id) {
        const { data: state } = await admin.from('payslip_email_deliveries').select('status').eq('id', deliveryId).maybeSingle()
        return reply(200, { deliveryId, status: state?.status ?? 'UNKNOWN', deliveryConfigured: true }, origin)
      }
      const recipient = text(job.recipient_email).toLowerCase()
      if (!allowlist.includes(recipient)) {
        await admin.from('payslip_email_deliveries').update({ status: 'FAILED', last_error_code: 'RECIPIENT_NOT_ALLOWLISTED', updated_at: new Date().toISOString() }).eq('id', deliveryId)
        return reply(403, { deliveryId, status: 'FAILED', error: 'This recipient is not in the configured delivery allowlist.' }, origin)
      }
      try {
        const { data: file, error: fileError } = await admin.storage.from('gb-payslips').download(text(job.storage_path))
        if (fileError || !file) throw new Error('PDF_DOWNLOAD_FAILED')
        const attachment = b64(new Uint8Array(await file.arrayBuffer()))
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `gb-payslip-${deliveryId}` },
          body: JSON.stringify({ from, to: [recipient], subject: 'Your finalized payslip', html: '<p>Your finalized payslip is attached as a secure PDF.</p><p>Golden Baobab HR</p>', attachments: [{ filename: 'payslip.pdf', content: attachment }] }),
        })
        if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`)
        const result = object(await response.json())
        await admin.from('payslip_email_deliveries').update({ status: 'SENT', provider_message_id: text(result.id) || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error_code: null }).eq('id', deliveryId).eq('status', 'SENDING')
        return reply(200, { deliveryId, status: 'SENT', deliveryConfigured: true }, origin)
      } catch (error) {
        const code = error instanceof Error ? error.message : 'DELIVERY_FAILED'
        await admin.from('payslip_email_deliveries').update({ status: 'FAILED', last_error_code: code.slice(0, 80), updated_at: new Date().toISOString() }).eq('id', deliveryId).eq('status', 'SENDING')
        return reply(502, { deliveryId, status: 'FAILED', error: 'Payslip delivery failed. Review delivery history before retrying.' }, origin)
      }
    }
    return reply(400, { error: 'Unsupported payslip action.' }, origin)
  } catch {
    // Do not return provider details, database payloads, or private records.
    console.error('Payslip operation failed')
    return reply(400, { error: 'The payslip operation could not be completed under the current access and record state.' }, origin)
  }
})
