import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock3, Mail, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { invokeResendDiagnostic, loadEmailManagementStatus, type DiagnosticState, type EmailManagementStatus } from './email-management-service'
import './email-management.css'

const statusLabel: Record<DiagnosticState, string> = {
  NOT_SENT: 'Not sent',
  ACCEPTED: 'Accepted',
  DELIVERED: 'Delivered',
  DELAYED: 'Delayed',
  FAILED: 'Failed',
  UNKNOWN: 'Unknown',
}

const statusDescription: Record<DiagnosticState, string> = {
  NOT_SENT: 'No diagnostic attempt has been recorded.',
  ACCEPTED: 'Resend accepted the message. Recipient delivery is not yet confirmed.',
  DELIVERED: 'A signed Resend webhook event confirms delivery.',
  DELAYED: 'Resend reported a delivery delay. Delivery is not confirmed.',
  FAILED: 'Resend reported a failure or rejected the message.',
  UNKNOWN: 'The one-time attempt may have been consumed, but its outcome is not confirmed.',
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case 'email.sent': return 'Accepted by Resend'
    case 'email.delivered': return 'Delivered (signed webhook)'
    case 'email.delivery_delayed': return 'Delivery delayed (signed webhook)'
    case 'email.bounced': return 'Bounced (signed webhook)'
    case 'email.failed': return 'Failed (signed webhook)'
    default: return 'Provider event'
  }
}

