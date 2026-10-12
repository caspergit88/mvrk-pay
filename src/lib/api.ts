import { NextResponse } from 'next/server'
import { PaymentError } from '@/lib/payments'
import { ProviderError } from '@/lib/providers'

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function fail(error: string, status = 400, detail?: unknown) {
  return json({ ok: false, error, detail: trim(detail) }, status)
}

function trim(detail: unknown) {
  if (detail === undefined || detail === null) return undefined
  const s = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return s.length > 600 ? s.slice(0, 600) + '…' : s
}

/** Route handlers wrap their body in this so every failure is a readable JSON answer. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof PaymentError) return fail(e.message, e.status, e.detail)
    if (e instanceof ProviderError) return fail(e.message, 502, e.detail)
    console.error('[api]', e)
    return fail('Something went wrong on the server.', 500)
  }
}

export function originOf(request: Request) {
  const h = request.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? new URL(request.url).host
  return `${proto}://${host}`
}
