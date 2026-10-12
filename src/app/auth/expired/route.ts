import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Where requireProfile sends an admin or finance user whose pay.sessions row
 * has gone (22:00 came and went). Signs them out of Supabase too, so the next
 * thing they see is a clean sign-in screen that says why.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/sign-in?expired=1', request.url), { status: 303 })
}
