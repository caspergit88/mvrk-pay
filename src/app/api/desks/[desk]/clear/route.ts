import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { checkDesk, clearDesk } from '@/lib/payments'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Take the code off the display. One last status check first, so a payment made in the last seconds is not called unpaid. */
export async function POST(_request: Request, { params }: { params: Promise<{ desk: string }> }) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    if (me.role === 'finance') return fail('Finance cannot clear a display.', 403)
    const { desk } = await params
    const supabase = await createClient()
    const last = await checkDesk(supabase, desk, { force: true })
    if (!last.skipped && last.transaction.status === 'paid') {
      // It was paid after all: leave the green screen to run its course.
      const { data } = await db(supabase).rpc('desk_snapshot', { p_desk: desk })
      return json({ ok: true, paidAfterAll: true, ...(data as object) })
    }
    await clearDesk(desk, 'cleared')
    const { data, error } = await db(supabase).rpc('desk_snapshot', { p_desk: desk })
    if (error) return fail(error.message)
    return json({ ok: true, ...(data as object) })
  })
}
