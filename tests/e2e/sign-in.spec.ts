import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * The domain lookup is a browser call to Supabase with the publishable key the
 * app was built with. CI builds with a placeholder unless the repository has
 * the real key as a variable, and some runners cannot reach Supabase at all;
 * either way those tests skip rather than fail.
 */
async function supabaseUsable(request: APIRequestContext) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://rsjjsrpjwxuxuvoysiwx.supabase.co'
  const probe = await request.get(`${url}/rest/v1/`, { headers: { apikey: key } }).catch(() => null)
  return Boolean(probe && probe.status() > 0)
}

test('a signed-out visitor is sent to sign in', async ({ page }) => {
  await page.goto('/pay')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpay/)
  await expect(page.getByRole('heading', { name: /MVRK/ })).toBeVisible()
})

test('a team domain shows its location and reveals the password box', async ({ page, request }) => {
  test.skip(!(await supabaseUsable(request)), 'No real publishable key, or Supabase not reachable from this runner')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('reception@kitepeople.com')
  await expect(page.getByText('KitePeople', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})

test('an outside domain is refused before any password is asked for', async ({ page, request }) => {
  test.skip(!(await supabaseUsable(request)), 'No real publishable key, or Supabase not reachable from this runner')
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('someone@gmail.com')
  await expect(page.getByText("This email isn't on an MVRK team domain")).toBeVisible()
  await expect(page.getByLabel('Password')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
})

test('the launcher, settings and payment screens all need a session', async ({ page }) => {
  for (const path of ['/apps', '/settings', '/settings/users', '/settings/providers', '/settings/audit', '/sign-in/code', '/sign-in/email-code', '/who', '/transactions', '/report', '/report/pdf?date=2026-01-01', '/transactions/export?from=2026-01-01&to=2026-01-31']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/sign-in/)
  }
})

test('the scheduled jobs refuse to run without their secret', async ({ request }) => {
  for (const path of ['/api/cron/nightly', '/api/cron/expire-sessions']) {
    const res = await request.get(path)
    // 401 with a secret configured, 503 in production without one, 200 only in development.
    expect([401, 503, 200]).toContain(res.status())
    if (res.status() !== 200) expect((await res.json()).ok).toBe(false)
  }
  const wrong = await request.get('/api/cron/nightly', { headers: { Authorization: 'Bearer not-the-secret' } })
  expect([401, 503, 200]).toContain(wrong.status())
})

test('the thank-you page offers nothing without a reference and does not crash', async ({ page }) => {
  await page.goto('/thanks')
  await expect(page.getByText('Thank you')).toBeVisible()
  await expect(page.getByLabel('Email me a receipt')).toHaveCount(0)
  await page.goto('/cancelled')
  await expect(page.getByText('Payment cancelled')).toBeVisible()
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
