import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { dateTime, money, shortDate } from '@/lib/format'
import { Card, EmptyState, ErrorState, Flag, Note, PageHeader, Stat, StatusChip, Table, Td } from '@/components/ui'
import { Field, inputClass } from '@/components/forms'
import { STATUSES, filtersToQuery, listQuery, readFilters } from './_lib/filters'
import { RecheckButton } from './recheck-button'
import type { DisplayStatus, Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transactions · MVRK Pay' }

const LIMIT = 500

type Row = {
  id: string
  created_at: string
  business_date: string
  location_id: string
  location_name: string
  timezone: string
  desk_slug: string
  merchant_ref: string
  provider_ref: string
  provider_name: string
  cashier_name: string
  note: string
  booking_ref: string
  amount_minor: number
  currency: string
  status: string
  display_status: DisplayStatus
  card_scheme: string | null
  card_last4: string | null
  paid_at: string | null
  late: boolean
  failed_attempts: number
}

type Totals = { currency: string; paid_count: number; paid_minor: number; refunded_count: number; refunded_minor: number; not_confirmed_count: number }

/**
 * Every transaction the person may see, filtered the way finance works: a
 * location (or all), a date range, a status, a person, a reference. The CSV
 * link downloads exactly this list. Reception gets the same page limited to
 * their own location by RLS.
 */
export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile()
  const params = await searchParams
  const supabase = await createClient()

  const { data: locData } = await db(supabase).from('locations').select('id, name, slug, timezone').eq('active', true).order('name')
  const locations = (locData ?? []) as Pick<Location, 'id' | 'name' | 'slug' | 'timezone'>[]
  const mine = me.role === 'reception' ? locations.find((l) => l.id === me.location_id) : undefined
  const filters = readFilters(params, (mine ?? locations[0])?.timezone)
  if (mine) filters.location = mine.id

  const [list, totals] = await Promise.all([
    listQuery(supabase, filters, LIMIT),
    db(supabase).rpc('range_totals', { p_location: filters.location, p_from: filters.from, p_to: filters.to }),
  ])
  if (list.error) return <ErrorState message={list.error.message} />
  const rows = (list.data ?? []) as unknown as Row[]
  const sums = (totals.data ?? []) as Totals[]
  const query = filtersToQuery(filters)
  const unresolved = rows.filter((r) => r.display_status === 'Waiting' || r.display_status === 'Declined' || r.display_status === 'Not confirmed')

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={me.role === 'finance' ? 'Every location. Filter, then download the same list as CSV.' : 'Filter, then download the same list as CSV.'}
        action={
          <Link href={`/transactions/export?${query}`} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
            Download CSV
          </Link>
        }
      />

      <form method="get" className="mb-4 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        {!mine && (
          <Field label="Location">
            <select name="location" defaultValue={filters.location ?? ''} className={inputClass}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="From">
          <input type="date" name="from" defaultValue={filters.from} className={inputClass} />
        </Field>
        <Field label="To">
          <input type="date" name="to" defaultValue={filters.to} className={inputClass} />
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={filters.status ?? ''} className={inputClass}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Person">
          <input name="cashier" defaultValue={filters.cashier} placeholder="Name" className={inputClass} />
        </Field>
        <Field label="Reference">
          <input name="q" defaultValue={filters.q} placeholder="Ref, booking, note, last 4" className={inputClass} />
        </Field>
        <div className="flex items-end gap-3 sm:col-span-3 lg:col-span-6">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" name="late" value="1" defaultChecked={filters.late} className="h-4 w-4 rounded border-stone-300" />
            Only payments that landed after their day was closed
          </label>
          <button className="ml-auto rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">Show</button>
        </div>
      </form>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {sums.length === 0 ? (
          <Stat label="Paid" value={money(0)} hint={`${shortDate(filters.from)} – ${shortDate(filters.to)}`} />
        ) : (
          sums.map((t) => (
            <Stat key={t.currency} label={`Paid · ${t.currency}`} value={money(t.paid_minor, t.currency)} hint={`${t.paid_count} payment${t.paid_count === 1 ? '' : 's'} · ${shortDate(filters.from)} – ${shortDate(filters.to)}`} tone="good" />
          ))
        )}
        {sums.some((t) => t.refunded_count > 0) &&
          sums
            .filter((t) => t.refunded_count > 0)
            .map((t) => <Stat key={'r' + t.currency} label={`Refunded · ${t.currency}`} value={money(t.refunded_minor, t.currency)} hint={`${t.refunded_count} refund${t.refunded_count === 1 ? '' : 's'}`} />)}
        <Stat
          label="Not confirmed"
          value={sums.reduce((n, t) => n + Number(t.not_confirmed_count), 0)}
          hint="Left the display without a clean answer from the provider"
          tone={sums.some((t) => Number(t.not_confirmed_count) > 0) ? 'warn' : 'default'}
        />
      </div>

      {unresolved.length > 0 && (
        <div className="mb-4">
          <Note tone="warn">
            {unresolved.length} code{unresolved.length === 1 ? '' : 's'} in this list {unresolved.length === 1 ? 'is' : 'are'} not settled. <strong>Re-check</strong> asks the provider again; a code paid in its last minute turns up as Paid.
          </Note>
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing matches" description="Widen the dates or clear a filter." />
        ) : (
          <>
            <Table head={['When', 'Location · desk', 'Reference', 'Person', 'Note / booking', 'Amount', 'Status', 'Card', '']}>
              {rows.map((r) => (
                <tr key={r.id} className={r.late ? 'bg-amber-50' : ''}>
                  <Td className="whitespace-nowrap">
                    <div>{dateTime(r.created_at, r.timezone)}</div>
                    {r.business_date !== r.created_at.slice(0, 10) && <div className="text-xs text-stone-500">day {shortDate(r.business_date)}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <div>{r.location_name}</div>
                    <div className="text-xs text-stone-500">{r.desk_slug}</div>
                  </Td>
                  <Td>
                    <div className="font-mono text-xs">{r.merchant_ref}</div>
                    <div className="text-xs text-stone-500">{r.provider_name}</div>
                  </Td>
                  <Td>{r.cashier_name}</Td>
                  <Td>
                    {r.note}
                    {r.booking_ref && <div className="text-xs text-stone-500">#{r.booking_ref}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(r.amount_minor, r.currency)}</Td>
                  <Td>
                    <StatusChip status={r.display_status} />
                    {r.late && (
                      <div className="mt-1">
                        <Flag tone="warn">after close</Flag>
                      </div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{r.card_last4 ? `${r.card_scheme ?? ''} ····${r.card_last4}` : ''}</Td>
                  <Td>{r.display_status !== 'Paid' && r.display_status !== 'Refunded' && <RecheckButton id={r.id} />}</Td>
                </tr>
              ))}
            </Table>
            {rows.length >= LIMIT && <p className="mt-3 text-xs text-stone-500">Showing the newest {LIMIT}. Narrow the dates to see the rest, or download the CSV, which has no limit.</p>}
          </>
        )}
      </Card>
    </>
  )
}
