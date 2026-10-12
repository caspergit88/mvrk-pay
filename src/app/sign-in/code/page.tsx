import { redirect } from 'next/navigation'
import { currentSession, homePathFor, requireUser } from '@/lib/auth'
import { FormError, SubmitButton, inputClass } from '@/components/forms'
import { Note } from '@/components/ui'
import { resendCode, verifyCode } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign-in code · MVRK Pay' }

/** Admin sign-in, step two: the code emailed to the admin's own address. */
export default async function SignInCodePage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const me = await requireUser()
  if (me.role !== 'admin') redirect('/')
  if (await currentSession()) redirect(homePathFor(me.role))
  const params = await searchParams

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-semibold tracking-tight">
          MVRK <span className="text-stone-400">Pay</span>
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          We emailed a six-digit code to <span className="font-medium text-stone-700">{me.email}</span>. It works once, for 10 minutes.
        </p>

        <form action={verifyCode} className="mt-6 space-y-4">
          {params.sent && <Note>A new code is on its way. Only the latest one works.</Note>}
          <FormError message={params.error} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-600">Code</span>
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\s*\d{6}\s*"
              maxLength={8}
              autoFocus
              className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
            />
          </label>
          <SubmitButton pendingLabel="Checking…">Sign in</SubmitButton>
        </form>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-stone-500">
          <form action={resendCode}>
            <button className="underline hover:text-stone-800">Send a new code</button>
          </form>
          <form action="/auth/sign-out" method="post">
            <button className="underline hover:text-stone-800">Use a different account</button>
          </form>
        </div>
      </div>
    </div>
  )
}
