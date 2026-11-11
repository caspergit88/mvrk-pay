import { headers } from 'next/headers'
import { requireDesk } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { timeOnly } from '@/lib/format'
import { PayDesk } from './pay-desk'
import type { Desk, Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Take payment · MVRK Pay' }

/**
 * The payment screen. Reception works the one desk the app gave them at
 * sign-in (0013) — no choosing; an admin can switch between every location's
 * desks. The live part is the client component.
 */
export default async function PayPage({ searchParams }: { searchParams: Promise<{ desk?: string }> }) {
  const profile = await requireDesk()
  const params = await searchParams
  const supabase = await createClient()

  // Reception: their own desk. Without one (it was freed, or all were taken at sign-in), ask for one now.
  let myDesk = profile.session.desk_id ?? null
  if (profile.role === 'reception' && !myDesk) {
    const { data: claimed } = await db(supabase).rpc('claim_my_desk')
    myDesk = (claimed as string | null) ?? null
    if (!myDesk) return <AllDesksTaken locationId={profile.location_id!} />
  }

  let desks = db(supabase).from('desks').select('*, location:locations(id, slug, name, wifi_ssid, timezone)').eq('active', true).order('slug')
  if (profile.role === 'reception') desks = desks.eq('id', myDesk!)
  const { data } = await desks
  const rows = (data ?? []) as (Desk & { location: Pick<Location, 'id' | 'slug' | 'name' | 'wifi_ssid' | 'timezone'> })[]

  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'}`

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Take a payment" />
        <EmptyState title="No desk is set up for your location yet" description="David adds desks in Settings → Desks & displays." />
      </>
    )
  }

  const chosen = rows.find((d) => d.id === params.desk) ?? rows[0]

  return (
    <PayDesk
      desks={rows.map((d) => ({ id: d.id, slug: d.slug, name: d.name, locationName: d.location.name, locationSlug: d.location.slug, displayKey: d.display_key, wifiSsid: d.location.wifi_ssid, timezone: d.location.timezone }))}
      deskId={chosen.id}
      origin={origin}
      canTakePayments={profile.role !== 'finance'}
    />
  )
}

/** Every desk at the location is in use: say who is where, and who can free one. */
async function AllDesksTaken({ locationId }: { locationId: string }) {
  const supabase = await createClient()
  const { data } = await db(supabase).rpc('desk_occupancy', { p_location: locationId })
  const desks = (data ?? []) as { desk_id: string; desk_name: string; staff_name: string | null; since: string | null }[]
  return (
    <>
      <PageHeader title="Take a payment" subtitle="Every desk here is in use right now." />
      <Card>
        <ul className="divide-y divide-stone-100">
          {desks.map((d) => (
            <li key={d.desk_id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium text-stone-900">{d.desk_name}</span>
              <span className="text-stone-600">{d.staff_name ? `${d.staff_name}, since ${timeOnly(d.since)}` : 'free'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-stone-600">
          A desk becomes free when its person signs out. If someone left without signing out, ask David to free their desk; then reload
          this page and it is yours.
        </p>
      </Card>
    </>
  )
}
