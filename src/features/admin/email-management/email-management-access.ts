export type EmailManagementAccess = 'checking' | 'allowed' | 'denied' | 'unavailable'
export type EmailManagementRouteAccess = 'allow' | 'wait' | 'deny'
export interface EmailManagementAuthorization {
  userId: string | null
  state: EmailManagementAccess
}

export function resolveEmailManagementAccess(input: {
  authenticated: boolean
  authorized?: boolean
  errorStatus?: number
}): EmailManagementAccess {
  if (!input.authenticated) return 'denied'
  if (input.authorized === true && input.errorStatus === undefined) return 'allowed'
  if (input.authorized === false || input.errorStatus === 403) return 'denied'
  return 'unavailable'
}

export function currentEmailManagementAccess(userId: string | undefined, authorization: EmailManagementAuthorization): EmailManagementAccess {
  if (!userId) return 'denied'
  return authorization.userId === userId ? authorization.state : 'checking'
}

export function canShowEmailManagementNavigation(userId: string | undefined, authorization: EmailManagementAuthorization): boolean {
  return currentEmailManagementAccess(userId, authorization) === 'allowed'
}

export function emailManagementRouteAccess(userId: string | undefined, authorization: EmailManagementAuthorization): EmailManagementRouteAccess {
  const access = currentEmailManagementAccess(userId, authorization)
  if (access === 'denied' || access === 'unavailable') return 'deny'
  return access === 'allowed' ? 'allow' : 'wait'
}
