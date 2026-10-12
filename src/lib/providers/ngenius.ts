/**
 * Network International — N-Genius Online, hosted payment page.
 *
 * A port of reference/mvrk-qr-desk/src/ngenius.js, the client that ran the live
 * Cloudflare Worker, with the lessons it learned kept intact (BRIEF.md,
 * "Lessons from the live Worker"):
 *
 * - one token request at a time per provider, cached for its lifetime, and a
 *   30 s wait after a failure before asking again — Network's edge blocked an
 *   egress location for hours after a burst of bad requests;
 * - an HTML body is an edge error page, reported as such, never parsed;
 * - the realm is "NetworkInternational" for live UAE accounts and "ni" for sandbox;
 * - paid means PURCHASED, CAPTURED or AUTHORISED; FAILED/DECLINED is one failed
 *   attempt and the link stays usable until attempts run out.
 *
 * Docs: https://docs.ngenius-payments.com/reference/hosted-payment-page
 */

import { ProviderError, type CreateLinkInput, type CreateLinkResult, type PaymentProvider, type ProviderRow, type StatusResult } from './types'

const BASES: Record<string, string> = {
  live: 'https://api-gateway.ngenius-payments.com',
  sandbox: 'https://api-gateway.sandbox.ngenius-payments.com',
}

const PAID = new Set(['PURCHASED', 'CAPTURED', 'AUTHORISED', 'SUCCESS'])
const FAILED = new Set(['FAILED', 'DECLINED'])
const REFUNDED = new Set(['REFUNDED', 'PARTIALLY_REFUNDED', 'REVERSED'])
const TOKEN_RETRY_MS = 30_000

type TokenCache = { token: string | null; exp: number; failedAt: number; lastError: unknown; inflight: Promise<string> | null }
// One cache per provider row, module-wide: a serverless instance serves many requests.
const caches = new Map<string, TokenCache>()

