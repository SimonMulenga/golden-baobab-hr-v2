const preferenceKey = (userId: string, setting: 'sound' | 'system') => `gbhr-notification-${setting}-${userId}`

export function getNotificationPreference(userId: string, setting: 'sound' | 'system'): boolean {
  try { return localStorage.getItem(preferenceKey(userId, setting)) === 'on' } catch { return false }
}

export function setNotificationPreference(userId: string, setting: 'sound' | 'system', enabled: boolean): void {
  try { localStorage.setItem(preferenceKey(userId, setting), enabled ? 'on' : 'off') } catch { /* Storage may be unavailable in private browsing. */ }
}

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextConstructor = window.AudioContext
  if (!AudioContextConstructor) return null
  audioContext ??= new AudioContextConstructor()
  return audioContext
}

export async function playNotificationChime(): Promise<void> {
  const context = getAudioContext()
  if (!context) return
  try {
    await context.resume()
    const now = context.currentTime
    for (const [index, frequency] of [784, 988].entries()) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + index * 0.13)
      gain.gain.exponentialRampToValueAtTime(0.045, now + index * 0.13 + 0.018)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.19)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now + index * 0.13)
      oscillator.stop(now + index * 0.13 + 0.2)
    }
  } catch { /* Audio remains best-effort and is never required for delivery. */ }
}

export async function showSafeSystemNotification(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body: 'A workflow status changed. Open Golden Baobab HR to review it.',
    icon: '/pwa-icon.svg',
    tag: 'gbhr-workflow-update',
    data: { path: '/notifications' },
  }
  try {
    if ('serviceWorker' in navigator) {
      const worker = await navigator.serviceWorker.ready
      await worker.showNotification('Golden Baobab HR', options)
    } else {
      new Notification('Golden Baobab HR', options)
    }
  } catch { /* Permission or platform support may change after the user opts in. */ }
}

export function notificationsInAppText(sourceType: string): { title: string; message: string } {
  const type = sourceType.toLowerCase()
  const title = type === 'payroll' ? 'Payroll workflow updated'
    : type === 'employee' ? 'Employee workflow updated'
      : type === 'leave' ? 'Leave workflow updated'
        : type === 'attendance' ? 'Attendance workflow updated'
          : 'Workflow updated'
  return { title, message: 'A status changed. Open Notifications to review the update.' }
}
