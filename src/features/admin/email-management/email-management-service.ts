import { getSupabaseClient } from '../../../lib/supabase/client'

export type DiagnosticState = 'NOT_SENT' | 'ACCEPTED' | 'DELIVERED' | 'DELAYED' | 'FAILED' | 'UNKNOWN'
export type DiagnosticEventType = 'email.sent' | 'email.delivered' | 'email.bounced' | 'email.failed' | 'email.delivery_delayed'

export interface EmailManagementStatus {
  authorized: true
  configuration: {
    resendApiKeyConfigured: boolean
    resendWebhookSecretConfigured: boolean
    senderConfigured: boolean
    sender: string
    senderAddressValid: boolean
    senderDomainVerified: boolean
    livePayslipDeliveryEnabled: boolean
    firstLiveSendApproved: boolean
    diagnosticRecipient: 'simonmulenga155@gmail.com'
    diagnosticRecipientConfigured: boolean
    diagnosticConfigurationReady: boolean
  }
  diagnostic: {
    status: DiagnosticState
    attemptConsumed: boolean
    attemptAvailable: boolean
    claimedAt: string | null
    resultRecordedAt: string | null
    lastEventAt: string | null
    eventHistoryAvailable: boolean
    events: Array<{ eventType: DiagnosticEventType; occurredAt: string }>
    errorCode: 'PROVIDER_REJECTED' | 'OUTCOME_UNKNOWN' | 'STATUS_PERSISTENCE_FAILED' | null
  }
  deliveryHistoryAvailable: boolean
  deliveryHistory: Array<{ status: 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED'; updatedAt: string }>
}

export async function loadEmailManagementStatus(): Promise<EmailManagementStatus> {
  const { data, error } = await getSupabaseClient().functions.invoke('payslip-email-admin-status', { method: 'GET' })
  if (error || !data || data.authorized !== true) throw new Error('Email management is unavailable to this account.')
  return data as EmailManagementStatus
}

export async function invokeResendDiagnostic(): Promise<{ accepted: true; diagnosticId: string | null; statusPersisted: boolean }> {
  const { data, error } = await getSupabaseClient().functions.invoke('payslip-resend-diagnostic', { body: {} })
  if (error) throw new Error('The diagnostic result could not be confirmed. Do not retry; refresh the status first.')
  if (data?.accepted !== true || data?.result !== 'ACCEPTED') {
    throw new Error('The provider did not confirm acceptance. The attempt may be consumed; do not retry.')
  }
  return {
    accepted: true,
    diagnosticId: typeof data.diagnosticId === 'string' ? data.diagnosticId : null,
    statusPersisted: data.statusPersisted === true,
  }
}
