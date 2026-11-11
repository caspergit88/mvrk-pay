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
  const [{ data, error }, { data: locData }] = await Promise.all([
    db(supabase)
      .from('profiles')
      .select('id, email, full_name, role, location_id, active, must_change_password, username, staff_id, created_at, location:locations(name)')
      .order('active', { ascending: false })
      .order('full_name'),
    db(supabase).from('locations').select('id, name').eq('active', true).order('name'),
  ])
  const rows = (data ?? []) as unknown as Row[]
  const locations = (locData ?? []) as { id: string; name: string }[]

  return (
    <>
      <SettingsBreadcrumb current="Users" />
      <PageHeader title="Users" subtitle="Everyone who can sign in. Accounts are made here, not requested." />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          Each person can have their own login: a <strong>username and password</strong>, no email needed. A reception login made
          this way is that person — their name goes on every payment, with no name to pick and no PIN. A desk can instead share
          one email login (e.g. reception@kitepeople.com) whose people pick their name and PIN at sign-in.
        </Note>

        <Card title="Add someone">
          <Disclosure label="Add A New Login">
            <ActionForm action={addUser} className="max-w-md space-y-3">
              <Field label="Name" hint="As it shows on payments and reports, e.g. Rimon or Mo Rahman.">
                <input name="full_name" type="text" required className={inputClass} />
              </Field>
              <Field label="Username" hint="What they type to sign in, e.g. rimon. Leave blank for an email login.">
                <input
                  name="username"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}"
                  className={inputClass}
                />
              </Field>
              <Field label="Location" hint="For a username login: where they work (Manager and Admin: any, e.g. MVRK HQ).">
                <select name="location_id" defaultValue="" className={inputClass}>
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email (optional with a username)" hint="Only for a login that signs in by email, e.g. reception@kitepeople.com.">
                <input name="email" type="email" autoComplete="off" className={inputClass} />
              </Field>
              <Field
                label="Password"
                hint={
                  codes
                    ? 'At least 8 characters. Required for a username; leave blank for an email login that signs in by code.'
                    : 'At least 8 characters.'
                }
              >
                <input name="password" type="text" minLength={8} autoComplete="off" className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input type="checkbox" name="must_change" defaultChecked /> Ask them to choose their own password at first sign-in
              </label>
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
                    <div className="text-xs text-stone-500">{u.username ? `username: ${u.username}` : u.email}</div>
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
                        minLength={8}
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
