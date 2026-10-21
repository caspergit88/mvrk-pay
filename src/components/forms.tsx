'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

export function SubmitButton({
  children,
  variant = 'primary',
  pendingLabel,
  disabled,
  title,
  formAction,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  pendingLabel?: string
  disabled?: boolean
  title?: string
  /** A different server action for this button than the form's own. */
  formAction?: (formData: FormData) => void | Promise<void>
}) {
  const { pending } = useFormStatus()
  const styles = {
    primary: 'bg-stone-900 text-white hover:bg-stone-800',
    secondary: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }[variant]

  return (
    <button
      type="submit"
      title={title}
      formAction={formAction}
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-600">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100'

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  )
}
