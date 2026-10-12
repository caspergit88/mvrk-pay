import { headers } from 'next/headers'
import { requireDesk } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { EmptyState, PageHeader } from '@/components/ui'
import { PayDesk } from './pay-desk'
import type { Desk, Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Take payment · MVRK Pay' }

/**
 * The payment screen. Reception sees their location's desks; an admin sees
 * every location's. The live part is the client component.
 */
export default async function PayPage({ searchParams }: { searchParams: Promise<{ desk?: string }> }) {
  const profile = await requireDesk()
  const params = await searchParams
  const supabase = await createClient()

  let desks = db(supabase).from('desks').select('*, location:locations(id, slug, name, wifi_ssid, timezone)').eq('active', true).order('slug')
  if (profile.role === 'reception') desks = desks.eq('location_id', profile.location_id!)
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
