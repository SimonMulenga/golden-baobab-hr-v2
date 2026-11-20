import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserNotificationRecord } from '../../services/live-operations-services'
import { useRealtimeNotifications } from './useRealtimeNotifications'

const mocks = vi.hoisted(() => ({ list: vi.fn(), handler: undefined as undefined | ((payload: { new: UserNotificationRecord }) => void), status: undefined as undefined | ((status: string) => void), removeChannel: vi.fn() }))
vi.mock('../../services/live-operations-services', () => ({ createLiveOperationsServices: () => ({ notifications: { list: mocks.list } }) }))

const notification: UserNotificationRecord = {
  id: 'synthetic-notification-1', portfolio_id: 'synthetic-portfolio', company_id: 'synthetic-company', branch_id: null,
  recipient_id: 'synthetic-user', source_type: 'PAYROLL', source_id: 'synthetic-run', transition: 'SUBMITTED',
  title: 'Confidential title from database', message: 'Confidential salary detail', action_path: '/payroll',
  created_at: '2026-11-21T10:00:00.000Z', read_at: null,
}

function Harness({ onNotification }: { onNotification: (item: UserNotificationRecord) => void }) {
  useRealtimeNotifications(client, 'synthetic-user', onNotification)
  return null
}

const channel = {
  on: vi.fn((_event: string, _filter: unknown, handler: (payload: { new: UserNotificationRecord }) => void) => { mocks.handler = handler; return channel }),
  subscribe: vi.fn((status: (value: string) => void) => { mocks.status = status; status('SUBSCRIBED'); return channel }),
}
const client = { channel: vi.fn(() => channel), removeChannel: mocks.removeChannel } as unknown as SupabaseClient

describe('real-time notification delivery', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('subscribes to the signed-in recipient and deduplicates repeated event delivery', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0, unreadTotal: 0 })
    const onNotification = vi.fn()
    render(<Harness onNotification={onNotification} />)
    await waitFor(() => expect(mocks.handler).toBeTypeOf('function'))
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ filter: 'recipient_id=eq.synthetic-user', table: 'user_notifications' }), expect.any(Function))
    await act(async () => { mocks.handler?.({ new: notification }); mocks.handler?.({ new: notification }) })
    expect(onNotification).toHaveBeenCalledTimes(1)
    expect(onNotification.mock.calls[0][0]).toMatchObject({ title: 'Payroll workflow updated', message: 'A status changed. Open Notifications to review the update.' })
    expect(JSON.stringify(onNotification.mock.calls[0][0])).not.toContain('Confidential salary detail')
  })

  it('keeps the bounded inbox refresh active while Realtime reports subscribed', async () => {
    vi.useFakeTimers()
    mocks.list.mockResolvedValue({ items: [], total: 0, unreadTotal: 0 })
    render(<Harness onNotification={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.status).toBeTypeOf('function')
    expect(mocks.list).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })
})
