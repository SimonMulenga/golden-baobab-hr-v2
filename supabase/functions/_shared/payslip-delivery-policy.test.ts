import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isLivePayslipDeliveryEnabled, payslipDeliveryBlockReason } from './payslip-delivery-policy.ts'

Deno.test('live payslip sending remains disabled unless both switches are explicitly true', () => {
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: undefined, firstLiveSendApproved: undefined }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'true', firstLiveSendApproved: undefined }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: undefined, firstLiveSendApproved: 'true' }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'false', firstLiveSendApproved: 'true' }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'true', firstLiveSendApproved: 'true' }), true)
})

Deno.test('delivery block reporting distinguishes setup, live switch and first-send approval', () => {
  assertEquals(payslipDeliveryBlockReason({ providerConfigured: false, deliveryEnabled: 'true', firstLiveSendApproved: 'true' }), 'PROVIDER_CONFIGURATION_INCOMPLETE')
  assertEquals(payslipDeliveryBlockReason({ providerConfigured: true, deliveryEnabled: 'false', firstLiveSendApproved: 'true' }), 'LIVE_DELIVERY_DISABLED')
  assertEquals(payslipDeliveryBlockReason({ providerConfigured: true, deliveryEnabled: 'true', firstLiveSendApproved: 'false' }), 'FIRST_LIVE_SEND_APPROVAL_REQUIRED')
  assertEquals(payslipDeliveryBlockReason({ providerConfigured: true, deliveryEnabled: 'true', firstLiveSendApproved: 'true' }), null)
})
