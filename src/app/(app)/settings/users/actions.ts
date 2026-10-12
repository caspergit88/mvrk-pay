'use server'

import { revalidatePath } from 'next/cache'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { isRole, ROLE_LABELS } from '@/lib/types'
import { done, fail, type ActionState } from '../_lib/action-state'

const PATH = '/settings/users'

/**
 * The lock-out guard, in one place so both actions read the same way. The
 * database's keep_one_admin trigger backs this up; the message here is kinder.
 */
function wouldLockSelfOut(selfId: string, targetId: string, change: { role?: string; active?: boolean }): string | null {
  if (selfId !== targetId) return null
  if (change.role !== undefined && change.role !== 'admin') {
    return 'You cannot move yourself off Admin. Ask another Admin to change it for you — otherwise nobody would be able to reach Settings.'
  }
  if (change.active === false) {
    return 'You cannot deactivate your own account. Ask another Admin to do it once they have taken over.'
  }
  return null
}

type Service = { client: ReturnType<typeof createServiceClient>; error?: undefined } | { client?: undefined; error: ActionState }

function serviceOrFail(): Service {
  try {
    return { client: createServiceClient() }
  } catch (e) {
    return {
      error: fail(
        e instanceof Error
          ? `${e.message} — accounts cannot be created or reset until it is set on the server (Vercel → Environment Variables).`
          : 'The service role key is not configured on the server.',
      ),
    }
  }
}

export async function setUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireSettingsAdmin()
  const userId = String(formData.get('user_id') ?? '')
  const role = formData.get('role')
  if (!userId) return fail('No user selected.')
  if (!isRole(role)) return fail('Pick a role from the list.')
  const locked = wouldLockSelfOut(me.id, userId, { role })
  if (locked) return fail(locked)

  const supabase = await createClient()
  // Reception's location is set by the database from the email domain; admin
  // and finance have none. The trigger fixes location_id on a role change.
  const { error } = await db(supabase)
    .from('profiles')
    .update({ role, location_id: role === 'reception' ? undefined : null })
    .eq('id', userId)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(`Role changed to ${ROLE_LABELS[role]}. It applies on their next page.`)
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireSettingsAdmin()
  const userId = String(formData.get('user_id') ?? '')
  const active = formData.get('active') === 'true'
  if (!userId) return fail('No user selected.')
  const locked = wouldLockSelfOut(me.id, userId, { active })
  if (locked) return fail(locked)

  const supabase = await createClient()
  const { error } = await db(supabase).from('profiles').update({ active }).eq('id', userId)
  if (error) return fail(error.message)
  revalidatePath(PATH)
  return done(active ? 'Account reactivated.' : 'Account deactivated. Their next request is refused; every payment they took stays as it is.')
}

/**
 * Add a login with a password, in one step — the weddings app's way: no invite
 * email to get lost, the person signs in at once and must replace the password
 * before seeing anything. The password reaches Supabase Auth and nowhere else.
 */
export async function addUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const role = formData.get('role')

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address — it is what they sign in with.')
  if (!fullName) return fail('Enter the person’s name so accounts can be told apart.')
  if (!isRole(role)) return fail('Pick a role from the list.')
  if (password.length < 10) return fail('Use at least 10 characters for the password. They will change it on first sign-in.')

  // The domain rule, before Auth is touched (the database enforces it again on the profile row).
  const supabase = await createClient()
  const { data: location } = await db(supabase).rpc('location_for_domain', { p_domain: email.split('@')[1] })
  if (!location) return fail("That email isn't on an MVRK team domain (kitepeople.com, mvrkhq.com, waspoclub.com, riahkiteacademy.com).")

  // ------------------------------------------------------------------------
  // The one legitimate request-path use of createServiceClient(): creating the
  // Auth user needs the service role. requireSettingsAdmin() ran first.
  // ------------------------------------------------------------------------
  const svc = serviceOrFail()
  if (svc.client === undefined) return svc.error
  const service = svc.client

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, app: 'mvrk-pay' },
  })
  if (error) return fail(error.message)
  const userId = data.user?.id
  if (!userId) return fail('The account was not created.')

  const { error: profileError } = await db(service)
    .from('profiles')
    .insert({ id: userId, email, full_name: fullName, role, must_change_password: true })
  if (profileError) {
    // Do not leave an Auth user with no profile: it could sign in and see nothing useful.
    await service.auth.admin.deleteUser(userId)
    return fail(profileError.message)
  }

  revalidatePath(PATH)
  return done(`${fullName} can sign in now as ${ROLE_LABELS[role]}. Tell them the password in person; it only works once.`)
}

/** A new starter password for someone who forgot theirs. */
export async function setStarterPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSettingsAdmin()
  const userId = String(formData.get('user_id') ?? '')
  const password = String(formData.get('password') ?? '')
  if (!userId) return fail('No user selected.')
  if (password.length < 10) return fail('Use at least 10 characters.')

  const svc = serviceOrFail()
  if (svc.client === undefined) return svc.error
  const { error } = await svc.client.auth.admin.updateUserById(userId, { password })
  if (error) return fail(error.message)
  const { error: flagError } = await db(svc.client).from('profiles').update({ must_change_password: true }).eq('id', userId)
  if (flagError) return fail(`Password set, but the "must change" flag was not: ${flagError.message}`)
  revalidatePath(PATH)
  return done('Starter password set. It works once; they choose their own at sign-in.')
}
