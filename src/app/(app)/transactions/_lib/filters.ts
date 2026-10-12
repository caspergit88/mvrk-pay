import type { SupabaseClient } from '@supabase/supabase-js'
import { db } from '@/lib/supabase/db'
import { todayAt } from '@/lib/format'
import type { DisplayStatus } from '@/lib/types'

/**
 * The transaction list and its CSV export read the same filters from the query
 * string, so what finance sees is exactly what they download.
 */

export const STATUSES: DisplayStatus[] = ['Paid', 'Refunded', 'Waiting', 'Declined', 'Not confirmed', 'Expired', 'Replaced', 'Unpaid']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type Filters = {
  location: string | null
  from: string
  to: string
  status: DisplayStatus | null
  cashier: string
  q: string
  late: boolean
}

export function readFilters(params: Record<string, string | string[] | undefined>, timezone = 'Africa/Cairo'): Filters {
  const one = (k: string) => {
    const v = params[k]
    return (Array.isArray(v) ? v[0] : v) ?? ''
  }
  const today = todayAt(timezone)
  const weekAgo = new Date(`${today}T00:00:00Z`)
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6)
  const to = DATE.test(one('to')) ? one('to') : today
  const from = DATE.test(one('from')) ? one('from') : weekAgo.toISOString().slice(0, 10)
  const status = one('status')
  return {
    location: one('location') || null,
    from: from <= to ? from : to,
    to,
    status: (STATUSES as string[]).includes(status) ? (status as DisplayStatus) : null,
    cashier: one('cashier').trim().slice(0, 80),
    q: one('q').trim().slice(0, 80),
    late: one('late') === '1',
  }
}

export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams()
  if (f.location) p.set('location', f.location)
  p.set('from', f.from)
  p.set('to', f.to)
  if (f.status) p.set('status', f.status)
  if (f.cashier) p.set('cashier', f.cashier)
  if (f.q) p.set('q', f.q)
  if (f.late) p.set('late', '1')
  return p.toString()
}

export const LIST_COLUMNS =
  'id, created_at, business_date, location_id, location_name, timezone, desk_slug, merchant_ref, provider_ref, provider_name, cashier_name, note, booking_ref, amount_minor, currency, status, closed_reason, display_status, card_scheme, card_last4, paid_at, late, failed_attempts, provider_id, provider_state, refunded_at'

/** The filtered rows, newest first. RLS limits the rows to what the person may see. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listQuery(client: SupabaseClient<any, any, any>, f: Filters, limit: number) {
  let q = db(client).from('v_transactions').select(LIST_COLUMNS).gte('business_date', f.from).lte('business_date', f.to)
  if (f.location) q = q.eq('location_id', f.location)
  if (f.status) q = q.eq('display_status', f.status)
  if (f.cashier) q = q.ilike('cashier_name', `%${escapeLike(f.cashier)}%`)
  if (f.late) q = q.eq('late', true)
  if (f.q) {
    const term = `%${escapeLike(f.q)}%`
    q = q.or(`merchant_ref.ilike.${term},booking_ref.ilike.${term},note.ilike.${term},provider_ref.ilike.${term},card_last4.ilike.${term}`)
  }
  return q.order('created_at', { ascending: false }).limit(limit)
}

function escapeLike(s: string) {
  // PostgREST's or() splits on commas and parentheses; drop them rather than guess at quoting.
  return s.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim()
}
