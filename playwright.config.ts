import { defineConfig } from '@playwright/test'

const baseURL = process.env.GBHR_E2E_BASE_URL ?? 'https://golden-baobab-hr-v2.vercel.app'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'output/playwright/results',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
