import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { checkDesk } from '@/lib/payments'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Ask the provider about the code on this desk (staff screen's 4-second poll and "Check now"). */
export async function POST(request: Request, { params }: { params: Promise<{ desk: string }> }) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    const { desk } = await params
    const force = new URL(request.url).searchParams.get('force') === '1'
    const supabase = await createClient()
    const result = await checkDesk(supabase, desk, { force })
    const { data, error } = await db(supabase).rpc('desk_snapshot', { p_desk: desk })
    if (error) return fail(error.message)
    return json({ ok: true, checked: !result.skipped, checkError: 'error' in result ? result.error : null, ...(data as object) })
  })
}
