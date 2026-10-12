import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, ErrorState, Flag, Note, PageHeader } from '@/components/ui'
import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ActionForm } from '../_components/action-form'
import { Disclosure } from '../_components/confirm'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { addStaff, clearPin, setPin, setStaffActive, setStaffOrder } from './actions'
import type { Location, StaffName } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Staff names · Settings' }

export default async function StaffPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const [{ data: locations, error }, { data: staff }] = await Promise.all([
    db(supabase).from('locations').select('id, name, require_pin').order('name'),
    db(supabase).from('staff_names').select('*').order('sort_order').order('name'),
  ])
  const locs = (locations ?? []) as Pick<Location, 'id' | 'name' | 'require_pin'>[]
  const all = (staff ?? []) as StaffName[]

  return (
    <>
      <SettingsBreadcrumb current="Staff names" />
      <PageHeader title="Staff names" subtitle="The names reception picks from at sign-in. Not logins — the location’s account is the login." />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          A PIN stops one person taking payments under another’s name. Set it here and tell them in person. Locations that do not
          ask for a PIN (Settings → Locations) ignore it.
        </Note>

        {locs.map((l) => {
          const mine = all.filter((s) => s.location_id === l.id)
          return (
            <Card
              key={l.id}
              title={
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-800">{l.name}</span>
                  {!l.require_pin && <Flag tone="info">PINs not required here</Flag>}
                </span>
              }
            >
              <div className="space-y-3">
                {mine.length === 0 && <p className="text-sm text-stone-500">Nobody yet — reception cannot sign in here until a name is added.</p>}
                {mine.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 p-3">
                    <span className={`min-w-[8rem] text-sm font-medium ${s.active ? 'text-stone-900' : 'text-stone-400 line-through'}`}>
                      {s.name}
                    </span>
                    {s.has_pin ? <Flag tone="good">PIN set</Flag> : <Flag tone="warn">No PIN</Flag>}
                    <ActionForm action={setPin} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <input
                        name="pin"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        placeholder="New PIN"
                        autoComplete="off"
                        className={`${inputClass} w-24`}
                        aria-label={`New PIN for ${s.name}`}
                      />
                      <SubmitButton variant="secondary" pendingLabel="…">
                        Set
                      </SubmitButton>
                    </ActionForm>
                    {s.has_pin && (
                      <ActionForm action={clearPin}>
                        <input type="hidden" name="id" value={s.id} />
                        <SubmitButton variant="secondary" pendingLabel="…">
                          Clear PIN
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <ActionForm action={setStaffOrder} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <input name="sort_order" type="number" defaultValue={s.sort_order} className={`${inputClass} w-20`} aria-label="Order" />
                      <SubmitButton variant="secondary" pendingLabel="…">
                        Order
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={setStaffActive} className="ml-auto">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="active" value={s.active ? 'false' : 'true'} />
                      <SubmitButton variant="secondary" pendingLabel="…">
                        {s.active ? 'Remove from list' : 'Put back'}
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ))}
                <Disclosure label={`Add A Name At ${l.name}`}>
                  <ActionForm action={addStaff} className="grid max-w-md gap-3 sm:grid-cols-2">
                    <input type="hidden" name="location_id" value={l.id} />
                    <Field label="Name">
                      <input name="name" required className={inputClass} placeholder="Anna" />
                    </Field>
                    <Field label="PIN (optional now)">
                      <input name="pin" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" className={inputClass} />
                    </Field>
                    <div className="sm:col-span-2">
                      <SubmitButton pendingLabel="Adding…">Add name</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
