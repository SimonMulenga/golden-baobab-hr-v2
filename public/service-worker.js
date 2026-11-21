/*
 * Deliberately does not intercept fetches or cache responses. In particular,
 * authentication, employee, payroll, and financial API responses are never
 * stored by this service worker.
 */
self.addEventListener('install', () => {
  // Wait for the user to apply an update instead of interrupting an open task.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GBHR_APPLY_UPDATE') self.skipWaiting()
})

self.addEventListener('push', (event) => {
  // Push payloads intentionally contain no employee, payroll, or source IDs.
  event.waitUntil(self.registration.showNotification('Golden Baobab HR', {
    body: 'You have a new HR workflow update. Sign in to review it.',
    icon: '/pwa-icon-192.png',
    badge: '/pwa-icon-192.png',
    tag: 'gbhr-workflow-update',
    data: { path: '/notifications' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      existing.postMessage({ type: 'GBHR_OPEN_NOTIFICATIONS' })
      return
    }
    await self.clients.openWindow('/notifications')
  })())
})
