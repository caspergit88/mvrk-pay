import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { db } from '@/lib/supabase/db'
import { checkTransaction, serviceOrNull, PaymentError } from '@/lib/payments'
import { sendEmail } from '@/lib/email'
import { money, shortDate, timeOnly } from '@/lib/format'
import type { DisplayStatus } from '@/lib/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

export type ReportLine = {
  id: string
  created_at: string
  merchant_ref: string
  provider_name: string
  cashier_name: string
  note: string
  booking_ref: string
  amount_minor: number
  currency: string
  status: string
  closed_reason: string | null
  display_status: DisplayStatus
  card_scheme: string | null
  card_last4: string | null
  paid_at: string | null
  late: boolean
  desk_slug: string
}

export type ReportData = {
  location: { id: string; name: string; slug: string; timezone: string; finance_email: string | null }
  date: string
  desks: string[]
  lines: ReportLine[]
  byProvider: { provider_name: string; currency: string; paid_count: number; paid_minor: number; refunded_count: number; refunded_minor: number }[]
  byCashier: { cashier_name: string; currency: string; paid_count: number; paid_minor: number }[]
  totals: { currency: string; paid_count: number; paid_minor: number; refunded_count: number; refunded_minor: number; declined_count: number; open_count: number; not_confirmed_count: number; late_count: number }[]
  close: { id: string; close_number: string; closed_at: string; automatic: boolean; reopened_at: string | null; reopen_reason: string | null; report_path: string | null; closed_by_name: string | null } | null
  lateFromEarlierDays: { id: string; business_date: string; paid_at: string; merchant_ref: string; cashier_name: string; amount_minor: number; currency: string; card_last4: string | null }[]
  generatedAt: string
}

export async function loadReport(client: Client, locationId: string, date: string): Promise<ReportData> {
  const { data, error } = await db(client).rpc('report_data', { p_location: locationId, p_date: date })
  if (error) throw new PaymentError(error.message, error.code === '42501' ? 403 : 400)
  return data as ReportData
}

/**
 * End of day. Check everything unresolved first (a code paid in its last
 * minute must not be closed as unpaid), then close, then the PDF and the email.
 * `client` is the person's client (so the close is in their name) or the
 * service client for the automatic 22:00 close.
 */
