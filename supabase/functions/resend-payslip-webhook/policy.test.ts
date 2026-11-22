import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hasDiagnosticPurposeTag, hasPayslipProductTag, supportedResendEvents } from './policy.ts'

Deno.test('only the fixed diagnostic purpose tag selects diagnostic status handling', () => {
  assert(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'infrastructure-diagnostic' }]))
  assertEquals(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'other' }]), false)
  assertEquals(hasDiagnosticPurposeTag('infrastructure-diagnostic'), false)
  assertEquals(hasDiagnosticPurposeTag([{ name: 'purpose', value: 'infrastructure-diagnostic', extra: 'ignored' }]), true)
  assertEquals(hasDiagnosticPurposeTag({ purpose: 'infrastructure-diagnostic' }), true)
  assertEquals(hasDiagnosticPurposeTag({ purpose: 'other' }), false)
})

Deno.test('payslip product tag accepts both Resend API and webhook tag shapes', () => {
  assertEquals(hasPayslipProductTag([{ name: 'product', value: 'golden-baobab-payslip' }]), true)
  assertEquals(hasPayslipProductTag({ product: 'golden-baobab-payslip' }), true)
  assertEquals(hasPayslipProductTag({ product: 'other' }), false)
  assertEquals(hasPayslipProductTag(null), false)
})

Deno.test('webhook event allowlist matches supported Resend delivery events', () => {
  assertEquals([...supportedResendEvents].sort(), [
    'email.bounced', 'email.delivered', 'email.delivery_delayed', 'email.failed', 'email.sent',
  ])
})
