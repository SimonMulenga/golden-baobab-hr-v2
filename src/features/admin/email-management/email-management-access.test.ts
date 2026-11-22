import { describe, expect, it } from 'vitest'
import { canShowEmailManagementNavigation, emailManagementRouteAccess, resolveEmailManagementAccess, type EmailManagementAuthorization } from './email-management-access'

describe('Email Management navigation and route authorization', () => {
  it('shows the menu and opens the route only after server authorization', () => {
    const access = resolveEmailManagementAccess({ authenticated: true, authorized: true })
    const authorization: EmailManagementAuthorization = { userId: 'active-platform-admin', state: access }
    expect(canShowEmailManagementNavigation('active-platform-admin', authorization)).toBe(true)
    expect(emailManagementRouteAccess('active-platform-admin', authorization)).toBe('allow')
  })

  it('does not show the menu or allow the route while authorization is pending', () => {
    const authorization: EmailManagementAuthorization = { userId: 'user-1', state: 'checking' }
    expect(canShowEmailManagementNavigation('user-1', authorization)).toBe(false)
    expect(emailManagementRouteAccess('user-1', authorization)).toBe('wait')
  })

  it('denies an ordinary or revoked user even if workspace company roles allow administration', () => {
    const access = resolveEmailManagementAccess({ authenticated: true, authorized: false })
    const authorization: EmailManagementAuthorization = { userId: 'company-admin', state: access }
    expect(canShowEmailManagementNavigation('company-admin', authorization)).toBe(false)
    expect(emailManagementRouteAccess('company-admin', authorization)).toBe('deny')
  })

  it('keeps access closed and reports an unavailable authorization check for gateway or server errors', () => {
    for (const errorStatus of [401, 500, 503]) {
      const access = resolveEmailManagementAccess({ authenticated: true, errorStatus })
      expect(access).toBe('unavailable')
      const authorization: EmailManagementAuthorization = { userId: 'active-platform-admin', state: access }
      expect(canShowEmailManagementNavigation('active-platform-admin', authorization)).toBe(false)
      expect(emailManagementRouteAccess('active-platform-admin', authorization)).toBe('deny')
    }
  })

  it('treats an explicit platform-owner denial as final', () => {
    expect(resolveEmailManagementAccess({ authenticated: true, errorStatus: 403 })).toBe('denied')
  })

  it('denies direct navigation without an authenticated account', () => {
    expect(resolveEmailManagementAccess({ authenticated: false, authorized: true })).toBe('denied')
    const authorization: EmailManagementAuthorization = { userId: 'active-platform-admin', state: 'allowed' }
    expect(canShowEmailManagementNavigation(undefined, authorization)).toBe(false)
    expect(emailManagementRouteAccess(undefined, authorization)).toBe('deny')
  })

  it('does not carry a previous platform administrator authorization into a different signed-in account', () => {
    const previousOwnerAuthorization: EmailManagementAuthorization = { userId: 'active-platform-admin', state: 'allowed' }
    expect(canShowEmailManagementNavigation('ordinary-user', previousOwnerAuthorization)).toBe(false)
    expect(emailManagementRouteAccess('ordinary-user', previousOwnerAuthorization)).toBe('wait')
  })
})
