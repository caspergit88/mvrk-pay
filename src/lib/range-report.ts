import type { DisplayStatus } from '@/lib/types'

/**
 * The sales report over a date range, for Admin, Manager and Finance to dig
 * into more than one day. Built from the same rows as the transaction list and
 * its CSV (pay.v_transactions through RLS), so the three always agree. Pure:
 * the page fetches, this adds up.
 */

export type RangeRow = {
  id: string
  created_at: string
  business_date: string
  location_id: string
  location_name: string
  desk_slug: string
  merchant_ref: string
  provider_name: string
  cashier_name: string
  note: string
  booking_ref: string
  amount_minor: number
  currency: string
  display_status: DisplayStatus
  card_scheme: string | null
  card_last4: string | null
  paid_at: string | null
  late: boolean
}

/** Money taken, and what did not turn into money, for one group of rows in one currency. */
export type Tally = {
  currency: string
  paid_count: number
  paid_minor: number
  refunded_count: number
  refunded_minor: number
  /** Paid less refunded. */
  net_minor: number
  /** Codes that ended without money: declined, expired, unpaid, replaced, not confirmed, still waiting. */
  unpaid_count: number
  unpaid_minor: number
}

export type Group = { key: string; label: string; tallies: Tally[] }

export type RangeReport = {
  from: string
  to: string
  days: number
  codes: number
  totals: Tally[]
  /** Average and largest paid amount, per currency. */
  paidStats: { currency: string; average_minor: number; largest_minor: number }[]
  statusCounts: { status: DisplayStatus; count: number }[]
  byDay: Group[]
  byLocation: Group[]
  byDesk: Group[]
  byPerson: Group[]
  byProvider: Group[]
  byCard: Group[]
}

/** Inclusive number of calendar days from `from` to `to` (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

const EMPTY = (currency: string): Tally => ({
  currency,
  paid_count: 0,
  paid_minor: 0,
  refunded_count: 0,
  refunded_minor: 0,
  net_minor: 0,
  unpaid_count: 0,
  unpaid_minor: 0,
})

function add(t: Tally, r: RangeRow) {
  if (r.display_status === 'Paid') {
    t.paid_count++
    t.paid_minor += r.amount_minor
  } else if (r.display_status === 'Refunded') {
    // A refund was money taken first: it counts as paid, then comes off the net.
    t.paid_count++
    t.paid_minor += r.amount_minor
    t.refunded_count++
    t.refunded_minor += r.amount_minor
  } else {
    t.unpaid_count++
    t.unpaid_minor += r.amount_minor
  }
  t.net_minor = t.paid_minor - t.refunded_minor
}

/** Group rows by `keyOf`, one tally per currency, largest net first unless `sort` says otherwise. */
function groupBy(rows: RangeRow[], keyOf: (r: RangeRow) => [string, string], sort: 'net' | 'key' = 'net'): Group[] {
  const groups = new Map<string, { label: string; byCur: Map<string, Tally> }>()
  for (const r of rows) {
    const [key, label] = keyOf(r)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { label, byCur: new Map() }))
    let t = g.byCur.get(r.currency)
    if (!t) g.byCur.set(r.currency, (t = EMPTY(r.currency)))
    add(t, r)
  }
  const out = [...groups.entries()].map(([key, g]) => ({ key, label: g.label, tallies: [...g.byCur.values()].sort((a, b) => a.currency.localeCompare(b.currency)) }))
  const net = (g: Group) => g.tallies.reduce((s, t) => s + t.net_minor, 0)
  return sort === 'key' ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => net(b) - net(a) || a.label.localeCompare(b.label))
}

export function summariseRange(rows: RangeRow[], from: string, to: string): RangeReport {
  const totals = groupBy(rows, () => ['all', 'All'])[0]?.tallies ?? []

  const paidByCur = new Map<string, number[]>()
  for (const r of rows) {
    if (r.display_status !== 'Paid' && r.display_status !== 'Refunded') continue
    const list = paidByCur.get(r.currency) ?? []
    list.push(r.amount_minor)
    paidByCur.set(r.currency, list)
  }
  const paidStats = [...paidByCur.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, list]) => ({
      currency,
      average_minor: Math.round(list.reduce((s, v) => s + v, 0) / list.length),
      largest_minor: Math.max(...list),
    }))

  const counts = new Map<DisplayStatus, number>()
  for (const r of rows) counts.set(r.display_status, (counts.get(r.display_status) ?? 0) + 1)
  const statusCounts = [...counts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)

  return {
    from,
    to,
    days: daysBetween(from, to),
    codes: rows.length,
    totals,
    paidStats,
    statusCounts,
    byDay: groupBy(rows, (r) => [r.business_date, r.business_date], 'key'),
    byLocation: groupBy(rows, (r) => [r.location_id, r.location_name]),
    byDesk: groupBy(rows, (r) => [`${r.location_id}:${r.desk_slug}`, `${r.location_name} · ${deskLabel(r.desk_slug)}`]),
    byPerson: groupBy(rows, (r) => [r.cashier_name, r.cashier_name]),
    byProvider: groupBy(rows, (r) => [r.provider_name, r.provider_name]),
    byCard: groupBy(
      rows.filter((r) => r.display_status === 'Paid' || r.display_status === 'Refunded'),
      (r) => [r.card_scheme ?? 'Unknown', r.card_scheme ?? 'Unknown'],
    ),
  }
}

/** desk-2 → Desk 2 */
export function deskLabel(slug: string): string {
  const m = /^desk-(\d+)$/.exec(slug)
  return m ? `Desk ${m[1]}` : slug
}
