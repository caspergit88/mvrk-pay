'use server'

import { db } from '@/lib/supabase/db'
import { serviceOrNull } from '@/lib/payments'
import { sendEmail } from '@/lib/email'
import { dateTime, money } from '@/lib/format'

export type ReceiptState = { ok?: string; error?: string } | null

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * "Email me a receipt" on the thank-you page. No login on a customer's phone,
 * so this runs with the service role and is deliberately narrow: only a paid
 * order, found by the provider's reference from the redirect, and only one
 * email per address per order (the dedupe key). Nothing about the customer
 * is stored beyond the email log.
 */
export async function sendReceipt(_prev: ReceiptState, formData: FormData): Promise<ReceiptState> {
  const ref = String(formData.get('ref') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!ref) return { error: 'This page has no payment reference, so there is nothing to send. Ask the desk for a receipt.' }
  if (!EMAIL.test(email) || email.length > 120) return { error: 'That email address does not look right.' }

  const service = serviceOrNull()
  if (!service) return { error: 'Receipts by email are not switched on yet. Ask the desk for one.' }

  const { data } = await db(service)
    .from('v_transactions')
    .select('id, status, amount_minor, currency, merchant_ref, paid_at, created_at, timezone, card_scheme, card_last4, note, location_id, location_name')
    .eq('provider_ref', ref)
    .maybeSingle()
  const tx = data as {
    id: string
    status: string
    amount_minor: number
    currency: string
    merchant_ref: string
    paid_at: string | null
    created_at: string
    timezone: string
    card_scheme: string | null
    card_last4: string | null
    note: string
    location_id: string
    location_name: string
  } | null
  if (!tx) return { error: 'We could not find that payment. Ask the desk for a receipt.' }
  if (tx.status !== 'paid' && tx.status !== 'refunded') return { error: 'This payment is not confirmed yet, so there is no receipt to send. Please check with the desk.' }

  const { data: loc } = await db(service).from('locations').select('brand_label').eq('id', tx.location_id).maybeSingle()
  const brand = (loc as { brand_label?: string } | null)?.brand_label ?? 'MVRK'

  const when = dateTime(tx.paid_at ?? tx.created_at, tx.timezone)
  const card = tx.card_last4 ? `${tx.card_scheme ?? 'Card'} ending ${tx.card_last4}` : 'Card'
  const lines = [
    `${brand} — payment receipt`,
    '',
    `Amount:     ${money(tx.amount_minor, tx.currency)}`,
    `Paid:       ${when}`,
    `Paid with:  ${card}`,
    `Location:   ${tx.location_name}`,
    `Reference:  ${tx.merchant_ref}`,
    tx.note ? `For:        ${tx.note}` : null,
    tx.status === 'refunded' ? '' : null,
    tx.status === 'refunded' ? 'This payment has since been refunded.' : null,
    '',
    'Thank you.',
  ].filter((l): l is string => l !== null)

  const r = await sendEmail(service, {
    kind: 'receipt',
    locationId: tx.location_id,
    to: [email],
    subject: `${brand} receipt — ${money(tx.amount_minor, tx.currency)}`,
    text: lines.join('\n'),
    dedupeKey: `receipt:${tx.id}:${email}`,
  })
  if (r.sent) return { ok: `Receipt sent to ${email}.` }
  if (r.reason === 'duplicate') return { ok: `A receipt was already sent to ${email}.` }
  if (r.reason === 'no_provider') return { error: 'Receipts by email are not switched on yet. Ask the desk for one.' }
  return { error: 'The receipt could not be sent just now. Ask the desk for one.' }
}
