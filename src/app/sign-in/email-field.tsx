'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/supabase/db'
import { Field, FormError, SubmitButton, inputClass } from '@/components/forms'

type Lookup = { state: 'idle' | 'checking' | 'ok' | 'refused' | 'offline'; name?: string }

const ALLOWED_HINT = 'Logins use kitepeople.com, mvrkhq.com, waspoclub.com or riahkiteacademy.com.'

/**
 * The email box, the location chip under it, and the password box that only
 * appears once the domain is one of ours. The real rule lives in the database;
 * this is so a reception desk never types a password into a form that is about
 * to be refused.
 */
export function EmailField({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef('')

  useEffect(() => {
    const domain = email.trim().toLowerCase().split('@')[1] ?? ''
    if (timer.current) clearTimeout(timer.current)
    // Wait for something that could be a domain before asking.
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      setLookup({ state: 'idle' })
      return
    }
    latest.current = domain
    setLookup({ state: 'checking' })
    timer.current = setTimeout(async () => {
      const { data, error } = await db(createClient()).rpc('location_for_domain', { p_domain: domain })
      if (latest.current !== domain) return
      // A failed request is not a refusal: say so, and let the server decide at submit.
      if (error) {
        setLookup({ state: 'offline' })
        return
      }
      const row = data as { name?: string } | null
      setLookup(row && row.name ? { state: 'ok', name: row.name } : { state: 'refused' })
    }, 300)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [email])

  const recognised = lookup.state === 'ok' || lookup.state === 'offline'

  return (
    <>
      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="reception@kitepeople.com"
        />
      </Field>

      {lookup.state === 'ok' && (
        <p className="flex items-center gap-2 text-sm text-stone-600">
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
            {lookup.name}
          </span>
          You’ll be taking payments for this location.
        </p>
      )}
      {lookup.state === 'refused' && (
        <FormError message={`This email isn't on an MVRK team domain. ${ALLOWED_HINT}`} />
      )}
      {lookup.state === 'offline' && (
        <p className="text-sm text-amber-700">Couldn’t check the address just now — carry on, it is checked again when you sign in.</p>
      )}

      {recognised && (
        <Field label="Password">
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} autoFocus />
        </Field>
      )}

      <SubmitButton pendingLabel="Signing in…" disabled={!recognised}>
        Sign in
      </SubmitButton>
    </>
  )
}
