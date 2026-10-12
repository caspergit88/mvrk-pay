import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { db } from '@/lib/supabase/db'

/**
 * Transactional email through Resend — the weddings app's lib/email.ts rules:
 * the log row is written first, `dedupe_key` is unique and is the whole
 * idempotency story, and a missing key is not an error (the row says
 * "no provider"). One fetch, no SDK.
 */

const ENDPOINT = 'https://api.resend.com/emails'

export type EmailMessage = {
  kind: string
  locationId?: string | null
  to: string[]
  subject: string
  text: string
  html?: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
  /** What the log keeps instead of the subject and text, when those carry a secret (a sign-in code). */
  logSubject?: string
  logText?: string
  dedupeKey: string
}

export type SendResult = { sent: boolean; reason: 'sent' | 'no_provider' | 'no_recipients' | 'duplicate' | 'failed'; detail?: string }

function apiKey() {
  const k = process.env.RESEND_API_KEY
  return k && k.trim() ? k.trim() : null
}
function fromAddress() {
  const f = process.env.RESEND_FROM_EMAIL ?? process.env.RESEND_FROM
  return f && f.trim() ? f.trim() : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendEmail(client: SupabaseClient<any, any, any>, message: EmailMessage): Promise<SendResult> {
  const to = [...new Set(message.to.map((a) => a.trim().toLowerCase()).filter(Boolean))]
  if (to.length === 0) return { sent: false, reason: 'no_recipients' }

  const { data: inserted, error: logError } = await db(client)
    .from('email_log')
    .upsert(
      {
        kind: message.kind,
        location_id: message.locationId ?? null,
        to_addresses: to,
        subject: message.logSubject ?? message.subject,
        body: message.logText ?? message.text,
        attachment_path: message.attachments?.map((a) => a.filename).join(', ') ?? null,
        dedupe_key: message.dedupeKey,
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select('id')
  if (logError) return { sent: false, reason: 'failed', detail: logError.message }
  if (!inserted || inserted.length === 0) return { sent: false, reason: 'duplicate' }
  const id = (inserted[0] as { id: string }).id

  const key = apiKey()
  const from = fromAddress()
  if (!key || !from) return { sent: false, reason: 'no_provider' }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
      }),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) {
      await db(client).from('email_log').update({ error: body.message ?? `HTTP ${res.status}` }).eq('id', id)
      return { sent: false, reason: 'failed', detail: body.message ?? `HTTP ${res.status}` }
    }
    await db(client).from('email_log').update({ sent_at: new Date().toISOString(), provider_id: body.id ?? null }).eq('id', id)
    return { sent: true, reason: 'sent' }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    await db(client).from('email_log').update({ error: detail }).eq('id', id)
    return { sent: false, reason: 'failed', detail }
  }
}
