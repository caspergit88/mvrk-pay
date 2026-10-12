'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { qrSvg, wifiQrText } from '@/lib/qr'

/**
 * The customer display — a port of reference/mvrk-qr-desk/src/pages/display.html.
 *
 * Opened once on the iPad with the desk's key in the URL and left open all day.
 * Idle → code → paid (15 s) → idle; expired (8 s) → idle; and a Wi-Fi screen the
 * customer can open with one tap while a code is waiting. State is polled
 * from the server, a Realtime broadcast on the desk's channel makes it react at
 * once, and while a code is waiting the display asks the server to check with
 * the provider every 4 s.
 */

type Current = {
  id: string
  status: 'waiting' | 'paid' | 'closed' | 'refunded'
  closedReason: string | null
  amountMinor: number
  currency: string
  note: string
  qrSvg: string
  failedAttempts: number
  paidAt: string | null
  expiresAt: string
  updatedAt: string
}

type Snapshot = {
  deskId: string
  version: number
  now: string
  brand: string
  idleText: string
  wifi: { ssid: string; password: string | null; security: string } | null
  current: Current | null
}

const POLL_MS = 2_500
const CHECK_MS = 4_000
const PAID_HOLD_MS = 15_000
const EXPIRED_HOLD_MS = 8_000
const WIFI_HOLD_MS = 45_000

type Screen = 'idle' | 'pay' | 'paid' | 'expired' | 'wifi' | 'error'

