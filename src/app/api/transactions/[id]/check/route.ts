import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { checkTransaction } from '@/lib/payments'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** "Check" on a recent order: did it get paid after all? */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    const { id } = await params
    const supabase = await createClient()
    const { data: tx } = await db(supabase)
      .from('transactions')
      .select('id, location_id, desk_id, provider_id, provider_ref, status, last_checked_at')
      .eq('id', id)
      .maybeSingle()
    if (!tx) return fail('Order not found.', 404)
    const r = await checkTransaction(supabase, tx as never, { force: true })
    const { data: row } = await db(supabase).from('v_transactions').select('*').eq('id', id).maybeSingle()
    return json({ ok: true, checkError: 'error' in r ? r.error : null, transaction: row })
  })
}
