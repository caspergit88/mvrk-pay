/**
 * The nightly job — what happens at 22:00 at each location.
 *
 *   GET  /api/cron/nightly?secret=…           (Vercel's scheduler sends GET with the Bearer header)
 *   POST /api/cron/nightly                    Authorization: Bearer $CRON_SECRET
 *   …?dryRun=1                                says which locations would be closed, changes nothing
 *
 * In order:
 *   1. expire sessions — tidy away the sign-ins that ran out at 22:00
 *   2. expire orders   — any code still waiting on a display is closed as expired
 *   3. close the day   — for every location whose local time is past its logout
 *      time and whose day has no close yet: check the unresolved codes one last
 *      time, write the close, store the PDF, email finance. The same code path
 *      as the End of day button, with `automatic: true` on the record.
 *
 * Scheduled twice (19:05 and 20:05 UTC) to cover Cairo's winter and summer
 * clocks: whichever run lands after 22:00 local does the work and the other
 * finds nothing due. If the desk already pressed End of day, the day is not due
 * and nothing is closed twice.
 */

import { NextResponse } from 'next/server'
import { authoriseCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { closeDay } from '@/lib/report'
import { originOf } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Due = { location_id: string; business_date: string }

async function handle(request: Request): Promise<Response> {
  const denial = authoriseCron(request, 'nightly')
  if (denial) return NextResponse.json({ ok: false, error: denial.message }, { status: denial.status })

  let service
  try {
    service = createServiceClient()
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }

  const errors: string[] = []
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  if (dryRun) {
    const due = await db(service).rpc('locations_due_for_close')
    return NextResponse.json({ ok: !due.error, dryRun: true, wouldClose: due.data ?? [], errors: due.error ? [due.error.message] : [] }, { status: due.error ? 500 : 200 })
  }
  const [sessions, orders] = await Promise.all([db(service).rpc('expire_sessions'), db(service).rpc('expire_orders')])
  if (sessions.error) errors.push(`expire_sessions: ${sessions.error.message}`)
  if (orders.error) errors.push(`expire_orders: ${orders.error.message}`)

  const closes: { location_id: string; business_date: string; close_number?: string; email?: string | null; checks?: number; error?: string }[] = []
  const due = await db(service).rpc('locations_due_for_close')
  if (due.error) {
    errors.push(`locations_due_for_close: ${due.error.message}`)
  } else {
    for (const d of (due.data ?? []) as Due[]) {
      try {
        const r = await closeDay(service, d.location_id, d.business_date, { automatic: true, origin: originOf(request) })
        closes.push({ ...d, close_number: r.close.close_number, email: r.email, checks: r.checks.length })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        closes.push({ ...d, error: message })
        errors.push(`close ${d.location_id} ${d.business_date}: ${message}`)
      }
    }
  }

  const ok = errors.length === 0
  return NextResponse.json(
    { ok, sessionsExpired: sessions.data ?? 0, ordersExpired: orders.data ?? 0, closes, errors },
    { status: ok ? 200 : 500 },
  )
}

export async function GET(request: Request) {
  return handle(request)
}
export async function POST(request: Request) {
  return handle(request)
}
