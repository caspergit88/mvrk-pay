import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Every MVRK Pay table and function lives in the `pay` schema of the shared
 * Supabase project. This is the one place that names it: call sites write
 * `db(supabase).from('transactions')` and `db(supabase).rpc('open_order', …)`
 * and never mention the schema themselves.
 */
export const SCHEMA = 'pay'

// supabase-js types the schema client generically; without generated database
// types the schema name is checked only at runtime, which is what we want here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function db(client: SupabaseClient<any, any, any>) {
  return client.schema(SCHEMA)
}
