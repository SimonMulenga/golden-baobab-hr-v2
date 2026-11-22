import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hasDiagnosticPurposeTag, supportedResendEvents } from './policy.ts'

Deno.test('only the fixed diagnostic purpose tag selects diagnostic status handling', () => {
  assert(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'infrastructure-diagnostic' }]))
  assertEquals(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'other' }]), false)
  assertEquals(hasDiagnosticPurposeTag('infrastructure-diagnostic'), false)
  assertEquals(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'infrastructure-diagnostic', extra: 'ignored' }]), true)
})

Deno.test('webhook event allowlist matches supported Resend delivery events', () => {
  assertEquals([...supportedResendEvents].sort(), [
    'email.bounced', 'email.delivered', 'email.delivery_delayed', 'email.failed', 'email.sent',
  ])
})
