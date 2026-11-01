import { expect, test } from '@playwright/test'

test('production entry routes a signed-out visitor to secure sign-in', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Password Show password' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in securely' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/auth/login')
  expect(pageErrors).toEqual([])
})

const protectedPaths = [
  '/companies', '/branches', '/employees', '/employee-approvals', '/attendance', '/leave',
  '/departments', '/job-roles', '/payroll', '/payroll-approvals', '/payslips', '/reconciliation',
  '/deductions', '/statutory', '/reports', '/users', '/audit', '/notifications', '/settings',
]

for (const path of protectedPaths) {
  test(`${path} requires a signed-in session`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    expect(new URL(page.url()).pathname, path).toBe('/auth/login')
  })
}

test('password recovery navigation works without submitting a message', async ({ page }) => {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('sign-in layout has no document-level horizontal overflow across target widths', async ({ page }) => {
  await page.goto('/auth/login', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  const viewports = [
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 844, height: 390 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      heading: document.querySelector('h1')?.getBoundingClientRect().toJSON(),
      submit: document.querySelector('.auth-card form .button-primary')?.getBoundingClientRect().toJSON(),
    }))
    expect(dimensions.documentWidth, `document overflow at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewportWidth)
    expect(dimensions.heading?.left ?? -1, `heading starts offscreen at ${viewport.width}px`).toBeGreaterThanOrEqual(0)
    expect(dimensions.heading?.right ?? viewport.width + 1, `heading exceeds viewport at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width)
    expect(dimensions.submit?.right ?? viewport.width + 1, `submit button exceeds viewport at ${viewport.width}px: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(viewport.width)

    if (viewport.width === 390 || viewport.width === 1440) {
      await page.screenshot({ path: `output/playwright/sign-in-${viewport.width}.png`, fullPage: true })
    }
  }
})
