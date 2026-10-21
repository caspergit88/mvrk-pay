'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { homePathFor } from '@/lib/auth'
import {
  AdminCodeUnavailable,
  adminCodeRequired,
  clientIp,
  loginBlocked,
  noteLogin,
  retireStarterPassword,
  sendAdminCode,
  sendLoginCode,
  sessionIdOf,
  signInWithLoginCode,
} from '@/lib/login-guard'
import type { Profile } from '@/lib/types'

const DOMAIN_MESSAGE = "This email isn't on an MVRK team domain."
/** Which email the code went to, between "Email me a code" and entering it. Not a secret; kept out of the URL. */
const CODE_EMAIL_COOKIE = 'pay_code_email'

function bounce(error: string): never {
  redirect(`/sign-in?error=${encodeURIComponent(error)}`)
}

function backToCode(error: string): never {
  redirect(`/sign-in/email-code?error=${encodeURIComponent(error)}`)
}

/** The email from the form, checked against the team domains before anything else happens. */
async function teamEmail(formData: FormData, supabase: Awaited<ReturnType<typeof createClient>>) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const domain = email.split('@')[1] ?? ''
  if (!email || !domain) bounce('Enter your email.')
  const { data: location } = await db(supabase).rpc('location_for_domain', { p_domain: domain })
  if (!location) bounce(DOMAIN_MESSAGE)
  return email
}

/**
 * Sign in with a password — the fallback once email codes are on. The domain
 * rule is checked here as well as in the browser and in the database trigger
 * on pay.profiles. Wrong passwords are counted per email and per address
 * (migration 0008); an admin then proves the mailbox with a code.
 */
export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = await teamEmail(formData, supabase)
  const password = String(formData.get('password') ?? '')
  if (!password) bounce('Enter your password.')

  const ip = clientIp(await headers())
  const blocked = await loginBlocked(email, ip)
  if (blocked) bounce(blocked)

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  await noteLogin(email, ip, !error)
  if (error) bounce(error.message)

  await afterSignIn(supabase, { viaCode: false })
}

/** "Email me a code": send it (if the email has a login) and go to the code box. */
export async function emailMeACode(formData: FormData) {
  const supabase = await createClient()
  const email = await teamEmail(formData, supabase)
  const blocked = await loginBlocked(email, clientIp(await headers()))
  if (blocked) bounce(blocked)

  let failure: string | null = null
  try {
    await sendLoginCode(email)
  } catch (e) {
    failure = e instanceof Error ? e.message : 'The code could not be sent.'
  }
  if (failure) bounce(failure)

  ;(await cookies()).set(CODE_EMAIL_COOKIE, email, { httpOnly: true, secure: true, sameSite: 'lax', path: '/sign-in', maxAge: 15 * 60 })
  redirect('/sign-in/email-code')
}

export async function resendEmailCode() {
  const email = (await cookies()).get(CODE_EMAIL_COOKIE)?.value
  if (!email) bounce('Start again: enter your email.')
  const blocked = await loginBlocked(email, clientIp(await headers()))
  if (blocked) backToCode(blocked)
  let failure: string | null = null
  try {
    await sendLoginCode(email)
  } catch (e) {
    failure = e instanceof Error ? e.message : 'The code could not be sent.'
  }
  if (failure) backToCode(failure)
  redirect('/sign-in/email-code?sent=1')
}

/** The six digits from the email. Wrong codes count towards the same limits as wrong passwords. */
export async function verifyEmailCode(formData: FormData) {
  const jar = await cookies()
  const email = jar.get(CODE_EMAIL_COOKIE)?.value
  if (!email) bounce('That took longer than 15 minutes. Enter your email again.')
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) backToCode('The code is six digits.')

  const ip = clientIp(await headers())
  const blocked = await loginBlocked(email, ip)
  if (blocked) backToCode(blocked)

  const supabase = await createClient()
  const wrong = await signInWithLoginCode(supabase, email, code)
  await noteLogin(email, ip, !wrong)
  if (wrong) backToCode(wrong)

  jar.delete({ name: CODE_EMAIL_COOKIE, path: '/sign-in' })
  await afterSignIn(supabase, { viaCode: true })
}

/**
 * Where a signed-in person goes next, whichever way they signed in.
 * A code sign-in has already proved the mailbox, so an admin skips the
 * second code, and a starter password nobody needs any more is retired.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function afterSignIn(supabase: SupabaseClient<any, any, any>, { viaCode }: { viaCode: boolean }): Promise<never> {
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
  if (p.must_change_password) {
    if (viaCode) await retireStarterPassword(p.id)
    else redirect('/set-password')
  }

  // Reception picks a name (and PIN) next; that step writes the session row.
  if (p.role === 'reception') redirect('/who')

  // Admin by password: a code to the admin's mailbox first; the session starts once it is entered.
  if (p.role === 'admin' && !viaCode) {
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
