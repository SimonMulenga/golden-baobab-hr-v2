import { describe, expect, it } from 'vitest'
import { validateCompanyLogo } from './logo-image'

describe('company logo upload validation', () => {
  it('accepts PNG, JPEG, and WebP images', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateCompanyLogo(new File(['image'], 'logo', { type }))).toBeNull()
    }
  })
  it('rejects SVG and source files larger than the processing limit', () => {
    expect(validateCompanyLogo(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))).toMatch(/PNG, JPG, or WebP/)
    expect(validateCompanyLogo(new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).toMatch(/10 MB/)
  })
})
