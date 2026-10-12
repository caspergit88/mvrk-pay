'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import type { ActionState } from '../_lib/action-state'

/**
 * A form wired to a Settings server action. Every failure is visible and shows
 * the database's message word for word; every success says what changed.
 */
export function ActionForm({
  action,
  children,
  className = '',
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  children: ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, null)

  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </p>
      )}
    </form>
  )
}
