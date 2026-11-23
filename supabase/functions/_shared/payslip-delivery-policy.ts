export function isLivePayslipDeliveryEnabled(input: {
  deliveryEnabled: string | undefined
  firstLiveSendApproved: string | undefined
}): boolean {
  return input.deliveryEnabled === 'true' && input.firstLiveSendApproved === 'true'
}

export type PayslipDeliveryBlockReason =
  | 'PROVIDER_CONFIGURATION_INCOMPLETE'
  | 'LIVE_DELIVERY_DISABLED'
  | 'FIRST_LIVE_SEND_APPROVAL_REQUIRED'

export function payslipDeliveryBlockReason(input: {
  providerConfigured: boolean
  deliveryEnabled: string | undefined
  firstLiveSendApproved: string | undefined
}): PayslipDeliveryBlockReason | null {
  if (!input.providerConfigured) return 'PROVIDER_CONFIGURATION_INCOMPLETE'
  if (input.deliveryEnabled !== 'true') return 'LIVE_DELIVERY_DISABLED'
  if (input.firstLiveSendApproved !== 'true') return 'FIRST_LIVE_SEND_APPROVAL_REQUIRED'
  return null
}
