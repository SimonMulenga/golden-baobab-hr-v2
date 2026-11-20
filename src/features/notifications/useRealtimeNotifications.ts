import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createLiveOperationsServices, type UserNotificationRecord } from '../../services/live-operations-services'
import { getNotificationPreference, notificationsInAppText, playNotificationChime, showSafeSystemNotification } from './notification-preferences'

export function useRealtimeNotifications(client: SupabaseClient | null, userId: string | undefined, onNotification: (notification: UserNotificationRecord) => void) {
  const onNotificationRef = useRef(onNotification)
  useEffect(() => { onNotificationRef.current = onNotification }, [onNotification])

  useEffect(() => {
    if (!userId || !client) return
    let alive = true
    let hydrated = false
    let newestAt = ''
    let realtimeConnected = false
    let fallbackTimer: number | undefined
    const seen = new Set<string>()
    const earlyEvents: UserNotificationRecord[] = []
    const service = createLiveOperationsServices(client)

    const deliver = (item: UserNotificationRecord) => {
      if (!alive || seen.has(item.id)) return
      seen.add(item.id)
      if (item.created_at > newestAt) newestAt = item.created_at
      const safeText = notificationsInAppText(item.source_type)
      onNotificationRef.current({ ...item, ...safeText })
      window.dispatchEvent(new Event('gbhr-notifications-changed'))
      if (getNotificationPreference(userId, 'sound')) void playNotificationChime()
      if (getNotificationPreference(userId, 'system') && document.visibilityState !== 'visible') void showSafeSystemNotification()
    }

    const refreshRecent = async () => {
      try {
        const { items } = await service.notifications.list({ page: 1, pageSize: 100, unreadOnly: false })
        if (!alive) return
        if (!hydrated) {
          for (const item of items) seen.add(item.id)
          newestAt = items.reduce((latest, item) => item.created_at > latest ? item.created_at : latest, newestAt)
          hydrated = true
          for (const item of earlyEvents) deliver(item)
          earlyEvents.length = 0
          return
        }
        const unseen = items.filter((item) => !seen.has(item.id) && (!newestAt || item.created_at >= newestAt)).sort((a, b) => a.created_at.localeCompare(b.created_at))
        for (const item of unseen) deliver(item)
        window.dispatchEvent(new Event('gbhr-notifications-changed'))
      } catch { /* Realtime or the next visibility refresh will retry. */ }
    }

    const updateFallback = () => {
      if (!alive || realtimeConnected) {
        if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer)
        fallbackTimer = undefined
        return
      }
      if (fallbackTimer === undefined) fallbackTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshRecent() }, 30_000)
    }

    const channel = client.channel(`user-notifications:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `recipient_id=eq.${userId}`,
      }, (payload) => {
        const item = payload.new as UserNotificationRecord
        if (!hydrated) earlyEvents.push(item)
        else deliver(item)
      })
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED'
        updateFallback()
        if (status === 'SUBSCRIBED') {
          window.dispatchEvent(new Event('gbhr-notifications-changed'))
          if (hydrated) void refreshRecent()
        }
      })

    void refreshRecent()

    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') {
        window.dispatchEvent(new Event('gbhr-notifications-changed'))
        if (!realtimeConnected) void refreshRecent()
      }
    }
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', refreshOnReturn)
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer)
      void client.removeChannel(channel)
    }
  }, [client, userId])
}
