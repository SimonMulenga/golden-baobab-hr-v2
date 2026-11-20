import { expect, test } from '@playwright/test'

test('PWA manifest and install icons are served without caching application data', async ({ page, request }) => {
  const manifestResponse = await request.get('/manifest.webmanifest')
  expect(manifestResponse.ok()).toBeTruthy()
  const manifest = await manifestResponse.json()
  expect(manifest.name).toBe('Golden Baobab HR')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.some((icon: { src: string; sizes: string }) => icon.src === '/pwa-icon-192.png' && icon.sizes === '192x192')).toBeTruthy()
  expect(manifest.icons.some((icon: { src: string; sizes: string }) => icon.src === '/pwa-icon-512.png' && icon.sizes === '512x512')).toBeTruthy()

  for (const icon of ['/pwa-icon-192.png', '/pwa-icon-512.png']) {
    const response = await request.get(icon)
    expect(response.ok(), icon).toBeTruthy()
    expect(response.headers()['content-type']).toContain('image/png')
  }

  const workerResponse = await request.get('/service-worker.js')
  expect(workerResponse.ok()).toBeTruthy()
  const workerSource = await workerResponse.text()
  expect(workerSource).not.toMatch(/addEventListener\(['"]fetch['"]|caches\.(?:open|match|put)/)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  const registration = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const worker = await navigator.serviceWorker.ready
    return worker.scope === `${location.origin}/`
  })
  expect(registration).toBeTruthy()
})
