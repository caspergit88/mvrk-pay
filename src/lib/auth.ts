import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { adminCodeRequired } from '@/lib/login-guard'
import type { AppRole, Profile, Session } from '@/lib/types'

/**
 * The signed-in person's MVRK Pay profile, or a redirect to sign-in.
 *
 * Same shape as the weddings app's requireProfile, with one addition that is
 * the whole point of this app's login rules: a profile is not enough, the
 * person also needs a live row in pay.sessions. That row is written by
 * "Who are you?" (reception) or by sign-in itself (admin, finance) and carries
 * the 22:00 expiry. No row, or an expired one, and they are sent to sign in
 * again — RLS is the real boundary, this is the friendly one.
 */
export async function requireProfile(): Promise<Profile & { session: Session }> {
  const profile = await requireUser()
  const session = await currentSession()
  if (!session) {
    if (profile.role === 'reception') redirect('/who')
    // An admin who signed in but has not entered the emailed code yet goes back to it.
    if (profile.role === 'admin' && adminCodeRequired()) redirect('/sign-in/code')
    // Admin and finance get their session at sign-in; a missing one means it
    // expired at 22:00. Sign them out cleanly rather than leaving a half-state.
    redirect('/auth/expired')
  }
  return { ...profile, session }
}

/**
 * Profile only, no session check. For the pages between sign-in and the
 * payment screen: "Who are you?", set-password, no-access.
 */
export async function requireUser(): Promise<Profile> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await db(supabase)
    .from('profiles')
    .select('id, email, full_name, role, location_id, active, must_change_password')
    .eq('id', user.id)
    .maybeSingle()

  // A weddings-app login, or a deactivated one, has no usable pay profile.
  if (!profile || !profile.active) redirect('/no-access')
  if (profile.must_change_password) redirect('/set-password')
  return profile as Profile
}

export async function currentSession(): Promise<Session | null> {
  const supabase = await createClient()
  const { data, error } = await db(supabase).rpc('current_session')
  if (error || !data) return null
  // A set-returning-row function comes back as one object (or null) here.
  const row = (Array.isArray(data) ? data[0] : data) as Session | undefined
  return row && row.session_id ? row : null
}

/**
 * The same checks as requireProfile, for API routes: null instead of a
 * redirect, so the route can answer 401 and the screen can show why.
 */
export async function apiProfile(): Promise<(Profile & { session: Session }) | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await db(supabase)
    .from('profiles')
    .select('id, email, full_name, role, location_id, active, must_change_password')
    .eq('id', user.id)
    .maybeSingle()
  const p = profile as Profile | null
  if (!p || !p.active || p.must_change_password) return null
  const session = await currentSession()
  if (!session) return null
  return { ...p, session }
}

export async function requireRole(...roles: AppRole[]) {
  const profile = await requireProfile()
  if (!roles.includes(profile.role)) redirect('/no-access')
  return profile
}

/** Settings, and only settings: admin. Finance reads everything but changes nothing. */
export async function requireSettingsAdmin() {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/no-access')
  return profile
}

/** Taking or clearing a payment: reception at their location, or admin. */
export async function requireDesk() {
  return requireRole('admin', 'reception')
}

export const canManageSettings = (role: AppRole) => role === 'admin'
export const canSeeAllLocations = (role: AppRole) => role === 'admin' || role === 'finance'
export const canTakePayments = (role: AppRole) => role === 'admin' || role === 'reception'

/** Where each role lands after sign-in. */
export function homePathFor(role: AppRole): string {
  if (role === 'admin') return '/apps'
  if (role === 'finance') return '/transactions'
  return '/'
}
