import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { dateTime, money, shortDate, todayAt } from '@/lib/format'
import { deskLabel, summariseRange, type Group, type RangeRow, type Tally } from '@/lib/range-report'
import { Card, ErrorState, Note, StatusChip, Table, Td } from '@/components/ui'
import { Field, inputClass } from '@/components/forms'
import type { Location } from '@/lib/types'
import { PrintButton } from './print-button'
import { ModeSwitch } from './mode-switch'

const DATE = /^\d{4}-\d{2}-\d{2}$/
/** A year at most, so one click cannot pull the whole history into a page. */
const MAX_DAYS = 366
const PAGE = 1000
const MAX_ROWS = 20_000
/** Lines listed on the page; the CSV has all of them. */
const SHOW_LINES = 300

const COLUMNS =
  'id, created_at, business_date, location_id, location_name, desk_slug, merchant_ref, provider_name, cashier_name, note, booking_ref, amount_minor, currency, display_status, card_scheme, card_last4, paid_at, late'

function shiftDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The sales report over a date range — Admin, Manager and Finance, for
 * looking into more than one day. One location or all of them. Reads
 * pay.v_transactions through RLS, the same rows as the transaction list.
 */
export async function RangeView({
  locations,
  params,
}: {
  locations: Pick<Location, 'id' | 'name' | 'slug' | 'timezone'>[]
  params: { location?: string; from?: string; to?: string }
}) {
  const tz = locations[0]?.timezone ?? 'Africa/Cairo'
  const today = todayAt(tz)
  let to = DATE.test(params.to ?? '') ? params.to! : today
  let from = DATE.test(params.from ?? '') ? params.from! : shiftDays(to, -6)
  if (from > to) [from, to] = [to, from]
  let clamped = false
  if (shiftDays(from, MAX_DAYS - 1) < to) {
    from = shiftDays(to, -(MAX_DAYS - 1))
    clamped = true
  }
  const location = locations.find((l) => l.id === params.location) ?? null

  const supabase = await createClient()
  const rows: RangeRow[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = db(supabase).from('v_transactions').select(COLUMNS).gte('business_date', from).lte('business_date', to)
    if (location) q = q.eq('location_id', location.id)
    const { data, error } = await q.order('created_at', { ascending: false }).range(offset, offset + PAGE - 1)
    if (error) return <ErrorState message={error.message} />
    const batch = (data ?? []) as unknown as RangeRow[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  const truncated = rows.length >= MAX_ROWS
  const r = summariseRange(rows, from, to)
  const query = new URLSearchParams({ from, to, ...(location ? { location: location.id } : {}) }).toString()
  const many = !location

  // Quick ranges, relative to today at the locations.
  const monthStart = today.slice(0, 8) + '01'
  const lastMonthEnd = shiftDays(monthStart, -1)
  const presets: [string, string, string][] = [
    ['Last 7 days', shiftDays(today, -6), today],
    ['Last 30 days', shiftDays(today, -29), today],
    ['This month', monthStart, today],
    ['Last month', lastMonthEnd.slice(0, 8) + '01', lastMonthEnd],
  ]
  const presetHref = (f: string, t: string) =>
    `/report?${new URLSearchParams({ mode: 'range', from: f, to: t, ...(location ? { location: location.id } : {}) }).toString()}`

  return (
    <>
      <div className="print-hide">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Sales report</h1>
            <p className="mt-0.5 text-sm text-stone-500">Any date range, one location or all — for looking into more than a day.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintButton />
          </div>
        </div>
        <ModeSwitch mode="range" />
        <form className="mb-2 flex flex-wrap items-end gap-3" method="get">
          <input type="hidden" name="mode" value="range" />
          <Field label="Location">
            <select name="location" defaultValue={location?.id ?? ''} className={inputClass}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" name="from" defaultValue={from} max={today} className={inputClass} />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={to} max={today} className={inputClass} />
          </Field>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">Show</button>
          <Link href={`/transactions/export?${query}`} className="text-sm text-stone-700 underline">
            Download CSV
          </Link>
          <Link href={`/transactions?${query}`} className="text-sm text-stone-700 underline">
            Open in Transactions
          </Link>
        </form>
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {presets.map(([label, f, t]) => (
            <Link
              key={label}
              href={presetHref(f, t)}
              className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${f === from && t === to ? 'bg-stone-900 text-white ring-stone-900' : 'text-stone-700 ring-stone-300 hover:bg-stone-100'}`}
            >
              {label}
            </Link>
          ))}
        </div>
        {clamped && <Note tone="warn">A report covers a year at most; the start date was moved to {shortDate(from)}.</Note>}
        {truncated && <Note tone="warn">More than {MAX_ROWS.toLocaleString()} codes in this range; the figures cover the newest {MAX_ROWS.toLocaleString()}. Pick a shorter range.</Note>}
      </div>

      <div className="report space-y-4">
        <Card>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">MVRK Pay · Sales report</div>
          <h2 className="text-lg font-semibold text-stone-900">
            {location?.name ?? 'All locations'} · {shortDate(from)} – {shortDate(to)}
          </h2>
          <div className="text-xs text-stone-500">
            {r.days} day{r.days === 1 ? '' : 's'} · {r.codes} payment code{r.codes === 1 ? '' : 's'}
          </div>
        </Card>

        {r.codes === 0 ? (
          <Card>
            <p className="text-sm text-stone-500">No payments in this range.</p>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Totals">
                {r.totals.map((t) => {
                  const stats = r.paidStats.find((s) => s.currency === t.currency)
                  return (
                    <dl key={t.currency} className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                      <dt className="font-semibold">Paid</dt>
                      <dd>{t.paid_count}</dd>
                      <dd className="text-right font-semibold">{money(t.paid_minor, t.currency)}</dd>
                      {t.refunded_count > 0 && (
                        <>
                          <dt>Refunded</dt>
                          <dd>{t.refunded_count}</dd>
                          <dd className="text-right">−{money(t.refunded_minor, t.currency)}</dd>
                          <dt className="font-semibold">Net</dt>
                          <dd />
                          <dd className="text-right font-semibold">{money(t.net_minor, t.currency)}</dd>
                        </>
                      )}
                      <dt>Not paid</dt>
                      <dd>{t.unpaid_count}</dd>
                      <dd className="text-right text-stone-500">{money(t.unpaid_minor, t.currency)}</dd>
                      {stats && (
                        <>
                          <dt>Average payment</dt>
                          <dd />
                          <dd className="text-right">{money(stats.average_minor, t.currency)}</dd>
                          <dt>Largest payment</dt>
                          <dd />
                          <dd className="text-right">{money(stats.largest_minor, t.currency)}</dd>
                        </>
                      )}
                    </dl>
                  )
                })}
              </Card>
              <Card title="By status">
                <div className="flex flex-wrap gap-2">
                  {r.statusCounts.map((s) => (
                    <Link key={s.status} href={`/transactions?${query}&status=${encodeURIComponent(s.status)}`} className="flex items-center gap-1.5 text-sm">
                      <StatusChip status={s.status} />
                      <span className="tabular-nums">{s.count}</span>
                    </Link>
                  ))}
                </div>
                <p className="mt-3 text-xs text-stone-500">“Not paid” is every code that ended without money: declined, expired, replaced, unpaid, not confirmed or still waiting. Click a status to list those codes.</p>
              </Card>
            </div>

            <Card title="By day">
              <GroupTable
                groups={r.byDay}
                label="Day"
                render={(g) => (
                  <Link className="underline" href={`/report?${new URLSearchParams({ date: g.key, ...(location ? { location: location.id } : {}) }).toString()}`}>
                    {shortDate(g.key)}
                  </Link>
                )}
              />
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              {many && r.byLocation.length > 0 && (
                <Card title="By location">
                  <GroupTable groups={r.byLocation} label="Location" />
                </Card>
              )}
              <Card title="By desk">
                <GroupTable groups={r.byDesk} label="Desk" render={(g) => (many ? g.label : deskLabel(g.key.split(':')[1] ?? g.label))} />
              </Card>
              <Card title="By person">
                <GroupTable groups={r.byPerson} label="Person" />
              </Card>
              {r.byProvider.length > 1 && (
                <Card title="By provider">
                  <GroupTable groups={r.byProvider} label="Provider" />
                </Card>
              )}
              {r.byCard.length > 0 && (
                <Card title="Paid by card type">
                  <GroupTable groups={r.byCard} label="Card" compact />
                </Card>
              )}
            </div>

            <Card title={`Payment codes${r.codes > SHOW_LINES ? ` — newest ${SHOW_LINES} of ${r.codes}` : ''}`}>
              <Table head={['When', ...(many ? ['Location'] : []), 'Desk', 'Reference', 'Person', 'Note / booking', 'Amount', 'Status', 'Card']}>
                {rows.slice(0, SHOW_LINES).map((l) => (
                  <tr key={l.id} className={l.late ? 'bg-amber-50' : ''}>
                    <Td className="whitespace-nowrap text-xs">{dateTime(l.created_at, tz)}</Td>
                    {many && <Td>{l.location_name}</Td>}
                    <Td className="whitespace-nowrap">{deskLabel(l.desk_slug)}</Td>
                    <Td className="font-mono text-xs">{l.merchant_ref}</Td>
                    <Td>{l.cashier_name}</Td>
                    <Td>
                      {l.note}
                      {l.booking_ref && <div className="text-xs text-stone-500">#{l.booking_ref}</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(l.amount_minor, l.currency)}</Td>
                    <Td>
                      <StatusChip status={l.display_status} />
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{l.card_last4 ? `${l.card_scheme ?? ''} ····${l.card_last4}` : ''}</Td>
                  </tr>
                ))}
              </Table>
              {r.codes > SHOW_LINES && (
                <p className="mt-2 text-xs text-stone-500">
                  The rest are in the{' '}
                  <Link href={`/transactions/export?${query}`} className="underline">
                    CSV
                  </Link>{' '}
                  and on the{' '}
                  <Link href={`/transactions?${query}`} className="underline">
                    Transactions
                  </Link>{' '}
                  page.
                </p>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  )
}

/** One row per group and currency: paid, refunded, net, not paid. */
function GroupTable({ groups, label, render, compact = false }: { groups: Group[]; label: string; render?: (g: Group) => React.ReactNode; compact?: boolean }) {
  const refunds = groups.some((g) => g.tallies.some((t) => t.refunded_count > 0))
  const head = compact ? [label, 'Paid', 'Amount'] : [label, 'Paid', 'Amount', ...(refunds ? ['Refunded', 'Net'] : []), 'Not paid']
  const cell = (t: Tally) =>
    compact ? (
      <>
        <Td className="text-right tabular-nums">{t.paid_count}</Td>
        <Td className="text-right font-semibold tabular-nums">{money(t.paid_minor, t.currency)}</Td>
      </>
    ) : (
      <>
        <Td className="text-right tabular-nums">{t.paid_count}</Td>
        <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(t.paid_minor, t.currency)}</Td>
        {refunds && (
          <>
            <Td className="whitespace-nowrap text-right tabular-nums">{t.refunded_minor ? `−${money(t.refunded_minor, t.currency)}` : ''}</Td>
            <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(t.net_minor, t.currency)}</Td>
          </>
        )}
        <Td className="text-right tabular-nums text-stone-500">{t.unpaid_count || ''}</Td>
      </>
    )
  return (
    <Table head={head}>
      {groups.flatMap((g) =>
        g.tallies.map((t, i) => (
          <tr key={`${g.key}-${t.currency}`} className="border-b border-stone-100 last:border-0">
            <Td className="whitespace-nowrap">{i === 0 ? (render ? render(g) : g.label) : ''}</Td>
            {cell(t)}
          </tr>
        )),
      )}
    </Table>
  )
}
