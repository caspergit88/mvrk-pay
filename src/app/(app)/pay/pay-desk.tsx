'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, EmptyState, StatusChip } from '@/components/ui'
import { inputClass } from '@/components/forms'
import { money, timeOnly } from '@/lib/format'
import type { DisplayStatus } from '@/lib/types'

/**
 * The live payment screen — a port of reference/mvrk-qr-desk/src/pages/staff.html.
 *
 * One card to take a payment, one to watch it, the recent list, the display
 * link. State comes from /api/desks/[desk]/state; a Realtime broadcast on the
 * desk's channel says when to refetch, and polling covers the gaps. While a
 * code is waiting the screen asks the server to check with the provider every
 * 4 s (the server de-duplicates with the display's own checks).
 */

type DeskOption = { id: string; slug: string; name: string; locationName: string; locationSlug: string; displayKey: string; wifiSsid: string | null; timezone: string }

type Tx = {
  id: string
  status: 'waiting' | 'paid' | 'closed' | 'refunded'
  closed_reason: string | null
  display_status: DisplayStatus
  amount_minor: number
  currency: string
  note: string
  booking_ref: string
  cashier_name: string
  merchant_ref: string
  pay_url: string
  qr_svg: string
  failed_attempts: number
  card_scheme: string | null
  card_last4: string | null
  last_error: string | null
  last_checked_at: string | null
  created_at: string
  paid_at: string | null
  expires_at: string
}

type Snapshot = { version: number; current: Tx | null; recent: Tx[]; businessDate: string }

const POLL_MS = 6_000
const CHECK_MS = 4_000

