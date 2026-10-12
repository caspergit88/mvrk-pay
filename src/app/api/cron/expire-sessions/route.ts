/**
 * The 22:00 sign-out.
 *
 *   GET  /api/cron/expire-sessions?secret=…   (Vercel's scheduler sends GET with the Bearer header)
 *   POST /api/cron/expire-sessions            Authorization: Bearer $CRON_SECRET
 *
 * Every pay.sessions row carries its own expiry, computed at sign-in for the
 * location's clock, and requireProfile() refuses an expired row on the next
 * request — so the app signs people out at 22:00 whether or not this runs. This
 * job tidies the expired rows away and expires any payment codes left open, so
 * a desk never starts the morning with yesterday's code on the display.
 *
 * Scheduled twice (19:05 and 20:05 UTC) to cover Cairo's winter and summer
 * clocks; the second run finds nothing to do.
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function authorise(request: Request): { status: number; message: string } | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return {
        status: 503,
        message: 'CRON_SECRET is not set on this deployment, so the nightly job will not run. Add it in Vercel → Environment Variables and redeploy.',
      }
    }
    console.warn('[cron/expire-sessions] CRON_SECRET is not set — running unauthenticated because this is development.')
    return null
  }
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const query = new URL(request.url).searchParams.get('secret') ?? ''
  if ((bearer && matches(bearer, secret)) || (query && matches(query, secret))) return null
  return { status: 401, message: 'Not authorised.' }
}

async function handle(request: Request): Promise<Response> {
  const denial = authorise(request)
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
