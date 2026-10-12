import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { ProviderError } from './types'

/**
 * A provider's API key, by the name on its row (`credential_ref`).
 *
 * Looked up in Supabase Vault first (through pay.read_secret, which only the
 * service role may call), then in the environment under the same name. The
 * value is used inside the adapter and goes nowhere else: never into a log, a
 * response, the audit trail or the browser.
 */
const memo = new Map<string, { value: string; at: number }>()
const MEMO_MS = 5 * 60_000

export async function resolveCredential(ref: string | null | undefined, providerName: string): Promise<string> {
  if (!ref) throw new ProviderError(`Provider "${providerName}" has no credential name set (Settings → Payment providers).`, 500)
  const hit = memo.get(ref)
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value

  let value: string | null = null
  try {
    const service = createServiceClient()
    const { data } = await db(service).rpc('read_secret', { p_name: ref })
    if (typeof data === 'string' && data.trim()) value = data.trim()
  } catch {
    // No service role here (local dev without the key): fall through to the environment.
  }
  if (!value) {
    const env = process.env[ref]
    if (env && env.trim()) value = env.trim()
  }
  if (!value) {
    throw new ProviderError(
      `No credential found for "${ref}". Add it as a Supabase Vault secret with that name, or as an environment variable.`,
      500,
    )
  }
  memo.set(ref, { value, at: Date.now() })
  return value
}

/** Drop a cached key, so Test connection uses the one in Vault right now. */
export function forgetCredential(ref: string | null | undefined) {
  if (ref) memo.delete(ref)
}

export type CredentialStatus = {
  source: 'vault' | 'env' | 'missing' | 'unnamed'
  /** False when there is no service-role key here, so Vault could not be asked. */
  vaultChecked: boolean
}

/**
 * Where a provider's key would come from — for Settings, which says
 * "set in Vault" / "set in environment" / "not found" and nothing more. The
 * value is looked at only to see that it is there, and is not returned.
 */
export async function credentialStatus(ref: string | null | undefined): Promise<CredentialStatus> {
  if (!ref) return { source: 'unnamed', vaultChecked: false }
  let vaultChecked = false
  try {
    const service = createServiceClient()
    const { data, error } = await db(service).rpc('read_secret', { p_name: ref })
    if (!error) {
      vaultChecked = true
      if (typeof data === 'string' && data.trim()) return { source: 'vault', vaultChecked }
    }
  } catch {
    // No service role here: Vault cannot be asked.
  }
  const env = process.env[ref]
  if (env && env.trim()) return { source: 'env', vaultChecked }
  return { source: 'missing', vaultChecked }
}
