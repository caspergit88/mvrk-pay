import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportText, reportPdf, toCsv, type ReportData } from '../../src/lib/report'

const fixture: ReportData = {
  location: { id: 'l1', name: 'KitePeople', slug: 'kitepeople', timezone: 'Africa/Cairo', finance_email: 'finance@example.com' },
  date: '2026-10-12',
  desks: ['desk-1'],
  lines: [
    { id: 'a', created_at: '2026-10-12T08:05:00Z', merchant_ref: 'MP-KITEPEOPLE-DESK-1-AAA', provider_name: 'Network', cashier_name: 'Anna', note: 'Kite lesson', booking_ref: 'KH-77', amount_minor: 1250, currency: 'EUR', status: 'paid', closed_reason: null, display_status: 'Paid', card_scheme: 'VISA', card_last4: '4242', paid_at: '2026-10-12T08:06:00Z', late: false, desk_slug: 'desk-1' },
    { id: 'b', created_at: '2026-10-12T09:15:00Z', merchant_ref: 'MP-KITEPEOPLE-DESK-1-BBB', provider_name: 'Network', cashier_name: 'Anna', note: 'Has a "comma", and quotes', booking_ref: '', amount_minor: 500, currency: 'EUR', status: 'closed', closed_reason: 'replaced', display_status: 'Not confirmed', card_scheme: null, card_last4: null, paid_at: null, late: false, desk_slug: 'desk-1' },
  ],
  byProvider: [{ provider_name: 'Network', currency: 'EUR', paid_count: 1, paid_minor: 1250, refunded_count: 0, refunded_minor: 0 }],
  byCashier: [{ cashier_name: 'Anna', currency: 'EUR', paid_count: 1, paid_minor: 1250 }],
  totals: [{ currency: 'EUR', paid_count: 1, paid_minor: 1250, refunded_count: 0, refunded_minor: 0, declined_count: 0, open_count: 0, not_confirmed_count: 1, late_count: 0 }],
  close: { id: 'c1', close_number: 'KP-2026-10-12-1', closed_at: '2026-10-12T19:00:00Z', automatic: true, reopened_at: null, reopen_reason: null, report_path: null, closed_by_name: null },
  lateFromEarlierDays: [],
  generatedAt: '2026-10-12T19:00:01Z',
}

test('reportText reads like a terminal Z report', () => {
  const t = reportText(fixture)
  assert.match(t, /MVRK PAY — END OF DAY/)
  assert.match(t, /KitePeople/)
  assert.match(t, /EUR 12\.50.*PAID VISA 4242/)
  assert.match(t, /NOT CONFIRMED/)
  assert.match(t, /PAID\s+1\s+EUR 12\.50/)
  assert.match(t, /By person:\n\s+Anna/)
  assert.match(t, /Signed:/)
})

test('reportPdf produces a PDF', async () => {
  const pdf = await reportPdf(fixture)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 1000)
})

test('toCsv quotes what needs quoting and uses display statuses', () => {
  const csv = toCsv(fixture.lines.map((l) => ({ ...l, location_name: 'KitePeople', business_date: '2026-10-12', provider_ref: 'ord-' + l.id })))
  const rows = csv.trim().split('\n')
  assert.equal(rows.length, 3)
  assert.match(rows[0], /^business_date,location_name,desk_slug,created_at,merchant_ref,provider_name,provider_ref,cashier_name,note,booking_ref,amount,currency,status/)
  assert.match(rows[1], /,12\.50,EUR,Paid,VISA,4242,/)
  assert.match(rows[2], /"Has a ""comma"", and quotes"/)
  assert.match(rows[2], /,Not confirmed,/)
})
