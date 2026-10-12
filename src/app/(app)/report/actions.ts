'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { closeDay } from '@/lib/report'
import { done, fail, type ActionState } from '../settings/_lib/action-state'

export async function endOfDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireProfile()
  if (me.role === 'finance') return fail('Finance reviews the day; reception or admin closes it.')
  const locationId = String(formData.get('location_id') ?? '')
  const date = String(formData.get('date') ?? '')
  if (!locationId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('No day selected.')
  if (me.role === 'reception' && me.location_id !== locationId) return fail('Not your location.')

  const supabase = await createClient()
  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? ''}`
  try {
    const r = await closeDay(supabase, locationId, date, { automatic: false, origin })
    revalidatePath('/report')
    const bits = [`Day closed as ${r.close.close_number}.`]
    bits.push(r.email ? `Report ${r.email}.` : 'No finance email is set for this location, so nothing was sent.')
    if (r.checks.length) bits.push(`${r.checks.length} status check(s) failed and those codes read "Not confirmed".`)
    return done(bits.join(' '))
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

export async function reopenDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireProfile()
  if (me.role === 'reception') return fail('Only admin or finance can re-open a day.')
  const locationId = String(formData.get('location_id') ?? '')
  const date = String(formData.get('date') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) return fail('Give a reason; it goes on the record.')
  const supabase = await createClient()
  const { error } = await db(supabase).rpc('reopen_day', { p_location: locationId, p_date: date, p_reason: reason })
  if (error) return fail(error.message)
  revalidatePath('/report')
  return done('Day re-opened. Close it again when it is right; the new close gets a new number.')
}
