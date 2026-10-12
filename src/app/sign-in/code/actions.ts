'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { homePathFor, requireUser } from '@/lib/auth'
import { checkAdminCode, sendAdminCode, sessionIdOf } from '@/lib/login-guard'

function back(params: string): never {
  redirect(`/sign-in/code?${params}`)
}

async function adminAndSession() {
  const me = await requireUser()
  if (me.role !== 'admin') redirect('/')
  const supabase = await createClient()
  const sid = await sessionIdOf(supabase)
  if (!sid) redirect('/sign-in')
  return { me, supabase, sid }
}

/** The six digits from the email. Right: the session starts, as for everyone else. */
export async function verifyCode(formData: FormData) {
  const { me, supabase, sid } = await adminAndSession()
  const code = String(formData.get('code') ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) back(`error=${encodeURIComponent('The code is six digits.')}`)

  const wrong = await checkAdminCode(me.id, sid, code)
  if (wrong) back(`error=${encodeURIComponent(wrong)}`)

  const { error } = await db(supabase).rpc('start_session', { p_staff: null, p_pin: null })
  if (error) back(`error=${encodeURIComponent(error.message)}`)
  redirect(homePathFor(me.role))
}

export async function resendCode() {
  const { me, sid } = await adminAndSession()
  let failure: string | null = null
  try {
    await sendAdminCode(me, sid)
  } catch (e) {
    failure = e instanceof Error ? e.message : 'The code could not be sent.'
  }
  back(failure ? `error=${encodeURIComponent(failure)}` : 'sent=1')
}
