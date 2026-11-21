const encoder = new TextEncoder()

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export async function createPayslipAccessToken(secret: string): Promise<{ token: string; tokenHash: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const token = base64Url(random)
  return { token, tokenHash: await hmacHex(secret, token) }
}

export async function payslipAccessTokenHash(secret: string, token: string): Promise<string> {
  return await hmacHex(secret, token)
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index]
  return mismatch === 0
}

export async function verifyResendWebhookSignature(input: {
  secret: string
  eventId: string | null
  timestamp: string | null
  signature: string | null
  rawBody: string
  nowSeconds?: number
}): Promise<boolean> {
  const { secret, eventId, timestamp, signature, rawBody } = input
  if (!secret.startsWith('whsec_') || !eventId || !timestamp || !signature || !/^\d{10}$/u.test(timestamp)) return false
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - timestampSeconds) > 300) return false
  let secretBytes: Uint8Array
  try { secretBytes = decodeBase64(secret.slice('whsec_'.length)) } catch { return false }
  const keyBytes = new ArrayBuffer(secretBytes.byteLength)
  new Uint8Array(keyBytes).set(secretBytes)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = `${eventId}.${timestamp}.${rawBody}`
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signed)))
  const candidates = signature.split(' ').flatMap((entry) => {
    const [, value] = entry.split(',', 2)
    if (!entry.startsWith('v1,') || !value) return []
    try { return [decodeBase64(value)] } catch { return [] }
  })
  return candidates.some((candidate) => safeEqual(candidate, expected))
}
