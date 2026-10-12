import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Field, FormError, SubmitButton, inputClass } from '@/components/forms'
import { EmptyState } from '@/components/ui'
import { chooseName } from './actions'
import type { Location, StaffName } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function WhoPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams
  const profile = await requireUser()
  if (profile.role !== 'reception') redirect('/')

  const supabase = await createClient()
  const [{ data: location }, { data: staff }] = await Promise.all([
    db(supabase).from('locations').select('id, name, require_pin').eq('id', profile.location_id!).maybeSingle(),
    db(supabase)
      .from('staff_names')
      .select('id, name, has_pin, sort_order')
      .eq('location_id', profile.location_id!)
      .eq('active', true)
      .order('sort_order')
      .order('name'),
  ])
  const loc = location as Pick<Location, 'id' | 'name' | 'require_pin'> | null
  const names = (staff ?? []) as Pick<StaffName, 'id' | 'name' | 'has_pin' | 'sort_order'>[]

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">{loc?.name ?? 'MVRK Pay'}</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Who are you?</h1>
        <p className="mt-1 text-sm text-stone-500">
          Your name goes on every payment you take and on the end-of-day report.
        </p>

        {names.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No names set up for this location yet"
              description="David adds the team’s names in Settings → Staff. Until then nobody can take a payment here."
            />
          </div>
        ) : (
          <form action={chooseName} className="mt-6 space-y-4">
            <FormError message={params.error} />
            <Field label="Your name">
              <select name="staff_id" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Pick your name…
                </option>
                {names.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {loc?.require_pin && (
              <Field label="Your PIN" hint="Four digits. Ask David if you don’t have one yet.">
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="off"
                  required
                  className={inputClass}
                />
              </Field>
            )}
            <SubmitButton pendingLabel="One moment…">Start taking payments</SubmitButton>
          </form>
        )}

        <form action="/auth/sign-out" method="post" className="mt-6">
          <button className="text-xs text-stone-400 hover:text-stone-600 hover:underline">Not this location? Sign out</button>
        </form>
      </div>
    </div>
  )
}
