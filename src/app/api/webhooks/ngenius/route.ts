import { db } from '@/lib/supabase/db'
import { checkTransaction, serviceOrNull } from '@/lib/payments'
import { providerFor, type ProviderRow } from '@/lib/providers'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Network's webhook. Registered in the N-Genius portal as
 *   https://<app>/api/webhooks/ngenius?token=<the provider row's webhook_token>
 * (Settings → Payment providers prints it). The body is trusted only for which
 * order to look at; the status comes from asking Network.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const token = new URL(request.url).searchParams.get('token') ?? ''
    const service = serviceOrNull()
    if (!service) return fail('Service role not configured.', 503)
    if (!token) return fail('Missing token.', 401)

    const { data: prov } = await db(service).from('providers').select('*').eq('webhook_token', token).eq('kind', 'ngenius').maybeSingle()
    if (!prov) return fail('Unknown token.', 401)
    const row = prov as ProviderRow

    const body = await request.json().catch(() => null)
    const provider = await providerFor(row)
    const hint = provider.parseWebhook ? await provider.parseWebhook(request, body) : null
    if (!hint) return json({ ok: true, ignored: true })

    const { data: tx } = await db(service)
      .from('transactions')
      .select('id, location_id, desk_id, provider_id, provider_ref, status, last_checked_at')
      .eq('provider_id', row.id)
      .eq('provider_ref', hint.providerRef)
      .maybeSingle()
    if (!tx) return json({ ok: true, ignored: true, reason: 'order not ours' })

    const r = await checkTransaction(service, tx as never, { force: true })
    return json({ ok: true, checked: !r.skipped, error: 'error' in r ? r.error : null })
  })
}
