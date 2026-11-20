import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.webmanifest'), 'utf8'))
const worker = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8')

describe('PWA safety contract', () => {
  it('uses a branded standalone manifest with an app icon', () => {
    expect(manifest.name).toBe('Golden Baobab HR')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.some((icon: { src: string }) => icon.src === '/pwa-icon.svg')).toBe(true)
    for (const [path, size] of [['pwa-icon-192.png', 192], ['pwa-icon-512.png', 512]] as const) {
      const png = readFileSync(resolve(process.cwd(), 'public', path))
      expect(png.readUInt32BE(16)).toBe(size)
      expect(png.readUInt32BE(20)).toBe(size)
    }
  })

  it('does not intercept fetches or cache authenticated responses', () => {
    expect(worker).not.toMatch(/addEventListener\(['"]fetch['"]|caches\.(?:open|match|put)/)
    expect(worker).toContain('GBHR_APPLY_UPDATE')
  })
})
