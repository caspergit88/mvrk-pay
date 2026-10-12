import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** The staff screen's view of a desk: current code and today's recent list. */
export async function GET(_request: Request, { params }: { params: Promise<{ desk: string }> }) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    const { desk } = await params
    const supabase = await createClient()
    const { data, error } = await db(supabase).rpc('desk_snapshot', { p_desk: desk })
    if (error) return fail(error.message, error.code === '42501' ? 403 : 400)
    return json({ ok: true, ...(data as object) })
  })
}
