import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminCodeRequired, clientIp, emailCodesAvailable } from '../../src/lib/login-guard'

test('clientIp takes the address Vercel reports, first hop only', () => {
  assert.equal(clientIp(new Headers({ 'x-real-ip': ' 203.0.113.7 ' })), '203.0.113.7')
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })), '198.51.100.2')
  assert.equal(clientIp(new Headers()), '')
})

test('the admin code is asked for only when it can be delivered, unless switched off', () => {
  const keys = ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_FROM', 'ADMIN_EMAIL_CODE'] as const
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    for (const k of keys) delete process.env[k]
    assert.equal(adminCodeRequired(), false, 'nothing configured: skipped')
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'x'
    process.env.RESEND_API_KEY = 'x'
    assert.equal(adminCodeRequired(), false, 'no from address: skipped')
    assert.equal(emailCodesAvailable(), false, 'no from address: sign-in stays password-only')
    process.env.RESEND_FROM_EMAIL = 'pay@mvrk.ae'
    assert.equal(adminCodeRequired(), true, 'all three: required')
    assert.equal(emailCodesAvailable(), true, 'all three: sign-in by code is offered')
    process.env.ADMIN_EMAIL_CODE = 'OFF'
    assert.equal(adminCodeRequired(), false, 'switched off deliberately')
    assert.equal(emailCodesAvailable(), true, 'switching off the admin second code leaves sign-in by code alone')
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})
