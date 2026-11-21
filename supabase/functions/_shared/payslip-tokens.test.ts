import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { createPayslipAccessToken, payslipAccessTokenHash, safeEqual, verifyResendWebhookSignature } from './payslip-tokens.ts'

const encoder = new TextEncoder()
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

Deno.test('payslip access token is high entropy and only its keyed hash is stored', async () => {
  const first = await createPayslipAccessToken('x'.repeat(48))
  const second = await createPayslipAccessToken('x'.repeat(48))
  assert(first.token.length >= 40)
  assertEquals(first.tokenHash, await payslipAccessTokenHash('x'.repeat(48), first.token))
  assert(first.tokenHash !== first.token)
  assert(first.tokenHash !== second.tokenHash)
})

Deno.test('Resend webhook verifier validates raw signed body and rejects tampering and stale requests', async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(32))
  const secret = `whsec_${base64(secretBytes)}`
  const eventId = 'evt_test_01'
  const timestamp = '1795000000'
  const rawBody = '{"type":"email.delivered","data":{"email_id":"re_test_1"}}'
  const secretKeyBytes = new ArrayBuffer(secretBytes.byteLength)
  new Uint8Array(secretKeyBytes).set(secretBytes)
  const key = await crypto.subtle.importKey('raw', secretKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${eventId}.${timestamp}.${rawBody}`))))
  const base = { secret, eventId, timestamp, signature: `v1,${signature}`, rawBody, nowSeconds: Number(timestamp) }
  assert(await verifyResendWebhookSignature(base))
  assertEquals(await verifyResendWebhookSignature({ ...base, rawBody: `${rawBody} ` }), false)
  assertEquals(await verifyResendWebhookSignature({ ...base, nowSeconds: Number(timestamp) + 301 }), false)
  assertEquals(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true)
})
