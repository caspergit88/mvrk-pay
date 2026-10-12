'use server'

import { revalidatePath } from 'next/cache'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { isRole, ROLES } from '@/lib/types'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/apps'

type Parsed = { error: ActionState; row?: undefined } | { row: { name: string; url: string; icon: string; sort_order: number; roles: string[]; active: boolean }; error?: undefined }

function read(formData: FormData): Parsed {
  const name = String(formData.get('name') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  const icon = String(formData.get('icon') ?? 'app').trim() || 'app'
  const sort_order = Number(formData.get('sort_order') ?? 100)
  const roles = ROLES.filter((r) => formData.get(`role_${r}`) === 'on')
  const active = formData.get('active') === 'on'
  if (!name) return { error: fail('Give the tile a name.') }
  if (url && !/^(https?:\/\/|\/)/.test(url)) return { error: fail('The address must start with https:// (another app) or / (a page in this one).') }
  if (!Number.isInteger(sort_order)) return { error: fail('Order must be a whole number; lower comes first.') }
  if (roles.length === 0 || !roles.every(isRole)) return { error: fail('Tick at least one role that may see the tile.') }
  return { row: { name, url, icon, sort_order, roles, active } }
}

export async function saveApp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const parsed = read(formData)
  if (parsed.error !== undefined) return parsed.error
  const supabase = await createClient()
  const { error } = await db(supabase).from('apps').update(parsed.row).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  revalidatePath('/apps')
  return done(`${parsed.row.name} saved.`)
}

export async function addApp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const parsed = read(formData)
  if (parsed.error !== undefined) return parsed.error
  const supabase = await createClient()
  const { error } = await db(supabase).from('apps').insert(parsed.row)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  revalidatePath('/apps')
  return done(`${parsed.row.name} is on the launcher.`)
}
