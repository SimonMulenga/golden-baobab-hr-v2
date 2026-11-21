import type { SupabaseClient } from '@supabase/supabase-js'

export type PushAvailability = { supported: boolean; reason?: string }

export function pushAvailability(): PushAvailability {
  if (typeof window === 'undefined' || !window.isSecureContext) return { supported: false, reason: 'Background notifications require a secure HTTPS connection.' }
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (appleMobile && !installed) return { supported: false, reason: 'On iPhone and iPad, install Golden Baobab HR to the Home Screen before enabling background notifications.' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { supported: false, reason: 'This browser or installed app does not support background notifications.' }
  return { supported: true }
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

async function publicKey(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.functions.invoke('notification-push', { body: { action: 'public-key' } })
  if (error || typeof data?.publicKey !== 'string' || !data.publicKey) throw new Error('Background notifications are not configured yet.')
  return data.publicKey
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushAvailability().supported) return null
  return (await navigator.serviceWorker.ready).pushManager.getSubscription()
}

export async function enablePush(client: SupabaseClient): Promise<void> {
  const availability = pushAvailability()
  if (!availability.supported) throw new Error(availability.reason)
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notification permission is blocked in browser settings.' : 'Notification permission was not granted.')
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const decodedKey = decodeBase64Url(await publicKey(client))
  const applicationServerKey = new ArrayBuffer(decodedKey.byteLength)
  new Uint8Array(applicationServerKey).set(decodedKey)
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  const keys = subscription.toJSON().keys
  if (!keys?.p256dh || !keys.auth) throw new Error('The browser returned an incomplete push subscription.')
  const { error } = await client.rpc('user_push_subscription_save', {
    p_endpoint: subscription.endpoint,
    p_p256dh: keys.p256dh,
    p_auth_secret: keys.auth,
  })
  if (error) {
    if (!existing) await subscription.unsubscribe().catch(() => undefined)
    throw new Error('This device could not be registered for background notifications.')
  }
}

export async function disablePush(client: SupabaseClient): Promise<void> {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  const { error } = await client.rpc('user_push_subscription_remove', { p_endpoint: subscription.endpoint })
  if (error) throw new Error('This device could not be removed from background notifications.')
  await subscription.unsubscribe()
}

export async function sendPushTest(client: SupabaseClient): Promise<number> {
  const subscription = await currentPushSubscription()
  if (!subscription) return 0
  const { data, error } = await client.functions.invoke('notification-push', { body: { action: 'test', endpoint: subscription.endpoint } })
  if (error || data?.status !== 'test-sent') throw new Error('The test notification could not be sent.')
  return Number(data.sent ?? 0)
}

export async function hasPushSubscription(): Promise<boolean> {
  return Boolean(await currentPushSubscription())
}
