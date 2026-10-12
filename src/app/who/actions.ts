'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { requireUser } from '@/lib/auth'

/**
 * "Who are you?" — the reception account is shared; the person is not. The
 * database checks the name belongs to this location and, where the location
 * requires it, the PIN; it writes the pay.sessions row with the 22:00 expiry.
 */
export async function chooseName(formData: FormData) {
  const profile = await requireUser()
  if (profile.role !== 'reception') redirect('/')

  const staffId = String(formData.get('staff_id') ?? '')
  const pin = String(formData.get('pin') ?? '').trim()
  if (!staffId) redirect('/who?error=' + encodeURIComponent('Pick your name from the list.'))

  const supabase = await createClient()
  const { error } = await db(supabase).rpc('start_session', { p_staff: staffId, p_pin: pin || null })
  if (error) redirect('/who?error=' + encodeURIComponent(error.message))

  redirect('/pay')
}

/** Shift change: forget who was on the desk and ask again. The login stays. */
export async function switchPerson() {
  await requireUser()
  const supabase = await createClient()
  await db(supabase).rpc('end_session')
  redirect('/who')
}