export function PayDesk({ desks, deskId, origin, canTakePayments }: { desks: DeskOption[]; deskId: string; origin: string; canTakePayments: boolean }) {
  const router = useRouter()
  const desk = desks.find((d) => d.id === deskId) ?? desks[0]
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [conn, setConn] = useState<'live' | 'polling' | 'off'>('off')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [booking, setBooking] = useState('')
  const [dismissedTx, setDismissedTx] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const r = await fetch(`/api/desks/${desk.id}${path}`, { credentials: 'same-origin', cache: 'no-store', ...init })
      const body = await r.json().catch(() => ({}))
      if (r.status === 401) {
        router.replace('/sign-in?expired=1')
        throw new Error('Signed out')
      }
      if (!r.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${r.status}`)
      return body as Snapshot & { checkError?: string | null; paidAfterAll?: boolean }
    },
    [desk.id, router],
  )

  const refresh = useCallback(async () => {
    try {
      const s = await api('/state')
      setSnap(s)
      setConn((c) => (c === 'off' ? 'polling' : c))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [api])

  // Initial load, Realtime broadcast, polling fallback.
  useEffect(() => {
    refresh()
    const supabase = createClient()
    const channel = supabase
      .channel(`desk:${desk.id}`)
      .on('broadcast', { event: 'state' }, () => refresh())
      .subscribe((status) => setConn(status === 'SUBSCRIBED' ? 'live' : 'polling'))
    const poll = setInterval(refresh, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [desk.id, refresh])

  // While a code is waiting, ask the server to check with the provider.
  const waiting = snap?.current?.status === 'waiting'
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(async () => {
      try {
        const s = await api('/check', { method: 'POST' })
        setSnap(s)
      } catch {
        /* the next poll will say */
      }
    }, CHECK_MS)
    return () => clearInterval(t)
  }, [waiting, api])

  async function showQr() {
    setError(null)
    if (!amount.trim()) {
      amountRef.current?.focus()
      return
    }
    if (snap?.current?.status === 'waiting' && !confirmReplace) {
      setConfirmReplace(true)
      setTimeout(() => setConfirmReplace(false), 6000)
      return
    }
    setConfirmReplace(false)
    setBusy(true)
    try {
      const s = await api('/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, note, bookingRef: booking }) })
      setSnap(s)
      setDismissedTx(null)
      setAmount('')
      setNote('')
      setBooking('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function act(path: string) {
    setBusy(true)
    setError(null)
    try {
      const s = await api(path, { method: 'POST' })
      setSnap(s)
      if (s.checkError) setError(`Status check failed: ${s.checkError}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function checkRecent(id: string) {
    setBusy(true)
    try {
      const r = await fetch(`/api/transactions/${id}/check`, { method: 'POST', credentials: 'same-origin' })
      const body = await r.json()
      if (body.checkError) setError(`Status check failed: ${body.checkError}`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const cur = snap?.current && snap.current.id !== dismissedTx ? snap.current : null
  const displayUrl = `${origin}/display/${desk.locationSlug}/${desk.slug}?key=${desk.displayKey}`

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-stone-900">Take a payment</h1>
        {desks.length > 1 && (
          <select
            value={desk.id}
            onChange={(e) => router.replace(`/pay?desk=${e.target.value}`)}
            className={`${inputClass} ml-auto w-auto`}
            aria-label="Desk"
          >
            {desks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.locationName} · {d.name}
              </option>
            ))}
          </select>
        )}
        <span className={`ml-auto text-xs ${conn === 'live' ? 'text-emerald-700' : conn === 'polling' ? 'text-amber-700' : 'text-stone-400'}`}>
          ● {conn === 'live' ? 'live' : conn === 'polling' ? 'polling' : 'connecting…'}
        </span>
      </div>

      {canTakePayments && (
        <Card>
          <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <span className="text-lg font-semibold text-stone-500">EUR</span>
            <input
              ref={amountRef}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && showQr()}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              aria-label="Amount"
              className="w-full bg-transparent text-3xl font-bold tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
            />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Optional: guest name or what it’s for" className={inputClass} aria-label="Note" />
            <input value={booking} onChange={(e) => setBooking(e.target.value)} maxLength={40} placeholder="KiteHub booking #" className={inputClass} aria-label="KiteHub booking number" />
          </div>
          <button
            type="button"
            onClick={showQr}
            disabled={busy}
            className={`mt-3 w-full rounded-xl px-4 py-3.5 text-lg font-semibold text-white transition disabled:opacity-50 ${confirmReplace ? 'bg-amber-600 hover:bg-amber-500' : 'bg-teal-600 hover:bg-teal-500'}`}
          >
            {confirmReplace ? 'A code is still waiting — tap again to replace it' : 'Show QR on customer display'}
          </button>
          {error && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        </Card>
      )}

      {cur && (
        <Card>
          <div className="flex gap-4">
            <div className="h-24 w-24 shrink-0 rounded-lg bg-white p-1 ring-1 ring-stone-200 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: cur.qr_svg }} />
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold tabular-nums text-stone-900">{money(cur.amount_minor, cur.currency)}</div>
              <div className="truncate text-sm text-stone-500">
                {cur.note}
                {cur.booking_ref && <span className="ml-2 text-stone-400">#{cur.booking_ref}</span>}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <StatusChip status={cur.display_status} />
                <span className="text-stone-600">{stateText(cur)}</span>
              </div>
              <div className="mt-1 text-xs text-stone-400">
                {cur.merchant_ref} · {cur.cashier_name} · {timeOnly(cur.created_at, desk.timezone)}
              </div>
            </div>
          </div>
          {cur.status === 'paid' && <div className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-center text-lg font-semibold text-white">✓ Paid</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton onClick={() => navigator.clipboard?.writeText(cur.pay_url)}>Copy pay link</SmallButton>
            {cur.status === 'waiting' && (
              <>
                <SmallButton onClick={() => act('/check?force=1')} disabled={busy}>
                  Check now
                </SmallButton>
                {canTakePayments && (
                  <SmallButton onClick={() => act('/clear')} disabled={busy} tone="danger">
                    Clear display
                  </SmallButton>
                )}
              </>
            )}
            {cur.status !== 'waiting' && (
              <SmallButton
                onClick={() => {
                  setDismissedTx(cur.id)
                  amountRef.current?.focus()
                }}
              >
                New payment
              </SmallButton>
            )}
          </div>
        </Card>
      )}

      <Card title={`Recent on ${desk.name}${snap ? ` · ${snap.recent.length}` : ''}`}>
        {!snap ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : snap.recent.length === 0 ? (
          <EmptyState title="Nothing yet today" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {snap.recent.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold tabular-nums text-stone-900">{money(t.amount_minor, t.currency)}</div>
                  <div className="truncate text-xs text-stone-500">
                    {timeOnly(t.created_at, desk.timezone)} · {t.cashier_name}
                    {t.note && ` · ${t.note}`}
                    {t.booking_ref && ` · #${t.booking_ref}`}
                    {t.card_last4 && ` · ${t.card_scheme ?? ''} ${t.card_last4}`}
                  </div>
                </div>
                <StatusChip status={t.display_status} />
                {t.status !== 'paid' && t.status !== 'refunded' && (
                  <SmallButton onClick={() => checkRecent(t.id)} disabled={busy}>
                    Check
                  </SmallButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-sm">
        <summary className="cursor-pointer font-medium text-stone-800">Customer display ({desk.locationName} · {desk.name})</summary>
        <p className="mt-2 text-stone-600">Open this link once on the customer-facing iPad, add it to the Home Screen, and leave it open. It updates itself.</p>
        <code className="mt-2 block break-all rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">{displayUrl}</code>
        <div className="mt-2 flex gap-2">
          <SmallButton onClick={() => navigator.clipboard?.writeText(displayUrl)}>Copy link</SmallButton>
          <SmallButton onClick={() => window.open(displayUrl, `display-${desk.id}`)}>Open</SmallButton>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          {desk.wifiSsid
            ? `Guest Wi-Fi: the display offers “${desk.wifiSsid}” — a join code on the idle screen and a “No internet?” button during payment.`
            : 'Guest Wi-Fi: not set up for this location (Settings → Locations).'}
        </p>
      </details>
    </div>
  )
}

function stateText(t: Tx): string {
  if (t.status === 'paid') return `Paid${t.card_last4 ? ` · ${t.card_scheme ?? ''} ····${t.card_last4}` : ''}`
  if (t.status === 'refunded') return 'Refunded at the provider'
  if (t.status === 'waiting') {
    if (t.last_error) return 'Status check failing — the code still works; use Check now'
    if (t.failed_attempts > 0) return `Card declined ${t.failed_attempts}× — they can try again`
    return 'Waiting for the customer…'
  }
  if (t.closed_reason === 'expired') return 'Code expired'
  if (t.closed_reason === 'replaced') return 'Replaced by a new code'
  return t.last_checked_at ? 'Cleared — not paid' : 'Cleared — not confirmed with the provider'
}

function SmallButton({ children, onClick, disabled, tone = 'default' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: 'default' | 'danger' }) {
  const cls = tone === 'danger' ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-stone-300 text-stone-700 hover:bg-stone-50'
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`rounded-lg border bg-white px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  )
}
