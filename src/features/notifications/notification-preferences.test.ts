import { afterEach, describe, expect, it } from 'vitest'
import { getNotificationPreference, notificationsInAppText, setNotificationPreference } from './notification-preferences'

describe('notification preferences and safe previews', () => {
  afterEach(() => localStorage.clear())

  it('keeps notification preferences scoped to the signed-in user', () => {
    setNotificationPreference('synthetic-user-a', 'sound', true)
    expect(getNotificationPreference('synthetic-user-a', 'sound')).toBe(true)
    expect(getNotificationPreference('synthetic-user-b', 'sound')).toBe(false)
  })

  it('uses generic preview text for payroll and employee events', () => {
    const privateDetails = 'Salary K99999 for Simon / account 123456'
    expect(notificationsInAppText('PAYROLL')).toEqual({ title: 'Payroll workflow updated', message: 'A status changed. Open Notifications to review the update.' })
    expect(JSON.stringify(notificationsInAppText('EMPLOYEE'))).not.toContain(privateDetails)
  })

  it('does not request browser permission as a side effect of preference reads', () => {
    getNotificationPreference('synthetic-user', 'system')
    expect(localStorage.getItem('gbhr-notification-system-synthetic-user')).toBeNull()
  })
})
