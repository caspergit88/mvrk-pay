'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/supabase/db'
import { Field, FormError, inputClass } from '@/components/forms'

/**
 * Replace the starter password an admin set, or finish a password reset.
 *
 * Same shape as the weddings app's page: a client component, because a reset
 * link carries its tokens in the URL fragment, which never reaches the server.
 */
export default function SetPasswordPage() {
  const [state, setState] = useState<'checking' | 'ready' | 'saving' | 'expired' | 'done'>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    async function open() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const query = new URLSearchParams(window.location.search)
      const failure = hash.get('error_description') ?? hash.get('error')
      if (failure) {
        setError(failure.replace(/\+/g, ' '))
        setState('expired')
        return
      }
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) {
          setError(error.message)
          setState('expired')
          return
        }
        window.history.replaceState(null, '', '/set-password')
        setState('ready')
        return
      }
      const code = query.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setError(error.message)
          setState('expired')
          return
        }
        window.history.replaceState(null, '', '/set-password')
        setState('ready')
        return
      }
      const { data } = await supabase.auth.getUser()
      setState(data.user ? 'ready' : 'expired')
    }
    open()
  }, [])

  async function save(formData: FormData) {
    const password = String(formData.get('password') ?? '')
    const again = String(formData.get('password_again') ?? '')
    setError(null)
    if (password.length < 10) {
      setError('Use at least 10 characters. Longer is better than complicated.')
      return
    }
    if (password !== again) {
      setError('The two passwords are not the same.')
      return
    }
    setState('saving')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setState('ready')
      return
    }
    const { error: flagError } = await db(supabase).rpc('password_changed')
    if (flagError) {
      setError(`Your password is changed, but the app could not record it: ${flagError.message}`)
      setState('ready')
      return
    }
    setState('done')
    window.location.assign('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">Choose your password</h1>
        <p className="mt-1 text-sm text-stone-500">
          The one you were given only works once. Pick your own before you carry on.
        </p>

        {state === 'checking' && <p className="mt-6 text-sm text-stone-500">One moment…</p>}

        {state === 'expired' && (
          <div className="mt-6 space-y-3">
            <FormError message={error ?? 'This link has expired or was already used.'} />
            <a href="/sign-in" className="text-sm text-stone-700 underline">
              Back to sign in
            </a>
          </div>
        )}

        {(state === 'ready' || state === 'saving') && (
          <form action={save} className="mt-6 space-y-4">
            <FormError message={error} />
            <Field label="New password">
              <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
            </Field>
            <Field label="Again, to be sure">
              <input name="password_again" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
            </Field>
            <button
              type="submit"
              disabled={state === 'saving'}
              className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            >
              {state === 'saving' ? 'Saving…' : 'Save and continue'}
            </button>
          </form>
        )}

        {state === 'done' && <p className="mt-6 text-sm text-emerald-700">Saved. Taking you in…</p>}
      </div>
    </div>
  )
}
