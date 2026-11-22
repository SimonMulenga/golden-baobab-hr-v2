import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ load: vi.fn(), send: vi.fn() }))
vi.mock('./email-management-service', () => ({
  loadEmailManagementStatus: mocks.load,
  invokeResendDiagnostic: mocks.send,
}))

import { LiveEmailManagement } from './LiveEmailManagement'

function status(overrides: Record<string, unknown> = {}) {
  return {
    authorized: true as const,
    configuration: {
      resendApiKeyConfigured: true,
      resendWebhookSecretConfigured: true,
      senderConfigured: true,
      sender: 'Golden Baobab HR <payslips@luskamtravelagents.com>',
      senderAddressValid: true,
      senderDomainVerified: true,
      livePayslipDeliveryEnabled: false,
      firstLiveSendApproved: false,
      diagnosticRecipient: 'simonmulenga155@gmail.com' as const,
      diagnosticRecipientConfigured: true,
      diagnosticConfigurationReady: true,
    },
    diagnostic: {
      status: 'NOT_SENT' as const,
      attemptConsumed: false,
      attemptAvailable: true,
      claimedAt: null,
      resultRecordedAt: null,
      lastEventAt: null,
      eventHistoryAvailable: true,
      events: [],
      errorCode: null,
    },
    deliveryHistoryAvailable: true,
    deliveryHistory: [],
    ...overrides,
  }
}

describe('platform-owner Email Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockResolvedValue(status())
    mocks.send.mockResolvedValue({ accepted: true, diagnosticId: 'resend-id', statusPersisted: true })
  })

  it('shows safe configuration and never asks for an arbitrary recipient', async () => {
    render(<LiveEmailManagement />)
    expect(await screen.findByRole('heading', { name: 'Email management' })).toBeTruthy()
    expect(screen.getByText('Golden Baobab HR <payslips@luskamtravelagents.com>')).toBeTruthy()
    expect(screen.getAllByText('simonmulenga155@gmail.com')).toHaveLength(2)
    expect(screen.queryByLabelText(/recipient email/i)).toBeNull()
    expect(screen.getAllByText('Disabled')).toHaveLength(2)
  })

  it('requires confirmation and reports provider acceptance without claiming delivery', async () => {
    mocks.load.mockResolvedValueOnce(status()).mockResolvedValueOnce(status({
      diagnostic: { ...status().diagnostic, status: 'ACCEPTED', attemptConsumed: true, attemptAvailable: false },
    }))
    render(<LiveEmailManagement />)
    await screen.findByText('No diagnostic attempt has been recorded.')
    fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }))
    expect(screen.getByRole('dialog').textContent).toContain('consumes the one permitted diagnostic attempt')
    fireEvent.click(screen.getByRole('button', { name: 'Send one diagnostic' }))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect((await screen.findByRole('status')).textContent).toContain('Resend accepted the diagnostic.')
    expect(screen.getAllByText('Accepted')).toHaveLength(2)
    expect(screen.getByText('Resend accepted the message. Recipient delivery is not yet confirmed.')).toBeTruthy()
    expect(screen.queryByText('A signed Resend webhook event confirms delivery.')).toBeNull()
    expect((screen.getByRole('button', { name: 'Attempt consumed' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks the test action if either live payslip gate is enabled', async () => {
    mocks.load.mockResolvedValue(status({ configuration: { ...status().configuration, livePayslipDeliveryEnabled: true } }))
    render(<LiveEmailManagement />)
    expect((await screen.findByRole('alert')).textContent).toContain('safety gates are not both disabled')
    expect((screen.getByRole('button', { name: 'Send Test Email' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows delivery only when the status endpoint reports a signed delivered event', async () => {
    mocks.load.mockResolvedValue(status({ diagnostic: {
      ...status().diagnostic,
      status: 'DELIVERED', attemptConsumed: true, attemptAvailable: false,
      events: [{ eventType: 'email.delivered', occurredAt: '2026-11-22T10:00:00Z' }],
    } }))
    render(<LiveEmailManagement />)
    expect(await screen.findByText('A signed Resend webhook event confirms delivery.')).toBeTruthy()
    expect(screen.getByText('Delivered (signed webhook)')).toBeTruthy()
    expect(screen.getByText('Attempt consumed')).toBeTruthy()
  })

  it('shows sanitized delivery history without employee or recipient fields', async () => {
    mocks.load.mockResolvedValue(status({ deliveryHistory: [{ status: 'FAILED', updatedAt: '2026-11-22T10:00:00Z' }] }))
    render(<LiveEmailManagement />)
    expect(await screen.findByRole('region', { name: 'Recent payslip delivery activity' })).toBeTruthy()
    expect(screen.getByText('Status and time only')).toBeTruthy()
    expect(screen.getByText('This view excludes employee names, company details, recipient addresses, payslip values and provider identifiers.')).toBeTruthy()
    expect(screen.queryByText(/employee@example|Payroll Run/)).toBeNull()
  })

  it('does not display internal errors returned by the status loader', async () => {
    mocks.load.mockRejectedValue(new Error('private database connection detail'))
    render(<LiveEmailManagement />)
    expect((await screen.findByRole('alert')).textContent).toContain('Email management status is unavailable under this account.')
    expect(screen.queryByText('private database connection detail')).toBeNull()
  })
})