export function DisplayScreen({ location, desk, deskKey, demo }: { location: string; desk: string; deskKey: string; demo: boolean }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wifiOpen, setWifiOpen] = useState(false)
  const [conn, setConn] = useState(false)
  const [tick, setTick] = useState(0)
  const wifiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const base = `/api/display/${location}/${desk}`
  const q = `?key=${encodeURIComponent(deskKey)}`

  const refresh = useCallback(async () => {
    if (demo) return
    try {
      const r = await fetch(`${base}/state${q}`, { cache: 'no-store' })
      const body = await r.json()
      if (!r.ok || body.ok === false) {
        setError(body.error ?? `HTTP ${r.status}`)
        setConn(false)
        return
      }
      setSnap(body)
      setError(null)
      setConn(true)
    } catch {
      setConn(false)
    }
  }, [base, q, demo])

  // Polling, Realtime broadcast, resync on wake.
  useEffect(() => {
    if (demo) return
    refresh()
    const poll = setInterval(refresh, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
    }
  }, [refresh, demo])

  const deskId = snap?.deskId
  useEffect(() => {
    if (!deskId || demo) return
    const supabase = createClient()
    const channel = supabase.channel(`desk:${deskId}`).on('broadcast', { event: 'state' }, () => refresh()).subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [deskId, refresh, demo])

  // While a code is waiting, ask the server to check with the provider.
  const waiting = snap?.current?.status === 'waiting'
  useEffect(() => {
    if (!waiting || demo) return
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${base}/check${q}`, { method: 'POST' })
        const body = await r.json()
        if (r.ok && body.ok !== false) setSnap(body)
      } catch {
        /* polling will catch up */
      }
    }, CHECK_MS)
    return () => clearInterval(t)
  }, [waiting, base, q, demo])

  // A clock tick so the paid/expired holds end without a server round trip.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Keep the screen awake where the browser allows it (needs one tap on some iPads).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const wake = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } }
        if (!nav.wakeLock) return
        const l = await nav.wakeLock.request('screen')
        lock = l
        l.addEventListener('release', () => {
          lock = null
        })
      } catch {
        /* not allowed yet */
      }
    }
    wake()
    const onVisible = () => {
      if (!document.hidden && !lock) wake()
    }
    const onClick = () => {
      if (!lock) wake()
    }
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('click', onClick)
    }
  }, [])

  // Demo mode: cycle the screens with a fake code, for a look without a desk.
  const demoSnap = useDemo(demo)
  const view = demo ? demoSnap : snap

  const screen: Screen = useMemo(() => {
    void tick
    if (error && !view) return 'error'
    const cur = view?.current
    if (!cur) return 'idle'
    const now = Date.now()
    if (cur.status === 'paid') return cur.paidAt && now - Date.parse(cur.paidAt) > PAID_HOLD_MS ? 'idle' : 'paid'
    if (cur.status === 'refunded') return 'idle'
    if (cur.status === 'closed') {
      if (cur.closedReason === 'expired') return now - Date.parse(cur.updatedAt) > EXPIRED_HOLD_MS ? 'idle' : 'expired'
      return 'idle'
    }
    // waiting
    if (Date.parse(cur.expiresAt) < now) return 'expired'
    return wifiOpen ? 'wifi' : 'pay'
  }, [view, error, wifiOpen, tick])

  // The Wi-Fi screen closes itself, and at once when the payment lands or the code goes.
  useEffect(() => {
    if (screen !== 'pay' && screen !== 'wifi' && wifiOpen) setWifiOpen(false)
  }, [screen, wifiOpen])
  function openWifi() {
    setWifiOpen(true)
    if (wifiTimer.current) clearTimeout(wifiTimer.current)
    wifiTimer.current = setTimeout(() => setWifiOpen(false), WIFI_HOLD_MS)
  }
  function closeWifi() {
    if (wifiTimer.current) clearTimeout(wifiTimer.current)
    setWifiOpen(false)
  }

  const wifi = view?.wifi ?? null
  const wifiSvg = useMemo(() => (wifi ? qrSvg(wifiQrText({ ssid: wifi.ssid, password: wifi.password, security: wifi.security })) : ''), [wifi])
  const cur = view?.current ?? null
  const brand = view?.brand ?? 'MVRK'

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#0b1220] font-sans text-[#f1f5f9]" style={{ cursor: 'none' }}>
      <div className="absolute inset-x-0 top-[3vmin] z-10 text-center text-[2.4vmin] font-semibold uppercase tracking-[0.35em] text-[#94a3b8]">{brand}</div>

      <Screen on={screen === 'idle'}>
        <div className="text-[7vmin] font-bold tracking-tight">{view?.idleText ?? 'Ready when you are'}</div>
        <div className="mt-[1.5vmin] text-[3vmin] text-[#94a3b8]">Pay by card with your phone — a QR code will appear here</div>
        {wifi && (
          <div className="mt-[7vmin] flex items-center gap-[2.4vmin] text-left">
            <div className="rounded-[1.6vmin] bg-white p-[1vmin] [&_svg]:h-[22vmin] [&_svg]:w-[22vmin]" dangerouslySetInnerHTML={{ __html: wifiSvg }} />
            <div>
              <div className="text-[3.2vmin] font-semibold">No mobile data? Join our free Wi-Fi</div>
              <div className="mt-[0.6vmin] text-[2.4vmin] text-[#94a3b8]">
                Scan with your phone camera, then tap “Join”
                <br />
                {wifiDetails(wifi)}
              </div>
            </div>
          </div>
        )}
      </Screen>

      <Screen on={screen === 'pay'}>
        <div className="text-[8.5vmin] font-extrabold leading-none tracking-tight tabular-nums">{fmt(cur?.amountMinor ?? 0, cur?.currency ?? 'EUR')}</div>
        <div className="mb-[2.2vmin] mt-[1.2vmin] min-h-[3.2vmin] text-[3vmin] text-[#94a3b8]">{cur?.note}</div>
        <div
          className={`rounded-[3vmin] bg-white p-[2.2vmin] shadow-[0_20px_60px_rgba(0,0,0,.45)] ${wifi ? '[&_svg]:h-[min(46vh,78vw)] [&_svg]:w-[min(46vh,78vw)]' : '[&_svg]:h-[min(50vh,78vw)] [&_svg]:w-[min(50vh,78vw)]'}`}
          dangerouslySetInnerHTML={{ __html: cur?.qrSvg ?? '' }}
        />
        <div className="mt-[2.6vmin] text-[3vmin] text-[#94a3b8]">
          Open your phone <b className="font-semibold text-[#f1f5f9]">camera</b>, point it at the code, then tap the link to pay
        </div>
        <div className="mt-[1.2vmin] min-h-[3vmin] text-[2.8vmin] text-[#f59e0b]">{cur && cur.failedAttempts > 0 ? 'Card declined — please try again or use another card' : ''}</div>
        {wifi && (
          <button
            type="button"
            onClick={openWifi}
            className="mt-[2.4vmin] rounded-full border border-white/20 bg-white/10 px-[3.2vmin] py-[1.6vmin] text-[2.6vmin] font-semibold active:bg-white/20"
            style={{ cursor: 'pointer' }}
          >
            No internet? Tap here to join our free Wi-Fi
          </button>
        )}
      </Screen>

      <Screen on={screen === 'wifi'}>
        <div className="text-[5.5vmin] font-bold">Join our free Wi-Fi</div>
        <div className="mb-[3vmin] mt-[1.2vmin] text-[2.8vmin] text-[#94a3b8]">Scan with your phone camera, then tap “Join” — then come back to the payment code</div>
        <div className="rounded-[3vmin] bg-white p-[2.2vmin] shadow-[0_20px_60px_rgba(0,0,0,.45)] [&_svg]:h-[min(42vh,70vw)] [&_svg]:w-[min(42vh,70vw)]" dangerouslySetInnerHTML={{ __html: wifiSvg }} />
        <div className="mt-[2.6vmin] text-[3vmin]">{wifi ? wifiDetails(wifi) : ''}</div>
        <button type="button" onClick={closeWifi} className="mt-[3.4vmin] rounded-full bg-[#2dd4bf] px-[4vmin] py-[1.8vmin] text-[3vmin] font-bold text-[#06281f] active:brightness-90" style={{ cursor: 'pointer' }}>
          Back to payment
        </button>
        <div className="mt-[1.6vmin] text-[2.2vmin] text-[#94a3b8]">Goes back to the payment code by itself in a moment</div>
      </Screen>

      <Screen on={screen === 'paid'} className="bg-[#052e16]">
        <div className="mb-[4vmin] grid h-[22vmin] w-[22vmin] place-items-center rounded-full bg-[#22c55e]">
          <svg viewBox="0 0 24 24" fill="none" stroke="#052e16" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="h-[13vmin] w-[13vmin]">
            <path d="M4 12.5l5 5L20 7" />
          </svg>
        </div>
        <div className="text-[8vmin] font-extrabold">Paid — thank you</div>
        <div className="mt-[1.5vmin] text-[5vmin] text-[#bbf7d0]">{fmt(cur?.amountMinor ?? 0, cur?.currency ?? 'EUR')}</div>
        <div className="mt-[2.5vmin] text-[3vmin] text-[#86efac]">You can put your phone away</div>
      </Screen>

      <Screen on={screen === 'expired'}>
        <div className="text-[6vmin] font-bold text-[#f59e0b]">This code has expired</div>
        <div className="mt-[1.5vmin] text-[3vmin] text-[#94a3b8]">Please ask the desk for a new one</div>
      </Screen>

      <Screen on={screen === 'error'}>
        <div className="text-[4vmin] font-semibold text-[#f87171]">This display link isn’t working</div>
        <div className="mt-[1.5vmin] max-w-[70vw] text-[2.6vmin] text-[#94a3b8]">{error}. Open Settings → Desks &amp; displays on the staff screen for the right link.</div>
      </Screen>

      <div className={`absolute bottom-[2vmin] right-[2vmin] h-[1.4vmin] w-[1.4vmin] rounded-full ${conn || demo ? 'bg-[#22c55e] opacity-35' : 'bg-[#f87171] opacity-70'}`} />
    </div>
  )
}

function Screen({ on, className = '', children }: { on: boolean; className?: string; children: React.ReactNode }) {
  return (
    <section
      className={`absolute inset-0 flex flex-col items-center justify-center px-[4vmin] pb-[4vmin] pt-[9vmin] text-center transition-opacity duration-300 ${on ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'} ${className}`}
    >
      {children}
    </section>
  )
}

function fmt(minor: number, cur: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur, currencyDisplay: 'code' }).format(minor / 100).replace(/ /g, ' ')
  } catch {
    return `${cur} ${(minor / 100).toFixed(2)}`
  }
}

