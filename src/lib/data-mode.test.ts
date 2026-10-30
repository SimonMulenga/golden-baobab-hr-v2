import { describe, expect, it } from 'vitest'
import { resolveDataMode } from './data-mode'

describe('data mode safety', () => {
  it('uses live data by default and rejects synthetic demo mode in all builds', () => {
    expect(resolveDataMode(undefined, false)).toBe('LIVE')
    expect(resolveDataMode(undefined, true)).toBe('LIVE')
    expect(() => resolveDataMode('MOCK', false)).toThrow('must be LIVE')
    expect(() => resolveDataMode('MOCK', true)).toThrow('must be LIVE')
  })

  it('accepts explicit LIVE mode for development and production', () => {
    expect(resolveDataMode('LIVE', false)).toBe('LIVE')
    expect(resolveDataMode('LIVE', true)).toBe('LIVE')
  })
})
