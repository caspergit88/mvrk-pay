/**
 * The Network adapter against the mock gateway (scripts/mock-ngenius.mjs on
 * port 9876), which speaks the N-Genius protocol including its failure modes.
 *   node --import tsx --test tests/unit/*.test.ts
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { NGeniusProvider, summarize } from '../../src/lib/providers/ngenius'
import type { ProviderRow } from '../../src/lib/providers/types'

const MOCK = 'http://127.0.0.1:9877'
let proc: ChildProcess

const row = (id: string): ProviderRow => ({
  id,
  location_id: 'loc',
  kind: 'ngenius',
  name: 'Mock Network',
  currency: 'EUR',
  enabled: true,
  is_default: true,
  credential_ref: 'TESTKEY',
  settings: { env: 'sandbox', realm: 'ni', outletRef: 'outlet-1', baseUrl: MOCK },
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  proc = spawn('node', ['scripts/mock-ngenius.mjs'], { env: { ...process.env, MOCK_PORT: '9877' }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(MOCK + '/__test/stats')
      if (r.ok) return
    } catch {}
    await sleep(100)
  }
  throw new Error('mock gateway did not start')
})
after(() => proc.kill())

test('creates an order and reads it back as pending, then paid with the last four', async () => {
  const p = new NGeniusProvider(row('a'), 'TESTKEY')
  const link = await p.createPaymentLink({
    amountMinor: 1250,
    currency: 'EUR',
    merchantRef: 'MP-TEST-0001',
    note: 'Kite lesson',
    customerName: 'Anna Example',
    email: 'payments@mvrk.ae',
    redirectUrl: 'https://pay.example/thanks',
    cancelUrl: 'https://pay.example/cancelled',
    metadata: { desk: 'desk-1' },
  })
  assert.ok(link.providerRef)
  assert.match(link.payUrl, /^https:\/\/paypage/)

  const pending = await p.getStatus(link.providerRef)
  assert.equal(pending.state, 'pending')
  assert.equal(pending.failedAttempts, 0)

  await fetch(`${MOCK}/__test/orders/${link.providerRef}/fail`, { method: 'POST' })
  const declined = await p.getStatus(link.providerRef)
  assert.equal(declined.state, 'failed')
  assert.equal(declined.failedAttempts, 1)

  await fetch(`${MOCK}/__test/orders/${link.providerRef}/pay`, { method: 'POST' })
  const paid = await p.getStatus(link.providerRef)
  assert.equal(paid.state, 'paid')
  assert.equal(paid.rawState, 'PURCHASED')
  assert.deepEqual(paid.card, { scheme: 'VISA', last4: '1111' })
})

test('one token per provider, reused across calls', async () => {
  const before = (await (await fetch(MOCK + '/__test/stats')).json()).tokenCalls
  const p = new NGeniusProvider(row('b'), 'TESTKEY')
  await p.testConnection()
  await p.createPaymentLink({ amountMinor: 100, currency: 'EUR', merchantRef: 'MP-TEST-0002', email: 'x@y.z', redirectUrl: 'https://x/t', cancelUrl: 'https://x/c', metadata: {} })
  const after = (await (await fetch(MOCK + '/__test/stats')).json()).tokenCalls
  assert.equal(after - before, 1, 'testConnection fetched one token and createPaymentLink reused it')
})

test('an edge error page is reported as such and the next attempt waits', async () => {
  await fetch(MOCK + '/__test/identity/down')
  const p = new NGeniusProvider(row('c'), 'TESTKEY')
  await assert.rejects(() => p.testConnection(), /Could not get a Network access token \(HTTP 403/)
  await fetch(MOCK + '/__test/identity/up')
  await assert.rejects(() => p.getStatus('anything'), /failed recently; retrying in \d+s/)
})

test('summarize reads the last attempt and counts the failed ones', () => {
  const s = summarize({
    reference: 'r',
    _embedded: { payment: [{ state: 'FAILED' }, { state: 'FAILED' }, { state: 'CAPTURED', paymentMethod: { name: 'MASTERCARD', pan: '555555******4444' } }] },
  })
  assert.equal(s.state, 'paid')
  assert.equal(s.failedAttempts, 2)
  assert.equal(s.card?.last4, '4444')
  assert.equal(summarize({ reference: 'r', _embedded: { payment: [{ state: 'REFUNDED' }] } }).state, 'refunded')
})
