import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isLivePayslipDeliveryEnabled } from './payslip-delivery-policy.ts'

Deno.test('live payslip sending remains disabled unless both switches are explicitly true', () => {
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: undefined, firstLiveSendApproved: undefined }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'true', firstLiveSendApproved: undefined }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: undefined, firstLiveSendApproved: 'true' }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'false', firstLiveSendApproved: 'true' }), false)
  assertEquals(isLivePayslipDeliveryEnabled({ deliveryEnabled: 'true', firstLiveSendApproved: 'true' }), true)
})
