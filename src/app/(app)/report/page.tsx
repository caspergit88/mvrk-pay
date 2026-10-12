import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { loadReport, reportText } from '@/lib/report'
import { money, shortDate, timeOnly, todayAt } from '@/lib/format'
import { Card, ErrorState, Flag, Note, PageHeader, StatusChip, Table, Td } from '@/components/ui'
import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ActionForm } from '../settings/_components/action-form'
import { ConfirmSubmit } from '../settings/_components/confirm'
import { PrintButton } from './print-button'
import { endOfDay, reopenDay } from './actions'
import type { Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Day report · MVRK Pay' }

/**
 * The end-of-day report, like a card terminal's Z report: one line per code,
 * totals underneath, a signature line. Prints on A4 or as an 80 mm slip. The
 * same data goes into the PDF and the email when the day is closed.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ location?: string; date?: string }> }) {
  const me = await requireProfile()
  const params = await searchParams
  const supabase = await createClient()

  const { data: locData } = await db(supabase).from('locations').select('id, name, slug, timezone').eq('active', true).order('name')
  const locations = (locData ?? []) as Pick<Location, 'id' | 'name' | 'slug' | 'timezone'>[]
  const location = (me.role === 'reception' ? locations.find((l) => l.id === me.location_id) : locations.find((l) => l.id === params.location)) ?? locations[0]
  if (!location) return <ErrorState message="No location is set up." />
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayAt(location.timezone)

  let report
  try {
    report = await loadReport(supabase, location.id, date)
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : String(e)} />
  }
  const tz = report.location.timezone
  const canClose = me.role !== 'finance'
  const canReopen = me.role !== 'reception'
  const isClosed = !!report.close && !report.close.reopened_at
  const unresolved = report.lines.filter((l) => l.display_status === 'Waiting' || l.display_status === 'Not confirmed' || l.display_status === 'Declined').length

  return (
    <>
      <div className="print-hide">
        <PageHeader
          title="Day report"
          subtitle="What the desk took today, to tick off against KiteHub and the provider's portal."
          action={
            <div className="flex flex-wrap gap-2">
              <PrintButton />
              <PrintButton receipt />
            </div>
          }
        />
        <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
          {me.role !== 'reception' && (
            <Field label="Location">
              <select name="location" defaultValue={location.id} className={inputClass}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Date">
            <input type="date" name="date" defaultValue={date} className={inputClass} />
          </Field>
          <button className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-800">Show</button>
          <Link href={`/transactions/export?location=${location.id}&from=${date}&to=${date}`} className="text-sm text-stone-700 underline">
            Download CSV
          </Link>
          <Link href={`/report/pdf?location=${location.id}&date=${date}`} className="text-sm text-stone-700 underline" target="_blank">
            PDF
          </Link>
        </form>
      </div>

      <div className="report space-y-4">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">MVRK Pay · End of day</div>
              <h2 className="text-lg font-semibold text-stone-900">
                {report.location.name} · {shortDate(date)}
              </h2>
              <div className="text-xs text-stone-500">
                Desks {report.desks.join(', ')} · printed {timeOnly(report.generatedAt, tz)} by {me.full_name}
              </div>
            </div>
            <div className="text-right text-sm">
              {isClosed ? (
                <>
                  <Flag tone="good">Closed · {report.close!.close_number}</Flag>
                  <div className="mt-1 text-xs text-stone-500">
                    {timeOnly(report.close!.closed_at, tz)} · {report.close!.automatic ? 'automatic' : report.close!.closed_by_name}
                  </div>
                </>
              ) : report.close?.reopened_at ? (
                <Flag tone="warn">Re-opened: {report.close.reopen_reason}</Flag>
              ) : (
                <Flag tone="info">Open</Flag>
              )}
            </div>
          </div>
        </Card>

        <Card>
          {report.lines.length === 0 ? (
            <p className="text-sm text-stone-500">No payments taken on this day.</p>
          ) : (
            <Table head={['Time', 'Reference', 'Person', 'Note / booking', 'Amount', 'Status', 'Card']}>
              {report.lines.map((l) => (
                <tr key={l.id} className={l.late ? 'bg-amber-50' : ''}>
                  <Td className="whitespace-nowrap">{timeOnly(l.created_at, tz)}</Td>
                  <Td>
                    <div className="font-mono text-xs">{l.merchant_ref}</div>
                    <div className="text-xs text-stone-500">{l.provider_name}</div>
                  </Td>
                  <Td>{l.cashier_name}</Td>
                  <Td>
                    {l.note}
                    {l.booking_ref && <div className="text-xs text-stone-500">#{l.booking_ref}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold tabular-nums">{money(l.amount_minor, l.currency)}</Td>
                  <Td>
                    <StatusChip status={l.display_status} />
                    {l.late && <div className="text-xs text-amber-700">paid after close</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{l.card_last4 ? `${l.card_scheme ?? ''} ····${l.card_last4}` : ''}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Totals">
            {report.totals.length === 0 && <p className="text-sm text-stone-500">—</p>}
            {report.totals.map((t) => (
              <dl key={t.currency} className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
                <dt className="font-semibold">Paid</dt>
                <dd>{t.paid_count}</dd>
                <dd className="text-right font-semibold">{money(t.paid_minor, t.currency)}</dd>
                {t.refunded_count > 0 && (
                  <>
                    <dt>Refunded</dt>
                    <dd>{t.refunded_count}</dd>
                    <dd className="text-right">{money(t.refunded_minor, t.currency)}</dd>
                  </>
                )}
                <dt>Declined attempts</dt>
                <dd>{t.declined_count}</dd>
                <dd />
                <dt>Still open</dt>
                <dd>{t.open_count}</dd>
                <dd />
                <dt>Not confirmed</dt>
                <dd>{t.not_confirmed_count}</dd>
                <dd />
              </dl>
            ))}
            {report.byProvider.length > 1 && (
              <div className="mt-3 border-t border-stone-100 pt-2 text-sm">
                <div className="text-xs font-semibold uppercase text-stone-500">By provider</div>
                {report.byProvider.map((p) => (
                  <div key={p.provider_name + p.currency} className="flex justify-between tabular-nums">
                    <span>
                      {p.provider_name} ({p.paid_count})
                    </span>
                    <span>{money(p.paid_minor, p.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="By person">
            {report.byCashier.length === 0 && <p className="text-sm text-stone-500">—</p>}
            {report.byCashier.map((c) => (
              <div key={c.cashier_name + c.currency} className="flex justify-between text-sm tabular-nums">
                <span>
                  {c.cashier_name} ({c.paid_count})
                </span>
                <span className="font-semibold">{money(c.paid_minor, c.currency)}</span>
              </div>
            ))}
            {report.lateFromEarlierDays.length > 0 && (
              <div className="mt-3 border-t border-stone-100 pt-2 text-sm">
                <div className="text-xs font-semibold uppercase text-amber-700">Paid today for earlier, closed days</div>
                {report.lateFromEarlierDays.map((l) => (
                  <div key={l.id} className="flex justify-between tabular-nums">
                    <span>
                      {shortDate(l.business_date)} · {l.merchant_ref}
                    </span>
                    <span>{money(l.amount_minor, l.currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-stone-700">
            <span>☐ Matches KiteHub / provider portal</span>
            <span>Signed: ______________________</span>
          </div>
        </Card>

        {/* The slip version: plain monospace text, shown only when printing at receipt width. */}
        <pre className="receipt-only whitespace-pre-wrap font-mono text-[11px] leading-tight">{reportText(report)}</pre>
      </div>

      <div className="print-hide mt-4 space-y-4">
        {canClose && !isClosed && (
          <Card title="End of day">
            {unresolved > 0 && (
              <Note tone="warn">
                {unresolved} code{unresolved === 1 ? '' : 's'} not yet confirmed. End of day checks each one with the provider first; anything still unanswered stays &ldquo;Not confirmed&rdquo; on the report.
              </Note>
            )}
            <ActionForm action={endOfDay} className="mt-3">
              <input type="hidden" name="location_id" value={location.id} />
              <input type="hidden" name="date" value={date} />
              <ConfirmSubmit
                label="End of day"
                confirmLabel="Close the day"
                consequence={`This closes ${shortDate(date)} at ${report.location.name}, saves the PDF and ${report.location.finance_email ? `emails it to ${report.location.finance_email}` : 'sends nothing (no finance email is set)'}. Later payments are flagged as late.`}
                variant="primary"
                pendingLabel="Checking and closing…"
              />
            </ActionForm>
          </Card>
        )}
        {canReopen && isClosed && (
          <Card title="Re-open the day">
            <ActionForm action={reopenDay} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="location_id" value={location.id} />
              <input type="hidden" name="date" value={date} />
              <Field label="Reason">
                <input name="reason" required className={`${inputClass} w-72`} placeholder="e.g. a payment was taken after the close" />
              </Field>
              <SubmitButton variant="secondary" pendingLabel="…">
                Re-open
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  )
}
