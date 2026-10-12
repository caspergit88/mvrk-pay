import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Request-scoped client carrying the signed-in user's JWT, so every query runs
 * under that user's RLS policies. Use this for all normal reads and writes.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          try {
            items.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component; the middleware refreshes the session.
          }
        },
      },
    },
  )
}

/**
 * Service-role client. Only for background jobs (cron, Drive mirroring, imports)
 * that run without a user. It bypasses RLS, so never hand it a value that came
 * from a request without checking the caller's role first.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}
