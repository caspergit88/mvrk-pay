import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'

export async function POST(request: Request) {
  const supabase = await createClient()
  // End the pay session first, so the desk is free for the next person (0013).
  await db(supabase).rpc('end_session')
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/sign-in', request.url), { status: 303 })
}
