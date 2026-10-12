import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, ErrorState, Note, PageHeader } from '@/components/ui'
import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ROLE_LABELS, ROLES, type AppTile } from '@/lib/types'
import { ActionForm } from '../_components/action-form'
import { Disclosure } from '../_components/confirm'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { addApp, saveApp } from './actions'
import type { ActionState } from '../_lib/action-state'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apps · Settings' }

function TileForm({ action, tile, submitLabel }: { action: (p: ActionState, f: FormData) => Promise<ActionState>; tile: Partial<AppTile>; submitLabel: string }) {
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      {tile.id && <input type="hidden" name="id" value={tile.id} />}
      <Field label="Name">
        <input name="name" required defaultValue={tile.name ?? ''} className={inputClass} />
      </Field>
      <Field label="Address" hint="https://… for another app, or / for a page here. Blank shows the tile greyed out.">
        <input name="url" defaultValue={tile.url ?? ''} className={inputClass} placeholder="https://weddings.example.com" />
      </Field>
      <Field label="Icon" hint="pay, weddings, kite or app">
        <input name="icon" defaultValue={tile.icon ?? 'app'} className={inputClass} />
      </Field>
      <Field label="Order">
        <input name="sort_order" type="number" defaultValue={tile.sort_order ?? 100} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm text-stone-700 sm:col-span-2">
        {ROLES.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="checkbox" name={`role_${r}`} defaultChecked={(tile.roles ?? ['admin']).includes(r)} /> {ROLE_LABELS[r]}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={tile.active ?? true} /> Shown
        </label>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  )
}

export default async function AppsSettingsPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const { data, error } = await db(supabase).from('apps').select('*').order('sort_order')
  const tiles = (data ?? []) as AppTile[]

  return (
    <>
      <SettingsBreadcrumb current="Apps" />
      <PageHeader title="Apps" subtitle="The tiles on the launcher an admin lands on. A new app is a row here." />
      {error && <ErrorState message={error.message} />}
      <div className="space-y-4">
        <Note>The Weddings tile needs the weddings app’s address before it does anything. Paste it below and save.</Note>
        {tiles.map((t) => (
          <Card key={t.id} title={t.name}>
            <TileForm action={saveApp} tile={t} submitLabel="Save" />
          </Card>
        ))}
        <Card title="Add a tile">
          <Disclosure label="Add A Tile">
            <TileForm action={addApp} tile={{}} submitLabel="Add tile" />
          </Disclosure>
        </Card>
      </div>
    </>
  )
}
