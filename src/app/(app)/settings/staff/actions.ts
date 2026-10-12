'use server'

import { revalidatePath } from 'next/cache'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/staff'

export async function addStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const location_id = String(formData.get('location_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const pin = String(formData.get('pin') ?? '').trim()
  if (!location_id) return fail('Pick a location.')
  if (name.length < 2) return fail('Type the person’s name as the team knows them.')
  if (pin && !/^\d{4}$/.test(pin)) return fail('A PIN is exactly four digits.')

  const supabase = await createClient()
  const { data, error } = await db(supabase).from('staff').insert({ location_id, name }).select('id').single()
  if (error) return fail(error.message)
  if (pin) {
    const { error: pinError } = await db(supabase).rpc('set_staff_pin', { p_staff: (data as { id: string }).id, p_pin: pin })
    if (pinError) return fail(`${name} added, but the PIN was not set: ${pinError.message}`)
  }
  revalidatePath(PATH)
  return done(`${name} is now in the “Who are you?” list${pin ? ' with a PIN' : ''}.`)
}

export async function setPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const pin = String(formData.get('pin') ?? '').trim()
  if (!/^\d{4}$/.test(pin)) return fail('A PIN is exactly four digits.')
  const supabase = await createClient()
  const { error } = await db(supabase).rpc('set_staff_pin', { p_staff: id, p_pin: pin })
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done('PIN set. Tell them in person, not in a message.')
}

export async function clearPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { error } = await db(supabase).rpc('set_staff_pin', { p_staff: id, p_pin: '' })
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done('PIN removed. They cannot start a session until a new one is set (unless the location does not ask for PINs).')
}

export async function setStaffActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  const supabase = await createClient()
  const { error } = await db(supabase).from('staff').update({ active }).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(active ? 'Back in the list.' : 'Removed from the list. Their name stays on every payment they took.')
}

export async function setStaffOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const sort_order = Number(formData.get('sort_order'))
  if (!Number.isInteger(sort_order)) return fail('Order must be a whole number; lower comes first.')
  const supabase = await createClient()
  const { error } = await db(supabase).from('staff').update({ sort_order }).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done('Order saved.')
}
