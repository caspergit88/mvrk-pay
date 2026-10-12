import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Nav } from '@/components/nav'
import { switchPerson } from '@/app/who/actions'

/**
 * Every signed-in screen: the session check (profile + live pay.sessions row)
 * and the header. Reception's location and chosen name come along for the
 * header; admin and finance have neither.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile()
  const supabase = await createClient()

  const [{ data: location }, { data: staff }] = await Promise.all([
    profile.location_id
      ? db(supabase).from('locations').select('name').eq('id', profile.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.session.staff_id
      ? db(supabase).from('staff_names').select('name').eq('id', profile.session.staff_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return (
    <>
      <Nav
        role={profile.role}
        name={profile.full_name}
        locationName={(location as { name: string } | null)?.name ?? null}
        cashierName={(staff as { name: string } | null)?.name ?? null}
        switchPerson={profile.role === 'reception' ? switchPerson : undefined}
      />
      <main className="app-shell mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  )
}
