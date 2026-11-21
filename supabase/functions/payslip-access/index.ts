import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { approvedAppOrigins } from '../payslip-artifacts/origins.ts'
import { payslipAccessTokenHash } from '../_shared/payslip-tokens.ts'

const noStore = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (status: number, body: Record<string, unknown>, origin?: string) => new Response(JSON.stringify(body), {
  status, headers: { ...noStore, 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) },
})
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') ?? ''
  const allowed = approvedAppOrigins(Deno.env.get('APPROVED_APP_ORIGINS') ?? '')
  if (!origin || !allowed.includes(origin)) return json(403, { error: 'This payslip access page is not enabled for this application address.' })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: {
    ...noStore, 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, origin)
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const tokenSecret = Deno.env.get('PAYSLIP_ACCESS_TOKEN_SECRET')
  if (!url || !serviceKey || !tokenSecret || tokenSecret.length < 32) return json(503, { error: 'Secure payslip access is not configured.' }, origin)
  let body: Record<string, unknown>
  try { body = obj(await request.json()) } catch { return json(400, { error: 'Enter the employee details shown on your HR records.' }, origin) }
  const token = typeof body.token === 'string' ? body.token : ''
  const employeeNumber = typeof body.employeeNumber === 'string' ? body.employeeNumber.trim().slice(0, 80) : ''
  const dateOfBirth = typeof body.dateOfBirth === 'string' ? body.dateOfBirth : ''
  if (!/^[A-Za-z0-9_-]{40,50}$/u.test(token) || !employeeNumber || !/^\d{4}-\d{2}-\d{2}$/u.test(dateOfBirth)) {
    return json(400, { error: 'The link or verification details could not be verified.' }, origin)
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const tokenHash = await payslipAccessTokenHash(tokenSecret, token)
    const { data, error } = await admin.rpc('payslip_email_access_redeem', {
      p_token_hash: tokenHash, p_employee_number: employeeNumber, p_date_of_birth: dateOfBirth,
    })
    if (error) return json(403, { error: 'The link or verification details could not be verified. Check the details or contact HR.' }, origin)
    const row = Array.isArray(data) ? obj(data[0]) : obj(data)
    const path = typeof row.storage_path === 'string' ? row.storage_path : ''
    const expectedHash = typeof row.content_sha256 === 'string' ? row.content_sha256 : ''
    if (!path || !/^[a-f0-9]{64}$/u.test(expectedHash)) return json(404, { error: 'The payslip could not be retrieved.' }, origin)
    const { data: pdf, error: downloadError } = await admin.storage.from('gb-payslips').download(path)
    if (downloadError || !pdf) return json(404, { error: 'The payslip could not be retrieved.' }, origin)
    const bytes = new Uint8Array(await pdf.arrayBuffer())
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const actualHash = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
    if (actualHash !== expectedHash) return json(409, { error: 'The payslip document could not be verified.' }, origin)
    return new Response(bytes, { status: 200, headers: {
      ...noStore, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Golden-Baobab-Payslip.pdf"',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    } })
  } catch {
    return json(500, { error: 'The payslip could not be retrieved. Try again or contact HR.' }, origin)
  }
})
