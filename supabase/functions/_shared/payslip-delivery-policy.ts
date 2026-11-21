export function isLivePayslipDeliveryEnabled(input: {
  deliveryEnabled: string | undefined
  firstLiveSendApproved: string | undefined
}): boolean {
  return input.deliveryEnabled === 'true' && input.firstLiveSendApproved === 'true'
}
