import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** The customer display's snapshot. No login: the desk key in the URL is the credential. */
export async function GET(request: Request, { params }: { params: Promise<{ location: string; desk: string }> }) {
  return handle(async () => {
    const { location, desk } = await params
    const key = new URL(request.url).searchParams.get('key') ?? ''
    const supabase = await createClient()
    const { data, error } = await db(supabase).rpc('display_snapshot', { p_location: location, p_desk: desk, p_key: key })
    if (error) return fail(error.message, error.code === '28000' ? 403 : 400)
    return json({ ok: true, ...(data as object) })
  })
}
