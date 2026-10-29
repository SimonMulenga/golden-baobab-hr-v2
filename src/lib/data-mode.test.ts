import { describe, expect, it } from 'vitest'
import { resolveDataMode } from './data-mode'

describe('data mode safety', () => {
  it('keeps demo data available only in non-production builds', () => {
    expect(resolveDataMode(undefined, false)).toBe('MOCK')
    expect(resolveDataMode('MOCK', false)).toBe('MOCK')
    expect(() => resolveDataMode('MOCK', true)).toThrow('disabled in production builds')
  })

  it('defaults production builds to live data and accepts explicit LIVE mode', () => {
    expect(resolveDataMode(undefined, true)).toBe('LIVE')
    expect(resolveDataMode('LIVE', true)).toBe('LIVE')
  })
})
