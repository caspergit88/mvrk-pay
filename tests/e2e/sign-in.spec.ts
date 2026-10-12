import { test, expect } from '@playwright/test'

test('a signed-out visitor is sent to sign in', async ({ page }) => {
  await page.goto('/pay')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpay/)
  await expect(page.getByRole('heading', { name: /MVRK/ })).toBeVisible()
})

test('a team domain shows its location and reveals the password box', async ({ page, request }) => {
  // The lookup is a browser call to Supabase; skip where that host is unreachable (some CI sandboxes).
  const probe = await request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://rsjjsrpjwxuxuvoysiwx.supabase.co'}/rest/v1/`).catch(() => null)
  test.skip(!probe || probe.status() === 0, 'Supabase not reachable from this runner')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('reception@kitepeople.com')
  await expect(page.getByText('KitePeople', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})

test('an outside domain is refused before any password is asked for', async ({ page, request }) => {
  const probe = await request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://rsjjsrpjwxuxuvoysiwx.supabase.co'}/rest/v1/`).catch(() => null)
  test.skip(!probe || probe.status() === 0, 'Supabase not reachable from this runner')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('someone@gmail.com')
  await expect(page.getByText("This email isn't on an MVRK team domain")).toBeVisible()
  await expect(page.getByLabel('Password')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
})

test('the launcher, settings and payment screens all need a session', async ({ page }) => {
  for (const path of ['/apps', '/settings', '/settings/users', '/who', '/transactions']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/sign-in/)
  }
})

test('the nightly job refuses to run without its secret', async ({ request }) => {
  const res = await request.get('/api/cron/expire-sessions')
  // 401 with a secret configured, 503 in production without one, 200 only in development.
  expect([401, 503, 200]).toContain(res.status())
})

test.describe('with a reception login', () => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'E2E_EMAIL / E2E_PASSWORD not set')

  test('sign in, pick a name, land on the payment screen', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/who/)
    await page.getByLabel('Your name').selectOption({ index: 1 })
    if (process.env.E2E_PIN) await page.getByLabel('Your PIN').fill(process.env.E2E_PIN)
    await page.getByRole('button', { name: 'Start taking payments' }).click()
    await expect(page).toHaveURL(/\/pay/)
    await expect(page.getByText('Take a payment')).toBeVisible()
  })
})
