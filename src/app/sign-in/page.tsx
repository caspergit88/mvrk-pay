import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { homePathFor } from '@/lib/auth'
import { FormError } from '@/components/forms'
import { Note } from '@/components/ui'
import { emailCodesAvailable } from '@/lib/login-guard'
import { EmailField } from './email-field'
import { signIn } from './actions'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; expired?: string; password?: string }>
}) {
  const params = await searchParams
  const codes = emailCodesAvailable()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Already signed in with a pay profile: no reason to show the form.
  if (user) {
    const { data } = await db(supabase).from('profiles').select('role, active').eq('id', user.id).maybeSingle()
    const profile = data as Pick<Profile, 'role' | 'active'> | null
    if (profile?.active) redirect(profile.role === 'reception' ? '/who' : homePathFor(profile.role))
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">
          MVRK <span className="text-stone-400">Pay</span>
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          {codes ? 'Sign in with your team email — we’ll email you a code.' : 'Sign in with your location’s team email.'}
        </p>

        <form action={signIn} className="mt-6 space-y-4">
          {params.expired && (
            <Note>The desk signs out at 22:00 every night. Sign in again to start the day.</Note>
          )}
          <FormError message={params.error} />
          <EmailField codes={codes} passwordFirst={Boolean(params.password)} />
        </form>

        <p className="mt-6 text-xs text-stone-400">Accounts are made by David in Settings. Ask if you need one.</p>
      </div>
    </div>
  )
}
