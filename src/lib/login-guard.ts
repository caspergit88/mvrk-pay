import 'server-only'
import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { sendEmail } from '@/lib/email'

/**
 * Login protection (migration 0008): rate limits per email and per address,
 * and the admin's emailed one-time code. Everything here goes through the
 * service role — the database refuses these functions to signed-in users and
 * to the public key, so nobody can lock someone else out or mint a code.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

function service(): Client | null {
  try {
    return createServiceClient()
  } catch {
    return null
  }
}

/** The caller's address as Vercel reports it. Empty when unknown (local dev). */
export function clientIp(h: Headers): string {
  const real = h.get('x-real-ip')
  if (real) return real.trim()
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim()
}

/**
 * Null when the sign-in may go ahead, else the message to show. Without a
 * service-role key (local dev) or before 0008 is applied, the limit is not
 * enforced — logged, never fatal, so a missing migration cannot lock David out.
 */
export async function loginBlocked(email: string, ip: string): Promise<string | null> {
  const s = service()
  if (!s) return null
  const { data, error } = await db(s).rpc('login_allowed', { p_email: email, p_ip: ip })
  if (error) {
    console.warn('login_allowed unavailable; sign-in limit not enforced:', error.message)
    return null
  }
  return typeof data === 'string' && data ? data : null
}

export async function noteLogin(email: string, ip: string, ok: boolean) {
  const s = service()
  if (!s) return
  const { error } = await db(s).rpc('login_note', { p_email: email, p_ip: ip, p_ok: ok })
  if (error) console.warn('login_note unavailable:', error.message)
}

/**
 * The admin code is asked for when it can be delivered: a service-role key
 * and Resend are both configured. Until then (the first admin login comes
 * before Resend, DEPLOYMENT.md §2) sign-in skips it and the audit log says so.
 * ADMIN_EMAIL_CODE=off switches it off deliberately.
 */
export function adminCodeRequired(): boolean {
  if ((process.env.ADMIN_EMAIL_CODE ?? '').toLowerCase() === 'off') return false
  return emailCodesAvailable()
}

/**
 * Codes can be delivered: the service-role key (to issue them and open the
 * session) and Resend (to send them). Until then sign-in is by password only.
 */
export function emailCodesAvailable(): boolean {
  const has = (k: string) => Boolean(process.env[k]?.trim())
  return has('SUPABASE_SERVICE_ROLE_KEY') && has('RESEND_API_KEY') && (has('RESEND_FROM_EMAIL') || has('RESEND_FROM'))
}

/**
 * Email a sign-in code (migration 0010). Sends nothing, quietly, when the
 * email has no active login — the page says the same either way. Throws with
 * a message for people when the hourly allowance is used up or Resend fails.
 */
export async function sendLoginCode(email: string) {
  const s = service()
  if (!s) throw new Error('Sign-in codes need the service-role key on the server.')
  const { data: code, error } = await db(s).rpc('issue_login_code', { p_email: email })
  if (error) throw new Error(error.message)
  if (typeof code !== 'string' || !code) return
  const result = await sendEmail(s, {
    kind: 'login_code',
    to: [email],
    subject: `${code} is your MVRK Pay sign-in code`,
    text: `${code}\n\nThis is your MVRK Pay sign-in code. It works once, for the next 10 minutes.\n\nIf you did not just ask for it, you can ignore this email — nobody can sign in without the code.`,
    logText: 'Sign-in code sent (the code itself is not kept).',
    logSubject: 'MVRK Pay sign-in code',
    dedupeKey: `login-code:${email}:${Date.now()}`,
  })
  if (!result.sent) throw new Error(`The code could not be emailed (${result.detail ?? result.reason}). Try again in a minute, or use a password.`)
}

/**
 * Check a sign-in code and, when it is right, open a Supabase session for that
 * email on `supabase` (the request's own client, so the session cookies are
 * set on the response). Null on success, else what to tell the person.
 *
 * The session comes from a one-time link token minted with the service role
 * and redeemed at once on the server; no link is ever emailed.
 */
export async function signInWithLoginCode(supabase: Client, email: string, code: string): Promise<string | null> {
  const s = service()
  if (!s) return 'Sign-in codes need the service-role key on the server.'
  const { data: wrong, error } = await db(s).rpc('verify_login_code', { p_email: email, p_code: code })
  if (error) return error.message
  if (typeof wrong === 'string' && wrong) return wrong

  const { data: link, error: linkError } = await s.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) return `Sign-in did not complete (${linkError?.message ?? 'no token'}). Try again.`
  const { error: otpError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (otpError) return `Sign-in did not complete (${otpError.message}). Try again.`
  return null
}

/**
 * Someone who signs in by code no longer needs the starter password an admin
 * gave them; replace it with one nobody knows, so it cannot be used later.
 */
export async function retireStarterPassword(userId: string) {
  const s = service()
  if (!s) return
  const { error } = await s.auth.admin.updateUserById(userId, { password: randomBytes(24).toString('base64url') })
  if (error) return
  await db(s).from('profiles').update({ must_change_password: false }).eq('id', userId)
}

/** The Supabase session id in the signed-in person's verified token. */
export async function sessionIdOf(supabase: Client): Promise<string | null> {
  const { data } = await supabase.auth.getClaims()
  const sid = (data?.claims as { session_id?: unknown } | undefined)?.session_id
  return typeof sid === 'string' && sid ? sid : null
}

/** Migration 0008 is not in this database yet: the code step cannot run, so it is skipped rather than locking the admin out. */
export class AdminCodeUnavailable extends Error {}

/** Make a code for this sign-in and email it. Throws with a message for people. */
export async function sendAdminCode(profile: { id: string; email: string }, sessionId: string) {
  const s = service()
  if (!s) throw new Error('Sign-in codes need the service-role key on the server.')
  const { data: code, error } = await db(s).rpc('issue_admin_code', { p_profile: profile.id, p_session: sessionId })
  if (error?.code === 'PGRST202') throw new AdminCodeUnavailable(error.message)
  if (error) throw new Error(error.message)

  const result = await sendEmail(s, {
    kind: 'admin_code',
    to: [profile.email],
    subject: `${code} is your MVRK Pay sign-in code`,
    text: `${code}\n\nThis is your MVRK Pay sign-in code. It works once, for the next 10 minutes.\n\nIf you did not just sign in, someone has your password: change it in MVRK Pay and tell David.`,
    // The email log is readable by finance; it records that a code went, never the code.
    logText: 'Sign-in code sent (the code itself is not kept).',
    logSubject: 'MVRK Pay sign-in code',
    dedupeKey: `admin-code:${sessionId}:${Date.now()}`,
  })
  if (!result.sent) throw new Error(`The code could not be emailed (${result.detail ?? result.reason}). Try again in a minute.`)
}

/** Null when the code is right, else what to tell the person. */
export async function checkAdminCode(profileId: string, sessionId: string, code: string): Promise<string | null> {
  const s = service()
  if (!s) return 'Sign-in codes need the service-role key on the server.'
  const { data, error } = await db(s).rpc('verify_admin_code', { p_profile: profileId, p_session: sessionId, p_code: code })
  if (error) return error.message
  return typeof data === 'string' && data ? data : null
}
