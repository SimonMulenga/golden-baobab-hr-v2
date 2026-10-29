import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveOperationsServices } from './live-operations-services'

describe('live notification count service', () => {
  it('counts unread inbox rows through the authenticated RLS client', async () => {
    const builder = {
      select: vi.fn(), is: vi.fn(), then: vi.fn(),
    }
    builder.select.mockReturnValue(builder)
    builder.is.mockReturnValue(builder)
    builder.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve({ count: 7, error: null }).then(resolve))
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient
    const count = await createLiveOperationsServices(client).notifications.unreadCount()

    expect(count).toBe(7)
    expect(client.from).toHaveBeenCalledWith('user_notifications')
    expect(builder.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builder.is).toHaveBeenCalledWith('read_at', null)
  })
})
