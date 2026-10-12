'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/locations'

const timeZones = new Set(Intl.supportedValuesOf('timeZone'))

const LocationInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'Slug: lower-case letters, digits and hyphens, e.g. kitepeople.'),
  name: z.string().trim().min(2, 'Give the location a name.'),
  email_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Email domain like kitepeople.com, without the @.'),
  timezone: z.string().refine((t) => timeZones.has(t), 'Not a known timezone (e.g. Africa/Cairo).'),
  brand_label: z.string().trim().min(1).max(20),
  idle_text: z.string().trim().min(1).max(60),
  finance_email: z.union([z.literal(''), z.email('Finance email does not look like an address.')]),
  max_amount: z.coerce.number().positive('Max amount must be above zero.').max(1_000_000),
  order_expiry_min: z.coerce.number().int().min(1).max(240),
  logout_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Logout time as HH:MM, e.g. 22:00.'),
  require_pin: z.coerce.boolean(),
  wifi_ssid: z.string().trim().max(32),
  wifi_password: z.string().max(63),
  wifi_security: z.enum(['WPA', 'WEP', 'nopass']),
  active: z.coerce.boolean(),
})

function read(formData: FormData) {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>
  return LocationInput.safeParse({
    ...raw,
    require_pin: raw.require_pin === 'on' || raw.require_pin === 'true',
    active: raw.active === undefined ? true : raw.active === 'on' || raw.active === 'true',
  })
}

function toRow(v: z.infer<typeof LocationInput>) {
  const row: Record<string, unknown> = {
    slug: v.slug,
    name: v.name,
    email_domain: v.email_domain,
    timezone: v.timezone,
    brand_label: v.brand_label,
    idle_text: v.idle_text,
    finance_email: v.finance_email || null,
    max_amount_minor: Math.round(v.max_amount * 100),
    order_expiry_min: v.order_expiry_min,
    logout_time: v.logout_time,
    require_pin: v.require_pin,
    wifi_ssid: v.wifi_ssid || null,
    wifi_security: v.wifi_security,
    active: v.active,
  }
  // A blank password box means "leave it as it is"; the word CLEAR removes it.
  if (v.wifi_password === 'CLEAR') row.wifi_password = null
  else if (v.wifi_password) row.wifi_password = v.wifi_password
  return row
}

export async function saveLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return fail('No location selected.')
  const parsed = read(formData)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.')

  const supabase = await createClient()
  const { error } = await db(supabase).from('locations').update(toRow(parsed.data)).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(`${parsed.data.name} saved. The display picks it up on its next refresh.`)
}

export async function addLocation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const parsed = read(formData)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Check the form.')

  const supabase = await createClient()
  const row = toRow(parsed.data)
  const { data, error } = await db(supabase).from('locations').insert(row).select('id').single()
  if (error) return fail(error.message)
  // Every location starts with one desk; the database adds its display row.
  const { error: deskError } = await db(supabase)
    .from('desks')
    .insert({ location_id: (data as { id: string }).id, slug: 'desk-1', name: 'Desk 1' })
  if (deskError) return fail(`Location added, but its first desk was not: ${deskError.message}`)
  revalidatePath(PATH)
  revalidatePath('/settings/desks')
  return done(`${parsed.data.name} added with one desk. Add its staff names next.`)
}
