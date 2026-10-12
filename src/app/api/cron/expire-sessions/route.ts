/**
 * The 22:00 sign-out, on its own.
 *
 *   GET  /api/cron/expire-sessions?secret=…
 *   POST /api/cron/expire-sessions            Authorization: Bearer $CRON_SECRET
 *
 * Every pay.sessions row carries its own expiry, computed at sign-in for the
 * location's clock, and requireProfile() refuses an expired row on the next
 * request — so the app signs people out at 22:00 whether or not this runs. This
 * job tidies the expired rows away and expires any payment codes left open.
 *
 * The scheduled job is /api/cron/nightly, which does this and then closes the
 * day. This route stays for a manual tidy-up that should not close anything.
 */

import { NextResponse } from 'next/server'
import { authoriseCron } from '@/lib/cron'
import { createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(request: Request): Promise<Response> {
  const denial = authoriseCron(request, 'expire-sessions')
  if (denial) return NextResponse.json({ ok: false, error: denial.message }, { status: denial.status })

  let service
  try {
    service = createServiceClient()
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 })
  }

  const [sessions, orders] = await Promise.all([db(service).rpc('expire_sessions'), db(service).rpc('expire_orders')])
  const errors = [sessions.error?.message, orders.error?.message].filter(Boolean)
  const ok = errors.length === 0
  return NextResponse.json(
    { ok, sessionsExpired: sessions.data ?? 0, ordersExpired: orders.data ?? 0, errors },
    { status: ok ? 200 : 500 },
  )
}

export async function GET(request: Request) {
  return handle(request)
}
export async function POST(request: Request) {
  return handle(request)
}
