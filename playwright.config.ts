import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against a running app (`npm run build && npm run start`, or
 * `npm run dev`) pointed at the real Supabase project with the public keys in
 * .env.local. Tests that need a login are skipped unless E2E_EMAIL and
 * E2E_PASSWORD are set.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
})
