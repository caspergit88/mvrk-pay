'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { providerFor, type ProviderRow } from '@/lib/providers'
import { forgetCredential } from '@/lib/providers/credentials'
import { PROVIDER_LABELS, type ProviderKind } from '@/lib/types'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/providers'
/** A Vault secret / environment variable name, e.g. NGENIUS_API_KEY. */
const CREDENTIAL_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
const OUTLET = /^[0-9a-f-]{8,64}$/i
/** N-Genius realm follows the environment: live UAE accounts vs sandbox. */
const REALMS: Record<string, string> = { live: 'NetworkInternational', sandbox: 'ni' }

const isKind = (v: string): v is ProviderKind => v in PROVIDER_LABELS

/** Add a provider (no id) or edit one (id). Location is fixed once added — its payments are filed under it. */
export async function saveProvider(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const location_id = String(formData.get('location_id') ?? '')
  const kind = String(formData.get('kind') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const outletRef = String(formData.get('outlet_ref') ?? '').trim()
  const env = String(formData.get('env') ?? 'live')
  const credential = String(formData.get('credential_ref') ?? '').trim().toUpperCase()
  const enabled = formData.get('enabled') === 'on'
  const is_default = formData.get('is_default') === 'on'

  if (!id && !location_id) return fail('Pick a location.')
  if (!isKind(kind)) return fail('Pick a provider type.')
  if (!name) return fail('Give the provider a name, e.g. Network (N-Genius).')
  if (credential && !CREDENTIAL_NAME.test(credential))
    return fail('Credential name: capital letters, digits and underscores, e.g. NGENIUS_API_KEY. It is the name of the Vault secret, not the key itself.')
  if (kind === 'ngenius') {
    if (!OUTLET.test(outletRef)) return fail('Outlet reference: copy it from the N-Genius portal (Settings → Outlets), e.g. 85c6ced8-572f-….')
    if (!(env in REALMS)) return fail('Pick live or sandbox.')
    if (!credential) return fail('Network needs a credential name — the Vault secret holding the API key, e.g. NGENIUS_API_KEY.')
  }
  if (is_default && !enabled) return fail('A default provider has to be enabled. Tick Enabled, or untick Default.')

  const supabase = await createClient()

  // Keep any settings this form does not edit (portal URL, base URL for the mock).
  let settings: Record<string, unknown> = {}
  let locationId = location_id
  if (id) {
    const { data: existing, error } = await db(supabase).from('providers').select('location_id, settings').eq('id', id).single()
    if (error) return fail(error.message)
    settings = (existing.settings ?? {}) as Record<string, unknown>
    locationId = existing.location_id as string
  }
  if (kind === 'ngenius') settings = { ...settings, env, realm: REALMS[env], outletRef }
  else if (outletRef) settings = { ...settings, outletRef }

  // One default per location (a unique index): clear the old one first.
  if (is_default) {
    let clear = db(supabase).from('providers').update({ is_default: false }).eq('location_id', locationId).eq('is_default', true)
    if (id) clear = clear.neq('id', id)
    const { error } = await clear
    if (error) return fail(error.message)
  }

  const row = { kind, name, credential_ref: credential || null, enabled, is_default, settings }
  const { error } = id
    ? await db(supabase).from('providers').update(row).eq('id', id)
    : await db(supabase).from('providers').insert({ ...row, location_id: locationId })
  if (error) return fail(error.message)

  revalidatePath(PATH)
  revalidatePath('/settings')
  if (id) return done(`${name} saved.`)
  return done(
    kind === 'ngenius'
      ? `${name} added. Add its API key as a Vault secret named ${credential}, press Test connection, then paste its webhook URL into the N-Genius portal.`
      : `${name} added.`,
  )
}

/** Ask the provider for a token without creating a payment. The token itself is never shown. */
export async function testProviderConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { data, error } = await db(supabase).from('providers').select('*').eq('id', id).single()
  if (error) return fail(error.message)
  const row = data as ProviderRow

  let ok = false
  let message: string
  try {
    forgetCredential(row.credential_ref)
    const provider = await providerFor(row)
    message = await provider.testConnection()
    ok = true
  } catch (e) {
    message = e instanceof Error ? e.message : 'Unknown error.'
  }
  // The outcome, not the token or the provider's raw reply.
  await db(supabase).rpc('log_action', {
    p_entity: 'providers',
    p_entity_id: row.id,
    p_action: 'test_connection',
    p_after: { ok, message },
  })
  return ok ? done(`Connected. ${message}`) : fail(`Could not connect: ${message}`)
}

/** A new webhook token. The old URL is refused from this moment. */
export async function regenerateWebhookToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { error } = await db(supabase).from('providers').update({ webhook_token: randomBytes(16).toString('hex') }).eq('id', id)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(
    'New webhook URL made; the old one is refused from now on. Paste the new one into the N-Genius portal. Until then, payments still confirm — the screens ask Network directly.',
  )
}
