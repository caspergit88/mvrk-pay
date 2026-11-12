import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, deskLabel, summariseRange, type RangeRow } from '../../src/lib/range-report'

const row = (over: Partial<RangeRow>): RangeRow => ({
  id: Math.random().toString(36),
  created_at: '2026-11-10T09:00:00Z',
  business_date: '2026-11-10',
  location_id: 'kp',
  location_name: 'KitePeople',
  desk_slug: 'desk-1',
  merchant_ref: 'MP-X',
  provider_name: 'Network',
  cashier_name: 'Rimon',
  note: '',
  booking_ref: '',
  amount_minor: 1000,
  currency: 'EUR',
  display_status: 'Paid',
  card_scheme: 'VISA',
  card_last4: '4242',
  paid_at: '2026-11-10T09:01:00Z',
  late: false,
  ...over,
})

const rows: RangeRow[] = [
  row({ amount_minor: 2000 }),
  row({ amount_minor: 500, display_status: 'Declined', card_scheme: null }),
  row({ business_date: '2026-11-11', amount_minor: 3000, cashier_name: 'Sara', desk_slug: 'desk-2', card_scheme: 'MASTERCARD' }),
  row({ business_date: '2026-11-11', amount_minor: 1000, display_status: 'Refunded' }),
  row({ business_date: '2026-11-11', location_id: 'ri', location_name: 'Riah', amount_minor: 4000 }),
]

test('daysBetween counts both ends', () => {
  assert.equal(daysBetween('2026-11-10', '2026-11-10'), 1)
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 4)
})

test('deskLabel reads a slug as a desk name', () => {
  assert.equal(deskLabel('desk-2'), 'Desk 2')
  assert.equal(deskLabel('front'), 'front')
})

test('totals: refunds count as paid then come off the net; everything else is unpaid', () => {
  const r = summariseRange(rows, '2026-11-10', '2026-11-11')
  assert.equal(r.days, 2)
  assert.equal(r.codes, 5)
  assert.deepEqual(r.totals, [
    { currency: 'EUR', paid_count: 4, paid_minor: 10000, refunded_count: 1, refunded_minor: 1000, net_minor: 9000, unpaid_count: 1, unpaid_minor: 500 },
  ])
  assert.deepEqual(r.paidStats, [{ currency: 'EUR', average_minor: 2500, largest_minor: 4000 }])
})

test('groups: days in date order, the rest by net takings', () => {
  const r = summariseRange(rows, '2026-11-10', '2026-11-11')
  assert.deepEqual(r.byDay.map((g) => [g.label, g.tallies[0].net_minor]), [['2026-11-10', 2000], ['2026-11-11', 7000]])
  assert.deepEqual(r.byLocation.map((g) => g.label), ['KitePeople', 'Riah'])
  assert.deepEqual(r.byPerson.map((g) => [g.label, g.tallies[0].paid_count]), [['Rimon', 3], ['Sara', 1]])
  assert.deepEqual(r.byDesk.map((g) => g.label), ['Riah · Desk 1', 'KitePeople · Desk 2', 'KitePeople · Desk 1'])
  assert.deepEqual(r.byCard.map((g) => g.label), ['VISA', 'MASTERCARD'])
  assert.equal(r.statusCounts.find((s) => s.status === 'Declined')?.count, 1)
})

test('currencies are never added together', () => {
  const r = summariseRange([row({}), row({ currency: 'AED', amount_minor: 5000 })], '2026-11-10', '2026-11-10')
  assert.deepEqual(r.totals.map((t) => [t.currency, t.paid_minor]), [['AED', 5000], ['EUR', 1000]])
})
