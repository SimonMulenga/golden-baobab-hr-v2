import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { approvedAppOrigins } from '../payslip-artifacts/origins.ts'
import { payslipAccessTokenHash } from '../_shared/payslip-tokens.ts'
import { isValidDateOfBirth } from './policy.ts'
import { encryptPayslipPdf, isBirthYearEncryptedPdf } from '../payslip-artifacts/encryption.ts'

const noStore = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const json = (status: number, body: Record<string, unknown>, origin?: string) => new Response(JSON.stringify(body), {
  status, headers: { ...noStore, 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) },
})
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
async function sha256(bytes: Uint8Array) {
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

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
  const dateOfBirth = body.dateOfBirth
  const verificationFailure = 'We could not verify your details. Please check your date of birth or contact HR.'
  if (!/^[A-Za-z0-9_-]{40,50}$/u.test(token) || !isValidDateOfBirth(dateOfBirth)) {
    return json(403, { error: verificationFailure }, origin)
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const tokenHash = await payslipAccessTokenHash(tokenSecret, token)
    const { data, error } = await admin.rpc('payslip_email_access_redeem', {
      p_token_hash: tokenHash, p_date_of_birth: dateOfBirth,
    })
    if (error) return json(403, { error: verificationFailure }, origin)
    const row = Array.isArray(data) ? obj(data[0]) : obj(data)
    let path = typeof row.storage_path === 'string' ? row.storage_path : ''
    let expectedHash = typeof row.content_sha256 === 'string' ? row.content_sha256 : ''
    let encryptionVersion = Number(row.encryption_version ?? 0)
    const birthYear = typeof row.birth_year === 'string' ? row.birth_year : ''
    if (!path || !/^[a-f0-9]{64}$/u.test(expectedHash)) return json(403, { error: verificationFailure }, origin)
    if (!/^\d{4}$/u.test(birthYear)) return json(403, { error: verificationFailure }, origin)
    const { data: pdf, error: downloadError } = await admin.storage.from('gb-payslips').download(path)
    if (downloadError || !pdf) return json(404, { error: 'The payslip could not be retrieved.' }, origin)
    let bytes = new Uint8Array(await pdf.arrayBuffer())
    if (await sha256(bytes) !== expectedHash) return json(409, { error: 'The payslip document could not be verified.' }, origin)
    if (encryptionVersion === 0) {
      const encrypted = await encryptPayslipPdf(bytes, birthYear)
      if (!await isBirthYearEncryptedPdf(encrypted, birthYear)) return json(500, { error: 'The payslip could not be secured. Please contact HR.' }, origin)
      const encryptedHash = await sha256(encrypted)
      const newPath = `${path.replace(/\.pdf$/u, '')}.enc-${crypto.randomUUID()}.pdf`
      const { error: uploadError } = await admin.storage.from('gb-payslips').upload(newPath, encrypted, {
        contentType: 'application/pdf', upsert: false,
      })
      if (uploadError) return json(503, { error: 'The payslip could not be secured. Please try again.' }, origin)
      const { data: swapped, error: swapError } = await admin.rpc('payslip_email_access_replace_encrypted_artifact', {
        p_token_hash: tokenHash, p_old_storage_path: path, p_old_content_sha256: expectedHash,
        p_new_storage_path: newPath, p_new_content_sha256: encryptedHash,
      })
      if (swapError) {
        await admin.storage.from('gb-payslips').remove([newPath])
        return json(403, { error: verificationFailure }, origin)
      }
      const current = Array.isArray(swapped) ? obj(swapped[0]) : obj(swapped)
      if (current.storage_path !== newPath) await admin.storage.from('gb-payslips').remove([newPath])
      path = typeof current.storage_path === 'string' ? current.storage_path : ''
      expectedHash = typeof current.content_sha256 === 'string' ? current.content_sha256 : ''
      encryptionVersion = Number(current.encryption_version ?? 0)
      if (!path || !/^[a-f0-9]{64}$/u.test(expectedHash) || encryptionVersion !== 1) {
        return json(500, { error: 'The payslip could not be secured. Please contact HR.' }, origin)
      }
      const { data: replacement, error: replacementError } = await admin.storage.from('gb-payslips').download(path)
      if (replacementError || !replacement) return json(503, { error: 'The payslip could not be retrieved. Please try again.' }, origin)
      bytes = new Uint8Array(await replacement.arrayBuffer())
    }
    if (encryptionVersion !== 1 || await sha256(bytes) !== expectedHash || !await isBirthYearEncryptedPdf(bytes, birthYear)) {
      return json(409, { error: 'The payslip document could not be verified.' }, origin)
    }
    return new Response(bytes, { status: 200, headers: {
      ...noStore, 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Golden-Baobab-Payslip.pdf"',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    } })
  } catch {
    return json(403, { error: verificationFailure }, origin)
  }
})
