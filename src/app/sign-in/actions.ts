'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { homePathFor } from '@/lib/auth'
import { AdminCodeUnavailable, adminCodeRequired, clientIp, loginBlocked, noteLogin, sendAdminCode, sessionIdOf } from '@/lib/login-guard'
import type { Profile } from '@/lib/types'

const DOMAIN_MESSAGE = "This email isn't on an MVRK team domain."

function bounce(error: string): never {
  redirect(`/sign-in?error=${encodeURIComponent(error)}`)
}

/**
 * Sign in. The domain rule is checked here as well as in the browser and in the
 * database trigger on pay.profiles, so a login on another domain is refused
 * before Supabase Auth is even asked. Wrong passwords are counted per email and
 * per address (migration 0008); an admin then proves the mailbox with a code.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const domain = email.split('@')[1] ?? ''
  if (!email || !domain || !password) bounce('Enter your email and password.')

  const supabase = await createClient()

  const { data: location } = await db(supabase).rpc('location_for_domain', { p_domain: domain })
  if (!location) bounce(DOMAIN_MESSAGE)

  const ip = clientIp(await headers())
  const blocked = await loginBlocked(email, ip)
  if (blocked) bounce(blocked)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  await noteLogin(email, ip, !error)
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

  // Admin: a code to the admin's mailbox first; the session starts once it is entered.
  if (p.role === 'admin') {
    let skipped = 'Email codes are not configured yet (service-role key and Resend).'
    if (adminCodeRequired()) {
      const sid = await sessionIdOf(supabase)
      if (!sid) bounce('Sign-in did not complete. Try again.')
      let failure: string | null = null
      try {
        await sendAdminCode(p, sid)
        skipped = ''
      } catch (e) {
        if (e instanceof AdminCodeUnavailable) skipped = 'Migration 0008 is not applied yet.'
        else failure = e instanceof Error ? e.message : 'The code could not be sent.'
      }
      if (failure) {
        await supabase.auth.signOut()
        bounce(failure)
      }
      if (!skipped) redirect('/sign-in/code')
    }
    await db(supabase).rpc('log_action', {
      p_entity: 'session',
      p_entity_id: null,
      p_action: 'admin_code_skipped',
      p_reason: skipped,
    })
  }

  // Admin and finance have no name to pick: their session starts here, with the
  // same 22:00 expiry as everyone else.
  const { error: sessionError } = await db(supabase).rpc('start_session', { p_staff: null, p_pin: null })
  if (sessionError) bounce(sessionError.message)

  redirect(homePathFor(p.role))
}