function cacheFor(id: string): TokenCache {
  let c = caches.get(id)
  if (!c) {
    c = { token: null, exp: 0, failedAt: 0, lastError: null, inflight: null }
    caches.set(id, c)
  }
  return c
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const isHtml = (body: unknown) => typeof body === 'string' && /<html/i.test(body)

export type NGeniusSettings = {
  /** "live" | "sandbox"; or a full base URL in `baseUrl` (the mock gateway). */
  env?: string
  baseUrl?: string
  realm?: string
  outletRef?: string
  /** Portal URL for finance deep links; defaults to the live portal. */
  portalUrl?: string
}

export class NGeniusProvider implements PaymentProvider {
  kind = 'ngenius' as const
  private base: string
  private realm: string
  private outlet: string
  private portal: string

  constructor(
    private row: ProviderRow,
    private apiKey: string,
  ) {
    const s = row.settings as NGeniusSettings
    const env = (s.env ?? 'live').toLowerCase()
    this.base = (s.baseUrl ?? BASES[env] ?? BASES.live).replace(/\/$/, '')
    this.realm = s.realm ?? (env === 'sandbox' ? 'ni' : 'NetworkInternational')
    if (!s.outletRef) throw new ProviderError(`Provider "${row.name}" has no outlet reference in its settings.`, 500)
    this.outlet = s.outletRef
    this.portal = ngeniusPortal(s)
  }

  private async token(): Promise<string> {
    const c = cacheFor(this.row.id)
    const now = Date.now()
    if (c.token && c.exp - now > 30_000) return c.token
    if (c.inflight) return c.inflight
    if (c.failedAt && now - c.failedAt < TOKEN_RETRY_MS) {
      const wait = Math.ceil((TOKEN_RETRY_MS - (now - c.failedAt)) / 1000)
      throw new ProviderError(`Network token request failed recently; retrying in ${wait}s`, 503, c.lastError)
    }
    c.inflight = (async () => {
      try {
        const res = await fetch(`${this.base}/identity/auth/access-token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${this.apiKey}`,
            'Content-Type': 'application/vnd.ni-identity.v1+json',
            Accept: 'application/vnd.ni-identity.v1+json',
          },
          body: JSON.stringify({ realmName: this.realm }),
          cache: 'no-store',
        })
        const body = (await readBody(res)) as { access_token?: string; expires_in?: number } | string
        if (!res.ok || typeof body === 'string' || !body.access_token) {
          const detail = isHtml(body) ? 'Network edge returned an HTML error page (Access Denied)' : body
          c.token = null
          c.exp = 0
          c.failedAt = Date.now()
          c.lastError = detail
          throw new ProviderError(`Could not get a Network access token (HTTP ${res.status}, realm ${this.realm})`, res.status || 502, detail)
        }
        const ttl = Math.max(60, Number(body.expires_in) || 300) * 1000
        c.token = body.access_token
        c.exp = Date.now() + ttl
        c.failedAt = 0
        c.lastError = null
        return body.access_token
      } finally {
        c.inflight = null
      }
    })()
    return c.inflight
  }

  async testConnection(): Promise<string> {
    const c = cacheFor(this.row.id)
    c.token = null
    c.failedAt = 0
    await this.token()
    return `Token issued by ${this.base} (realm ${this.realm}, outlet ${this.outlet.slice(0, 8)}…)`
  }

  async createPaymentLink(input: CreateLinkInput): Promise<CreateLinkResult> {
    const token = await this.token()
    const [firstName, ...rest] = (input.customerName ?? '').trim().split(/\s+/).filter(Boolean)
    const payload = {
      action: 'PURCHASE',
      amount: { currencyCode: input.currency, value: input.amountMinor },
      emailAddress: input.email,
      language: 'en',
      merchantOrderReference: input.merchantRef,
      paymentAttempts: 3,
      merchantAttributes: {
        redirectUrl: input.redirectUrl,
        cancelUrl: input.cancelUrl,
        cancelText: 'Cancel',
        skipConfirmationPage: true,
      },
      billingAddress: { firstName: firstName || 'Walk-in', lastName: rest.join(' ') || 'Customer' },
      merchantDefinedData: input.metadata,
    }
    const res = await fetch(`${this.base}/transactions/outlets/${this.outlet}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/vnd.ni-payment.v2+json',
        Accept: 'application/vnd.ni-payment.v2+json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const body = (await readBody(res)) as Order | string
    if (!res.ok || typeof body === 'string' || !body.reference) {
      throw new ProviderError(`Network rejected the order (HTTP ${res.status})`, res.status || 502, isHtml(body) ? 'HTML error page' : body)
    }
    const payUrl = body._links?.payment?.href
    if (!payUrl) throw new ProviderError('Order created but Network returned no pay-page link', 502, body)
    return { providerRef: body.reference, payUrl }
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const token = await this.token()
    const res = await fetch(`${this.base}/transactions/outlets/${this.outlet}/orders/${providerRef}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.ni-payment.v2+json' },
      cache: 'no-store',
    })
    const body = (await readBody(res)) as Order | string
    if (!res.ok || typeof body === 'string' || !body.reference) {
      throw new ProviderError(`Could not read the order status (HTTP ${res.status})`, res.status || 502, isHtml(body) ? 'HTML error page' : body)
    }
    return summarize(body)
  }

  portalUrl(): string | null {
    // The portal has no stable deep link per order; finance searches by the merchant reference.
    return this.portal
  }

  /**
   * N-Genius webhooks POST the order (or an event wrapping it). The call is
   * trusted only for *which* order to look at; the status comes from getStatus.
   */
  async parseWebhook(_request: Request, body: unknown): Promise<{ providerRef: string } | null> {
    const b = body as { order?: { reference?: string }; reference?: string } | null
    const ref = b?.order?.reference ?? b?.reference
    return ref ? { providerRef: ref } : null
  }
}

type Order = {
  reference?: string
  merchantOrderReference?: string
  amount?: { currencyCode: string; value: number }
  _links?: { payment?: { href?: string } }
  _embedded?: { payment?: { state?: string; paymentMethod?: { name?: string; pan?: string } }[] }
}

/** Reduce an order object to what the desk needs to know. */
export function summarize(order: Order): StatusResult {
  const payments = order._embedded?.payment ?? []
  const last = payments[payments.length - 1]
  const rawState = last?.state ?? 'STARTED'
  const failedAttempts = payments.filter((p) => FAILED.has(p.state ?? '')).length
  const pan = last?.paymentMethod?.pan ?? ''
  const card = last?.paymentMethod ? { scheme: last.paymentMethod.name ?? '', last4: pan.slice(-4) } : undefined
  let state: StatusResult['state'] = 'pending'
  if (REFUNDED.has(rawState)) state = 'refunded'
  else if (PAID.has(rawState)) state = 'paid'
  else if (FAILED.has(rawState)) state = 'failed'
  return { state, rawState, failedAttempts, card, raw: order }
}

/** The N-Genius merchant portal for this outlet's settings; no key needed to know it. */
export function ngeniusPortal(settings: NGeniusSettings): string {
  return settings.portalUrl ?? 'https://portal.ngenius-payments.com'
}
