import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { checkDesk, serviceOrNull } from '@/lib/payments'
import { fail, handle, json } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * The display's own status poll while a code is waiting. It runs on the
 * server with the service role (there is no signed-in person on an iPad), so
 * the desk key is verified first and the check is de-duplicated with the staff
 * screen's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ location: string; desk: string }> }) {
  return handle(async () => {
    const { location, desk } = await params
    const key = new URL(request.url).searchParams.get('key') ?? ''
    const supabase = await createClient()
    const { data: deskId, error } = await db(supabase).rpc('desk_for_display', { p_location: location, p_desk: desk, p_key: key })
    if (error || !deskId) return fail('Unknown desk or wrong display key.', 403)
    const service = serviceOrNull()
    let checkError: string | null = null
    if (service) {
      const r = await checkDesk(service, deskId as string)
      if (!r.skipped) checkError = r.error
    }
    const { data: snap, error: snapError } = await db(supabase).rpc('display_snapshot', { p_location: location, p_desk: desk, p_key: key })
    if (snapError) return fail(snapError.message)
    return json({ ok: true, checkError, serviceAvailable: !!service, ...(snap as object) })
  })
}
