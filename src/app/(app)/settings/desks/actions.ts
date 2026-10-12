'use server'

import { revalidatePath } from 'next/cache'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/desks'
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/

export async function addDesk(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const location_id = String(formData.get('location_id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase()
  if (!location_id) return fail('Pick a location.')
  if (!name) return fail('Give the desk a name, e.g. Desk 2 or Shop.')
  if (!SLUG.test(slug)) return fail('Slug: lower-case letters, digits and hyphens, e.g. desk-2.')

  const supabase = await createClient()
  const { error } = await db(supabase).from('desks').insert({ location_id, name, slug })
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(`${name} added. Open its display link on the iPad once.`)
}

export async function renameDesk(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!id || !name) return fail('Give the desk a name.')
  const supabase = await createClient()
  const { error } = await db(supabase).from('desks').update({ name }).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done('Renamed.')
}

export async function setDeskActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  const supabase = await createClient()
  const { error } = await db(supabase).from('desks').update({ active }).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(active ? 'Desk reactivated.' : 'Desk deactivated. Its display link no longer answers.')
}

export async function rotateDisplayKey(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { error } = await db(supabase).rpc('rotate_display_key', { p_desk: id })
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done('New display link made. The old one has stopped working — open the new link on the iPad.')
}
