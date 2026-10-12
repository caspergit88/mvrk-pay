'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { homePathFor } from '@/lib/auth'
import type { Profile } from '@/lib/types'

const DOMAIN_MESSAGE = "This email isn't on an MVRK team domain."

function bounce(error: string): never {
  redirect(`/sign-in?error=${encodeURIComponent(error)}`)
}

/**
 * Sign in. The domain rule is checked here as well as in the browser and in the
 * database trigger on pay.profiles, so a login on another domain is refused
 * before Supabase Auth is even asked.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const domain = email.split('@')[1] ?? ''
  if (!email || !domain || !password) bounce('Enter your email and password.')

  const supabase = await createClient()

  const { data: location } = await db(supabase).rpc('location_for_domain', { p_domain: domain })
  if (!location) bounce(DOMAIN_MESSAGE)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) bounce(error.message)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) bounce('Sign-in did not complete. Try again.')

  const { data: profile } = await db(supabase)
    .from('profiles')
    .select('id, email, full_name, role, location_id, active, must_change_password')
    .eq('id', user.id)
    .maybeSingle()

  const p = profile as Profile | null
  if (!p || !p.active) redirect('/no-access')
  if (p.must_change_password) redirect('/set-password')

  // Reception picks a name (and PIN) next; that step writes the session row.
  if (p.role === 'reception') redirect('/who')

  // Admin and finance have no name to pick: their session starts here, with the
  // same 22:00 expiry as everyone else.
  const { error: sessionError } = await db(supabase).rpc('start_session', { p_staff: null, p_pin: null })
  if (sessionError) bounce(sessionError.message)

  redirect(homePathFor(p.role))
}
