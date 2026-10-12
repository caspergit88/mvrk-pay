import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, ErrorState, Flag, Note, PageHeader } from '@/components/ui'
import { Disclosure } from '../_components/confirm'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { LocationForm } from './location-form'
import { addLocation, saveLocation } from './actions'
import type { Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Locations · Settings' }

type Row = Location & { wifi_password: string | null }

export default async function LocationsPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const { data, error } = await db(supabase).from('locations').select('*').order('name')
  const rows = (data ?? []) as Row[]

  return (
    <>
      <SettingsBreadcrumb current="Locations" />
      <PageHeader title="Locations" subtitle="One per site. The email domain decides which location a login belongs to." />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          Changes apply at once: the display reads these on its next refresh, and sign-in uses the domain list live. Deactivating a
          location refuses its logins; it does not delete anything.
        </Note>

        {rows.map((l) => (
          <Card
            key={l.id}
            title={
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">{l.name}</span>
                <span className="text-xs text-stone-500">@{l.email_domain}</span>
                {!l.active && <Flag tone="bad">Inactive</Flag>}
                {l.wifi_ssid ? <Flag tone="good">Wi-Fi: {l.wifi_ssid}</Flag> : <Flag tone="info">No Wi-Fi screen</Flag>}
              </span>
            }
          >
            <LocationForm action={saveLocation} values={{ ...l, wifi_set: !!l.wifi_password }} submitLabel="Save" />
          </Card>
        ))}

        <Card title="Add a location">
          <Disclosure label="Add A New Location">
            <LocationForm action={addLocation} values={{}} submitLabel="Add location" />
          </Disclosure>
        </Card>
      </div>
    </>
  )
}