function wifiDetails(w: { ssid: string; password: string | null; security: string }) {
  if (w.security === 'nopass' || !w.password) return `Network: ${w.ssid} (no password)`
  return `Network: ${w.ssid}  ·  Password: ${w.password}`
}

/** A fake desk that cycles idle → code → declined → paid, for a look at the screens. */
function useDemo(on: boolean): Snapshot | null {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setStep((s) => s + 1), 4000)
    return () => clearInterval(t)
  }, [on])
  return useMemo(() => {
    if (!on) return null
    const s = step % 4
    const svg = qrSvg('https://example.com/pay/demo')
    const base: Snapshot = { deskId: 'demo', version: step, now: new Date().toISOString(), brand: 'MVRK', idleText: 'Ready when you are', wifi: { ssid: 'MVRK Guest', password: 'demo-only', security: 'WPA' }, current: null }
    const cur: Current = { id: 'demo' + step, status: 'waiting', closedReason: null, amountMinor: 12050, currency: 'EUR', note: 'Kite lesson · Anna', qrSvg: svg, failedAttempts: 0, paidAt: null, expiresAt: new Date(Date.now() + 600_000).toISOString(), updatedAt: new Date().toISOString() }
    if (s === 0) return base
    if (s === 1) return { ...base, current: cur }
    if (s === 2) return { ...base, current: { ...cur, failedAttempts: 1 } }
    return { ...base, current: { ...cur, status: 'paid', paidAt: new Date().toISOString() } }
  }, [on, step])
}
