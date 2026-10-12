import { z } from 'zod'
import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { openOrder } from '@/lib/payments'
import { parseAmount } from '@/lib/format'
import { fail, handle, json, originOf } from '@/lib/api'

export const dynamic = 'force-dynamic'

const Body = z.object({
  amount: z.union([z.string(), z.number()]),
  note: z.string().max(80).optional().default(''),
  bookingRef: z.string().max(40).optional().default(''),
})

/** Show a new code on the desk's display. */
export async function POST(request: Request, { params }: { params: Promise<{ desk: string }> }) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    if (me.role === 'finance') return fail('Finance cannot take payments.', 403)
    const { desk } = await params
    const parsed = Body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return fail('Enter an amount.')
    const amountMinor = parseAmount(String(parsed.data.amount))
    if (!amountMinor) return fail('Enter an amount greater than 0.')

    const supabase = await createClient()
    const cashier = me.session.staff_id
      ? ((await db(supabase).from('staff_names').select('name').eq('id', me.session.staff_id).maybeSingle()).data as { name: string } | null)?.name ?? me.full_name
      : me.full_name

    const tx = await openOrder({
      deskId: desk,
      amountMinor,
      note: parsed.data.note.trim(),
      bookingRef: parsed.data.bookingRef.trim(),
      origin: originOf(request),
      cashier,
    })
    const { data } = await db(supabase).rpc('desk_snapshot', { p_desk: desk })
    return json({ ok: true, transaction: tx, ...(data as object) })
  })
}
