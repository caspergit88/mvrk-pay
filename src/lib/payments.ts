import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { providerFor, ProviderError, type ProviderRow, type StatusResult } from '@/lib/providers'
import { qrSvg } from '@/lib/qr'

/**
 * The payment flow on the server. Four verbs — open, check, clear, re-check —
 * each a thin layer over the database functions in migrations 0002 and 0006,
 * plus the one thing the database cannot do: talk to the payment provider.
 *
 * Status checks are de-duplicated here (no second provider call for the same
 * order within CHECK_GAP_MS) because two screens poll while a code is waiting.
 */

const CHECK_GAP_MS = 3_000
const lastCheck = new Map<string, number>()

export class PaymentError extends Error {
  constructor(
    message: string,
    public status = 400,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

type TxRow = {
  id: string
  location_id: string
  desk_id: string
  provider_id: string
  provider_ref: string
  status: 'waiting' | 'paid' | 'closed' | 'refunded'
  last_checked_at: string | null
}

async function providerRow(client: Client, id: string): Promise<ProviderRow> {
  const { data, error } = await db(client).from('providers').select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new PaymentError('That payment provider is not available.', 500, error?.message)
  return data as ProviderRow
}

/** Open a payment code on a desk: create the order at the provider, then record it. */
export async function openOrder(input: { deskId: string; amountMinor: number; note: string; bookingRef: string; origin: string; cashier: string }) {
  const supabase = await createClient()
  const { data: desk, error: deskError } = await db(supabase)
    .from('desks')
    .select('id, slug, location_id, location:locations(slug, name, max_amount_minor)')
    .eq('id', input.deskId)
    .maybeSingle()
  if (deskError || !desk) throw new PaymentError('Unknown desk.', 404, deskError?.message)
  const d = desk as unknown as { id: string; slug: string; location_id: string; location: { slug: string; name: string; max_amount_minor: number } }
  if (input.amountMinor > d.location.max_amount_minor) {
    throw new PaymentError(`Amount is above this location's limit of ${(d.location.max_amount_minor / 100).toFixed(2)}.`)
  }

  const { data: prov } = await db(supabase)
    .from('providers')
    .select('*')
    .eq('location_id', d.location_id)
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!prov) throw new PaymentError('No payment provider is enabled for this location (Settings → Payment providers).', 500)
  const row = prov as ProviderRow

  const merchantRef = `MP-${d.location.slug}-${d.slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
  const provider = await providerFor(row)
  let link
  try {
    link = await provider.createPaymentLink({
      amountMinor: input.amountMinor,
      currency: row.currency,
      merchantRef,
      note: input.note,
      customerName: input.note,
      email: process.env.DEFAULT_PAYER_EMAIL ?? 'payments@mvrk.ae',
      // Network appends ?ref=<order> to both of these itself.
      redirectUrl: `${input.origin}/thanks`,
      cancelUrl: `${input.origin}/cancelled`,
      metadata: { location: d.location.slug, desk: d.slug, cashier: input.cashier, note: input.note, booking: input.bookingRef, source: 'mvrk-pay' },
    })
  } catch (e) {
    if (e instanceof ProviderError) throw new PaymentError(e.message, 502, e.detail)
    throw e
  }

  const { data, error } = await db(supabase).rpc('open_order', {
    p_desk: d.id,
    p_provider: row.id,
    p_provider_ref: link.providerRef,
    p_merchant_ref: merchantRef,
    p_amount_minor: input.amountMinor,
    p_currency: row.currency,
    p_note: input.note,
    p_booking_ref: input.bookingRef,
    p_pay_url: link.payUrl,
    p_qr_svg: qrSvg(link.payUrl),
  })
  if (error) throw new PaymentError(error.message, 400)
  await broadcastDesk(d.id)
  return data
}

/** Ask the provider about one transaction and apply the answer. Returns the updated row. */
export async function checkTransaction(client: Client, tx: TxRow, opts: { force?: boolean } = {}) {
  const now = Date.now()
  const last = lastCheck.get(tx.id) ?? 0
  if (!opts.force && now - last < CHECK_GAP_MS) return { skipped: true as const }
  lastCheck.set(tx.id, now)

  const row = await providerRow(client, tx.provider_id)
  const provider = await providerFor(row)
  let status: StatusResult | null = null
  let errorText: string | null = null
  try {
    status = await provider.getStatus(tx.provider_ref)
  } catch (e) {
    errorText = e instanceof Error ? e.message : String(e)
  }

  const { data, error } = await db(client).rpc('apply_provider_status', {
    p_tx: tx.id,
    p_state: status?.rawState ?? null,
    p_paid: status?.state === 'paid',
    p_refunded: status?.state === 'refunded',
    p_failed_attempts: status?.failedAttempts ?? null,
    p_card_scheme: status?.card?.scheme ?? null,
    p_card_last4: status?.card?.last4 ?? null,
    p_error: errorText,
  })
  if (error) throw new PaymentError(error.message, 500)
  const updated = data as TxRow & { desk_id: string }
  if (!errorText) await broadcastDesk(updated.desk_id)
  return { skipped: false as const, transaction: updated, error: errorText }
}

/** The current code on a desk, checked if it is still waiting. */
export async function checkDesk(client: Client, deskId: string, opts: { force?: boolean } = {}) {
  const { data: state } = await db(client).from('desk_state').select('current_tx').eq('desk_id', deskId).maybeSingle()
  const currentTx = (state as { current_tx: string | null } | null)?.current_tx
  if (!currentTx) return { skipped: true as const }
  const { data: tx } = await db(client).from('transactions').select('id, location_id, desk_id, provider_id, provider_ref, status, last_checked_at').eq('id', currentTx).maybeSingle()
  const t = tx as TxRow | null
  if (!t || t.status !== 'waiting') return { skipped: true as const }
  return checkTransaction(client, t, opts)
}

export async function clearDesk(deskId: string, reason: 'cleared' | 'done') {
  const supabase = await createClient()
  const { error } = await db(supabase).rpc('clear_desk', { p_desk: deskId, p_reason: reason })
  if (error) throw new PaymentError(error.message, 400)
  await broadcastDesk(deskId)
}

/**
 * Tell the open screens a desk changed. Supabase Realtime broadcast over REST
 * needs the service role; without it (local dev) the screens' polling still
 * picks the change up within a few seconds.
 */
export async function broadcastDesk(deskId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `desk:${deskId}`, event: 'state', payload: { at: Date.now() } }] }),
    })
  } catch {
    // Best effort.
  }
}

/** A client that can act without a signed-in person (display polling, webhooks, cron). */
export function serviceOrNull(): Client | null {
  try {
    return createServiceClient()
  } catch {
    return null
  }
}