export async function closeDay(client: Client, locationId: string, date: string, opts: { automatic: boolean; origin?: string }) {
  const { data: unresolved } = await db(client).rpc('unresolved_for_day', { p_location: locationId, p_date: date })
  const checks: string[] = []
  for (const tx of (unresolved ?? []) as { id: string; status: string }[]) {
    try {
      const r = await checkTransaction(client, tx as never, { force: true })
      if (!r.skipped && r.error) checks.push(`${tx.id.slice(0, 8)}: ${r.error}`)
    } catch (e) {
      checks.push(`${tx.id.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const { data: close, error } = await db(client).rpc('close_day', { p_location: locationId, p_date: date, p_automatic: opts.automatic })
  if (error) throw new PaymentError(error.message, 400)
  const closed = close as { id: string; close_number: string }

  const report = await loadReport(client, locationId, date)
  const pdf = await reportPdf(report)

  // The PDF and the email need the service role (Storage write, email_log); both are best effort.
  const service = serviceOrNull()
  let reportPath: string | null = null
  let email: string | null = null
  if (service) {
    const path = `${report.location.slug}/${date}-${closed.close_number}.pdf`
    const up = await service.storage.from('pay-reports').upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (!up.error) {
      reportPath = path
      await db(service).rpc('set_report_path', { p_close: closed.id, p_path: path })
    }
    if (report.location.finance_email) {
      const r = await sendEmail(service, {
        kind: 'end_of_day',
        locationId,
        to: [report.location.finance_email],
        subject: `${report.location.name} — end of day ${date} (${closed.close_number})`,
        text: reportText(report),
        attachments: [{ filename: `${report.location.slug}-${date}.pdf`, content: pdf, contentType: 'application/pdf' }],
        dedupeKey: `end_of_day:${closed.id}:${closed.close_number}`,
      })
      email = r.sent ? `sent to ${report.location.finance_email}` : r.reason
    }
  }
  return { close: closed, checks, reportPath, email }
}

/** The report as plain text — the email body, and the shape of the receipt-width print. */
export function reportText(r: ReportData): string {
  const tz = r.location.timezone
  const L: string[] = []
  L.push(`MVRK PAY — END OF DAY`)
  L.push(`${r.location.name} · ${shortDate(r.date)}`)
  if (r.close) L.push(`Close ${r.close.close_number} · ${r.close.automatic ? 'automatic' : r.close.closed_by_name ?? ''} · ${timeOnly(r.close.closed_at, tz)}`)
  L.push(`Desks: ${r.desks.join(', ')}`)
  L.push('-'.repeat(48))
  for (const l of r.lines) {
    const status = l.display_status.toUpperCase()
    const card = l.card_last4 ? ` ${l.card_scheme ?? ''} ${l.card_last4}`.trimEnd() : ''
    L.push(`${timeOnly(l.created_at, tz)}  ${money(l.amount_minor, l.currency).padStart(14)}  ${status}${card}`)
    L.push(`      ${l.merchant_ref} · ${l.cashier_name}${l.booking_ref ? ` · #${l.booking_ref}` : ''}${l.note ? ` · ${l.note}` : ''}${l.late ? ' · LATE' : ''}`)
  }
  if (r.lines.length === 0) L.push('No payments taken.')
  L.push('-'.repeat(48))
  for (const t of r.totals) {
    L.push(`PAID         ${String(t.paid_count).padStart(3)}  ${money(t.paid_minor, t.currency).padStart(14)}`)
    if (t.refunded_count) L.push(`REFUNDED     ${String(t.refunded_count).padStart(3)}  ${money(t.refunded_minor, t.currency).padStart(14)}`)
    L.push(`DECLINED     ${String(t.declined_count).padStart(3)}`)
    L.push(`OPEN         ${String(t.open_count).padStart(3)}`)
    L.push(`NOT CONFIRMED${String(t.not_confirmed_count).padStart(3)}`)
  }
  if (r.byProvider.length > 1) {
    L.push('By provider:')
    for (const p of r.byProvider) L.push(`  ${p.provider_name.padEnd(22)} ${String(p.paid_count).padStart(3)}  ${money(p.paid_minor, p.currency).padStart(14)}`)
  }
  if (r.byCashier.length) {
    L.push('By person:')
    for (const c of r.byCashier) L.push(`  ${c.cashier_name.padEnd(22)} ${String(c.paid_count).padStart(3)}  ${money(c.paid_minor, c.currency).padStart(14)}`)
  }
  if (r.lateFromEarlierDays.length) {
    L.push('-'.repeat(48))
    L.push('Paid today for earlier, closed days:')
    for (const l of r.lateFromEarlierDays) L.push(`  ${shortDate(l.business_date)}  ${money(l.amount_minor, l.currency).padStart(12)}  ${l.merchant_ref}`)
  }
  L.push('-'.repeat(48))
  L.push('Matches KiteHub / provider portal:  [ ]      Signed: ______________')
  L.push(`Printed ${timeOnly(r.generatedAt, tz)}`)
  return L.join('\n')
}

/** The slip as a PDF: monospace lines on A4, page breaks as needed. */
export async function reportPdf(r: ReportData): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Courier)
  const bold = await doc.embedFont(StandardFonts.CourierBold)
  const size = 9.5
  const lineHeight = 12.5
  const margin = 40
  const [w, h] = [595.28, 841.89]
  let page = doc.addPage([w, h])
  let y = h - margin
  const lines = reportText(r).split('\n')
  lines.forEach((text, i) => {
    if (y < margin) {
      page = doc.addPage([w, h])
      y = h - margin
    }
    page.drawText(text.replace(/[^\x20-\x7E·—]/g, '?').replace(/[·—]/g, '-'), { x: margin, y, size, font: i === 0 ? bold : font, color: rgb(0, 0, 0) })
    y -= lineHeight
  })
  return Buffer.from(await doc.save())
}

/** CSV for finance: one row per transaction, the same columns as the report plus references. */
export function toCsv(lines: (ReportLine & { location_name?: string; business_date?: string; provider_ref?: string })[]): string {
  const cols = ['business_date', 'location_name', 'desk_slug', 'created_at', 'merchant_ref', 'provider_name', 'provider_ref', 'cashier_name', 'note', 'booking_ref', 'amount', 'currency', 'status', 'card_scheme', 'card_last4', 'paid_at', 'late']
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = lines.map((l) =>
    cols
      .map((c) => {
        if (c === 'amount') return (l.amount_minor / 100).toFixed(2)
        if (c === 'status') return l.display_status
        return esc((l as unknown as Record<string, unknown>)[c])
      })
      .join(','),
  )
  return [cols.join(','), ...rows].join('\n') + '\n'
}
