'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { SubmitButton } from '@/components/forms'

/**
 * Two-step submit. The first press only reveals what the change will do; the
 * second actually submits. Used for anything destructive or wide-reaching —
 * nothing in Settings that affects historical records goes through in one click.
 */
export function ConfirmSubmit({
  label,
  confirmLabel,
  consequence,
  variant = 'danger',
  pendingLabel,
}: {
  label: string
  confirmLabel?: string
  consequence: string
  variant?: 'primary' | 'secondary' | 'danger'
  pendingLabel?: string
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm text-amber-900">{consequence}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SubmitButton variant={variant} pendingLabel={pendingLabel}>
          {confirmLabel ?? label}
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * A form that only unfolds when asked for — keeps "Add a new…" out of the way
 * on a phone without hiding it behind a route change.
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
      >
        <span aria-hidden className="text-stone-400">
          {open ? '−' : '+'}
        </span>
        {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
