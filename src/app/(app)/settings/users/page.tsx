import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, EmptyState, ErrorState, Flag, Note, PageHeader } from '@/components/ui'
import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Profile } from '@/lib/types'
import { emailCodesAvailable } from '@/lib/login-guard'
import { ActionForm } from '../_components/action-form'
import { ConfirmSubmit, Disclosure } from '../_components/confirm'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { addUser, setStarterPassword, setUserActive, setUserRole } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Users · Settings' }

type Row = Profile & { created_at: string; location: { name: string } | null }

export default async function UsersPage() {
  const me = await requireSettingsAdmin()
  const codes = emailCodesAvailable()
  const supabase = await createClient()
  const { data, error } = await db(supabase)
    .from('profiles')
    .select('id, email, full_name, role, location_id, active, must_change_password, created_at, location:locations(name)')
    .order('active', { ascending: false })
    .order('full_name')
  const rows = (data ?? []) as unknown as Row[]

  return (
    <>
      <SettingsBreadcrumb current="Users" />
      <PageHeader title="Users" subtitle="Everyone who can sign in. Accounts are made here, not requested." />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          A reception login is usually shared by a desk — one per location, e.g. reception@kitepeople.com — and the person on the
          desk picks their own name at sign-in. Admin and finance are personal logins. Logins must be on a team domain.
        </Note>

        <Card title="Add someone">
          <Disclosure label="Add A New Login">
            <ActionForm action={addUser} className="max-w-md space-y-3">
              <Field label="Email">
                <input name="email" type="email" required autoComplete="off" placeholder="reception@kitepeople.com" className={inputClass} />
              </Field>
              <Field label="Name" hint="For a shared reception login, the desk’s name is fine: “KitePeople reception”.">
                <input name="full_name" type="text" required className={inputClass} />
              </Field>
              <Field
                label={codes ? 'Starter password (optional)' : 'Starter password'}
                hint={
                  codes
                    ? 'Leave blank: they sign in with a code emailed to them. Fill in only for someone who cannot get email.'
                    : 'At least 10 characters. They type it once and then replace it.'
                }
              >
                <input name="password" type="text" required={!codes} minLength={10} autoComplete="off" className={inputClass} />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue="reception" className={inputClass}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <ul className="space-y-1 text-xs text-stone-500">
                {ROLES.map((r) => (
                  <li key={r}>
                    <strong className="text-stone-700">{ROLE_LABELS[r]}:</strong> {ROLE_DESCRIPTIONS[r]}
                  </li>
                ))}
              </ul>
              <SubmitButton pendingLabel="Creating…">Create login</SubmitButton>
            </ActionForm>
          </Disclosure>
        </Card>

        <Card title="Everyone">
          {rows.length === 0 ? (
            <EmptyState title="No logins yet" description="Add the first one above." />
          ) : (
            <ul className="divide-y divide-stone-100">
              {rows.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[14rem]">
                    <div className="text-sm font-medium text-stone-900">
                      {u.full_name}
                      {u.id === me.id && <span className="ml-2 text-xs text-stone-400">(you)</span>}
                    </div>
                    <div className="text-xs text-stone-500">{u.email}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Flag tone="info">{ROLE_LABELS[u.role]}</Flag>
                    {u.location?.name && <Flag tone="info">{u.location.name}</Flag>}
                    {!u.active && <Flag tone="bad">Deactivated</Flag>}
                    {u.active && u.must_change_password && <Flag tone="warn">Starter password not yet replaced</Flag>}
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <ActionForm action={setUserRole} className="flex items-center gap-1">
                      <input type="hidden" name="user_id" value={u.id} />
                      <select name="role" defaultValue={u.role} className={`${inputClass} w-32`} aria-label="Role">
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton variant="secondary" pendingLabel="…">
                        Set role
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={setStarterPassword} className="flex items-center gap-1">
                      <input type="hidden" name="user_id" value={u.id} />
                      <input
                        name="password"
                        type="text"
                        minLength={10}
                        autoComplete="off"
                        placeholder="New starter password"
                        className={`${inputClass} w-44`}
                        aria-label={`New starter password for ${u.full_name}`}
                      />
                      <SubmitButton variant="secondary" pendingLabel="…">
                        Reset
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={setUserActive}>
                      <input type="hidden" name="user_id" value={u.id} />
                      <input type="hidden" name="active" value={u.active ? 'false' : 'true'} />
                      {u.active ? (
                        <ConfirmSubmit
                          label="Deactivate"
                          consequence={`${u.full_name} will be refused on their next request. Nothing they did is changed.`}
                          pendingLabel="…"
                        />
                      ) : (
                        <SubmitButton variant="secondary" pendingLabel="…">
                          Reactivate
                        </SubmitButton>
                      )}
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
