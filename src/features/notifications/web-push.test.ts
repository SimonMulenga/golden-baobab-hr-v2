import { afterEach, describe, expect, it, vi } from 'vitest'
import { pushAvailability } from './web-push'

describe('background push capability checks', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not request notification permission when checking support', () => {
    const permission = vi.fn()
    vi.stubGlobal('Notification', Object.assign(class {}, { requestPermission: permission, permission: 'default' }))
    expect(pushAvailability().supported).toBe(false)
    expect(permission).not.toHaveBeenCalled()
  })

  it('explains HTTPS and unsupported browser requirements', () => {
    expect(pushAvailability()).toMatchObject({ supported: false })
    if (!window.isSecureContext) expect(pushAvailability().reason).toContain('HTTPS')
  })
})