export function LiveEmailManagement() {
  const [status, setStatus] = useState<EmailManagementStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attemptedThisView, setAttemptedThisView] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await loadEmailManagementStatus()
      setStatus(next)
    } catch {
      setStatus(null)
      setError('Email management status is unavailable under this account. Confirm platform administrator access and refresh.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const sendDiagnostic = async () => {
    setConfirmationOpen(false)
    setBusy(true)
    setAttemptedThisView(true)
    setError('')
    setNotice('')
    try {
      const result = await invokeResendDiagnostic()
      setNotice(result.statusPersisted
        ? 'Resend accepted the diagnostic. This confirms provider acceptance only; wait for a signed delivery event.'
        : 'Resend accepted the diagnostic, but its status could not be saved. Do not retry; check the provider and contact support.')
      if (!result.statusPersisted) {
        setStatus((current) => current ? { ...current, diagnostic: { ...current.diagnostic, status: 'UNKNOWN', attemptAvailable: false, attemptConsumed: true } } : current)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The diagnostic outcome is uncertain. Do not retry.')
    } finally {
      setBusy(false)
      await refresh(true)
    }
  }

  const configuration = status?.configuration
  const diagnostic = status?.diagnostic
  const liveGatesDisabled = configuration && !configuration.livePayslipDeliveryEnabled && !configuration.firstLiveSendApproved
  const buttonDisabled = loading || refreshing || busy || attemptedThisView || !diagnostic?.attemptAvailable || !liveGatesDisabled

  return <div className="live-email-management">
    <header className="admin-page-heading">
      <div><div className="eyebrow"><span className="eyebrow-line"/>ADMINISTRATION</div><h1>Email management</h1><p>Review Resend configuration and the one-time infrastructure diagnostic.</p></div>
      <button className="button-secondary" type="button" disabled={loading || refreshing || busy} onClick={() => void refresh(true)}><RefreshCw size={15}/> Refresh status</button>
    </header>

    <div className="admin-notice"><ShieldCheck size={15}/><span>Owner-only controls. The diagnostic sends one fixed plain-text message to the approved owner recipient. It does not use employee, payroll or payslip data.</span></div>
    {error && <p className="live-error" role="alert">{error}</p>}
    {notice && <p className="live-notice" role="status">{notice}</p>}
    {loading ? <section className="panel email-management-loading" role="status">Loading secure email status…</section> : status && configuration && diagnostic ? <>
      <section className="panel email-management-panel" aria-label="Resend configuration">
        <header><div><div className="section-eyebrow">CONFIGURATION</div><h2>Resend and payslip delivery</h2></div><span className="email-management-owner-badge"><ShieldCheck size={13}/> Platform administrator</span></header>
        <dl className="email-management-grid">
          <div><dt>Resend API key</dt><dd><StatusValue ok={configuration.resendApiKeyConfigured}/></dd></div>
          <div><dt>Webhook signing secret</dt><dd><StatusValue ok={configuration.resendWebhookSecretConfigured}/></dd></div>
          <div><dt>Sender address</dt><dd>{configuration.senderConfigured ? configuration.sender : 'Not configured'}</dd></div>
          <div><dt>Sender address matches verified domain</dt><dd><StatusValue ok={configuration.senderAddressValid}/></dd></div>
          <div><dt>Sender domain verified</dt><dd><StatusValue ok={configuration.senderDomainVerified}/></dd></div>
          <div><dt>Live payslip delivery</dt><dd><StatusValue ok={!configuration.livePayslipDeliveryEnabled} value={configuration.livePayslipDeliveryEnabled ? 'Enabled' : 'Disabled'}/></dd></div>
          <div><dt>First live send approval</dt><dd><StatusValue ok={!configuration.firstLiveSendApproved} value={configuration.firstLiveSendApproved ? 'Approved' : 'Disabled'}/></dd></div>
          <div><dt>Diagnostic recipient</dt><dd>{configuration.diagnosticRecipient}</dd></div>
        </dl>
        <p className="email-management-footnote">Credentials are never returned to the browser. Live payslip delivery and first-send approval are independent of this diagnostic.</p>
      </section>

      <section className="panel email-management-panel" aria-label="One-time Resend diagnostic">
        <header><div><div className="section-eyebrow">INFRASTRUCTURE CHECK</div><h2>One-time diagnostic email</h2></div><span className={`email-management-status email-status-${diagnostic.status.toLowerCase()}`}>{statusLabel[diagnostic.status]}</span></header>
        <div className="email-diagnostic-summary">
          <div className="email-diagnostic-icon"><Mail size={19}/></div>
          <div><strong>{statusLabel[diagnostic.status]}</strong><p>{statusDescription[diagnostic.status]}</p></div>
        </div>
        <dl className="email-management-grid email-diagnostic-details">
          <div><dt>Permitted recipient</dt><dd>{configuration.diagnosticRecipient}</dd></div>
          <div><dt>One-time attempt</dt><dd>{diagnostic.attemptConsumed ? 'Consumed' : 'Available'}</dd></div>
          {diagnostic.claimedAt && <div><dt>Attempt started</dt><dd>{new Date(diagnostic.claimedAt).toLocaleString()}</dd></div>}
          {diagnostic.resultRecordedAt && <div><dt>Provider result recorded</dt><dd>{new Date(diagnostic.resultRecordedAt).toLocaleString()}</dd></div>}
        </dl>
        {diagnostic.errorCode && <p className="email-diagnostic-error-code" role="status">{diagnostic.errorCode === 'PROVIDER_REJECTED' ? 'The provider rejected the diagnostic.' : diagnostic.errorCode === 'OUTCOME_UNKNOWN' ? 'The provider outcome could not be confirmed.' : 'The provider response was received, but status storage needs review.'}</p>}
        {(!configuration.diagnosticConfigurationReady || !configuration.diagnosticRecipientConfigured) && <p className="live-error" role="alert">The server configuration is incomplete or does not match the fixed diagnostic recipient. The send action is unavailable.</p>}
        {!liveGatesDisabled && <p className="live-error" role="alert">The payslip delivery safety gates are not both disabled. The diagnostic action is blocked until a platform administrator confirms the gates.</p>}
        <button className="button-primary email-diagnostic-send" type="button" disabled={buttonDisabled} onClick={() => setConfirmationOpen(true)}><Send size={15}/>{busy ? 'Sending diagnostic…' : diagnostic.attemptConsumed || attemptedThisView ? 'Attempt consumed' : 'Send Test Email'}</button>
        {diagnostic.attemptAvailable && <p className="email-management-footnote">Sending consumes the only permitted attempt. The diagnostic does not enable payslip delivery.</p>}
        <div className="email-diagnostic-history">
          <div className="email-diagnostic-history-heading"><strong>Diagnostic delivery history</strong><span>{diagnostic.eventHistoryAvailable ? `${diagnostic.events.length} event${diagnostic.events.length === 1 ? '' : 's'}` : 'History unavailable'}</span></div>
          {!diagnostic.eventHistoryAvailable ? <p role="status">Signed provider event history could not be loaded.</p> : diagnostic.events.length ? diagnostic.events.map((event, index) => <div className="email-diagnostic-event" key={`${event.eventType}-${event.occurredAt}-${index}`}><span>{eventLabel(event.eventType)}</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></div>) : <p>No signed Resend delivery events have been recorded.</p>}
        </div>
        {diagnostic.status === 'ACCEPTED' && <p className="email-management-footnote"><Clock3 size={13}/> Acceptance is not delivery. This status changes only when the signed Resend webhook records a later event.</p>}
        {diagnostic.status === 'DELIVERED' && <p className="email-management-footnote"><CheckCircle2 size={13}/> Delivery was confirmed by the signed Resend webhook.</p>}
      </section>

      <section className="panel email-management-panel" aria-label="Recent payslip delivery activity">
        <header><div><div className="section-eyebrow">SANITIZED HISTORY</div><h2>Recent payslip email delivery activity</h2></div><span className="email-management-owner-badge">Status and time only</span></header>
        <div className="email-diagnostic-history email-payslip-history">
          {!status.deliveryHistoryAvailable ? <p role="status">Recent delivery history could not be loaded.</p> : status.deliveryHistory.length ? status.deliveryHistory.map((item, index) => <div className="email-diagnostic-event" key={`${item.status}-${item.updatedAt}-${index}`}><span>{item.status}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></div>) : <p>No payslip email delivery activity has been recorded.</p>}
        </div>
        <p className="email-management-footnote">This view excludes employee names, company details, recipient addresses, payslip values and provider identifiers.</p>
      </section>
    </> : null}

    {confirmationOpen && <div className="admin-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmationOpen(false) }}>
      <section className="admin-dialog email-diagnostic-dialog" role="dialog" aria-modal="true" aria-labelledby="email-diagnostic-confirm-title">
        <header><h2 id="email-diagnostic-confirm-title">Confirm one-time diagnostic</h2></header>
        <p>This sends exactly one plain-text diagnostic email to <strong>simonmulenga155@gmail.com</strong>. It contains no employee or payslip information. Confirming consumes the one permitted diagnostic attempt, even if the provider result is uncertain.</p>
        <div className="email-diagnostic-dialog-actions"><button className="button-secondary" type="button" onClick={() => setConfirmationOpen(false)}>Cancel</button><button className="button-primary" type="button" disabled={busy || !diagnostic?.attemptAvailable || !liveGatesDisabled} onClick={() => void sendDiagnostic()}><Send size={14}/> Send one diagnostic</button></div>
      </section>
    </div>}
  </div>
}

function StatusValue({ ok, value }: { ok: boolean; value?: string }) {
  return <span className={`email-config-value ${ok ? 'is-ok' : 'is-bad'}`}>{ok ? <CheckCircle2 size={13}/> : <AlertCircle size={13}/>} {value ?? (ok ? 'Configured' : 'Not configured')}</span>
}
