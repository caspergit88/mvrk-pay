import { headers } from 'next/headers'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, ErrorState, Flag, Note, PageHeader } from '@/components/ui'
import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ActionForm } from '../_components/action-form'
import { ConfirmSubmit, Disclosure } from '../_components/confirm'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { CopyButton } from './copy-button'
import { addDesk, renameDesk, rotateDisplayKey, setDeskActive } from './actions'
import type { Desk, Location } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Desks & displays · Settings' }

async function origin() {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

export default async function DesksPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const [{ data: locations, error }, { data: desks }] = await Promise.all([
    db(supabase).from('locations').select('id, name, slug, active').order('name'),
    db(supabase).from('desks').select('*').order('slug'),
  ])
  const locs = (locations ?? []) as Pick<Location, 'id' | 'name' | 'slug' | 'active'>[]
  const all = (desks ?? []) as Desk[]
  const base = await origin()

  return (
    <>
      <SettingsBreadcrumb current="Desks & displays" />
      <PageHeader title="Desks & displays" subtitle="Each desk has one customer display, opened once with its own link." />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          The link carries the desk’s key. Anyone with it can watch that desk’s amounts and codes, nothing more — but if a link
          leaks, regenerate it here and the old one stops at once.
        </Note>

        {locs.map((l) => {
          const mine = all.filter((d) => d.location_id === l.id)
          return (
            <Card key={l.id} title={l.name}>
              <div className="space-y-4">
                {mine.length === 0 && <p className="text-sm text-stone-500">No desks yet.</p>}
                {mine.map((d) => {
                  const url = `${base}/display/${l.slug}/${d.slug}?key=${d.display_key}`
                  return (
                    <div key={d.id} className="rounded-lg border border-stone-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionForm action={renameDesk} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={d.id} />
                          <input name="name" defaultValue={d.name} className={`${inputClass} w-40`} aria-label="Desk name" />
                          <SubmitButton variant="secondary" pendingLabel="…">
                            Rename
                          </SubmitButton>
                        </ActionForm>
                        <span className="text-xs text-stone-500">/{d.slug}</span>
                        {!d.active && <Flag tone="bad">Inactive</Flag>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="max-w-full truncate rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">{url}</code>
                        <CopyButton text={url} />
                        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-stone-700 underline">
                          Open
                        </a>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionForm action={rotateDisplayKey}>
                          <input type="hidden" name="id" value={d.id} />
                          <ConfirmSubmit
                            label="Regenerate link"
                            consequence="The current link stops working the moment you confirm. The iPad on this desk will need the new link opened on it."
                            variant="danger"
                            pendingLabel="Regenerating…"
                          />
                        </ActionForm>
                        <ActionForm action={setDeskActive}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="active" value={d.active ? 'false' : 'true'} />
                          <SubmitButton variant="secondary" pendingLabel="…">
                            {d.active ? 'Deactivate' : 'Reactivate'}
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </div>
                  )
                })}
                <Disclosure label={`Add A Desk At ${l.name}`}>
                  <ActionForm action={addDesk} className="grid max-w-md gap-3 sm:grid-cols-2">
                    <input type="hidden" name="location_id" value={l.id} />
                    <Field label="Name">
                      <input name="name" required placeholder="Desk 2" className={inputClass} />
                    </Field>
                    <Field label="Slug">
                      <input name="slug" required placeholder="desk-2" pattern="[a-z0-9][a-z0-9-]{0,31}" className={inputClass} />
                    </Field>
                    <div className="sm:col-span-2">
                      <SubmitButton pendingLabel="Adding…">Add desk</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              </div>
            </Card>
          )
        })}

        <Card title="iPad setup">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">
            <li>Open the desk’s link in Safari on the iPad and sign nothing in — the link is the key.</li>
            <li>Share → Add to Home Screen, then open it from there so it runs full-screen.</li>
            <li>Settings → Display &amp; Brightness → Auto-Lock → Never.</li>
            <li>Settings → Accessibility → Guided Access, and lock the iPad into the display.</li>
          </ol>
        </Card>
      </div>
    </>
  )
}
