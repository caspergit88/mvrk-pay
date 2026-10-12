import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditLabel, auditSummary } from '../../src/lib/audit'

test('an update lists only what changed, from what to what', () => {
  const s = auditSummary({
    action: 'update',
    before: { id: 'p1', name: 'Network', enabled: true, updated_at: '2026-10-12T08:00:00Z' },
    after: { id: 'p1', name: 'Network', enabled: false, updated_at: '2026-10-12T09:00:00Z' },
  })
  assert.equal(s, 'enabled: true → false')
})

test('keys and links show as changed, never their value', () => {
  const s = auditSummary({
    action: 'update',
    before: { webhook_token: 'aaaaaaaaaaaaaaaa', display_key: 'k1' },
    after: { webhook_token: 'bbbbbbbbbbbbbbbb', display_key: 'k2' },
  })
  assert.equal(s, 'webhook_token changed; display_key changed')
  assert.doesNotMatch(s, /aaaa|bbbb|k1|k2/)

  const added = auditSummary({ action: 'insert', before: null, after: { kind: 'ngenius', webhook_token: 'secret-ish' } })
  assert.doesNotMatch(added, /secret-ish/)
  assert.match(added, /webhook_token set/)
})

test('an insert or delete names the row', () => {
  assert.equal(auditSummary({ action: 'insert', before: null, after: { name: 'Desk 2', slug: 'desk-2' } }), 'Added “Desk 2”.')
  assert.equal(auditSummary({ action: 'delete', before: { full_name: 'Anna' }, after: null }), 'Removed “Anna”.')
})

test('a button press shows its detail', () => {
  assert.equal(auditSummary({ action: 'test_connection', before: null, after: { ok: false, message: 'No credential found' } }), 'ok: false, message: No credential found')
  assert.equal(auditSummary({ action: 'start', before: null, after: null }), '—')
})

test('a saved row with nothing changed says so, and long values are cut', () => {
  assert.equal(auditSummary({ action: 'update', before: { a: 1, updated_at: 'x' }, after: { a: 1, updated_at: 'y' } }), 'Saved with no visible change.')
  const long = 'x'.repeat(80)
  assert.match(auditSummary({ action: 'update', before: { note: '' }, after: { note: long } }), /^note: — → x{39}…$/)
  assert.equal(auditLabel({ merchant_ref: 'MP-1' }), 'MP-1')
  assert.equal(auditLabel(null), null)
})
