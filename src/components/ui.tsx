import Link from 'next/link'
import type { ReactNode } from 'react'
import type { DisplayStatus } from '@/lib/types'

// The same kit as the weddings app (copied, not imported — CONVENTIONS.md),
// with StatusChip retuned to payment statuses.

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          {typeof title === 'string' ? (
            <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'warn' | 'good' | 'bad'
}) {
  const tones = {
    default: 'text-stone-900',
    warn: 'text-amber-700',
    good: 'text-emerald-700',
    bad: 'text-red-700',
  }
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  )
}

const STATUS_TONES: Record<DisplayStatus, string> = {
  Waiting: 'bg-sky-50 text-sky-800 ring-sky-200',
  Declined: 'bg-amber-50 text-amber-800 ring-amber-200',
  Paid: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  Refunded: 'bg-violet-50 text-violet-800 ring-violet-200',
  'Not confirmed': 'bg-amber-50 text-amber-800 ring-amber-200',
  Expired: 'bg-stone-100 text-stone-700 ring-stone-200',
  Replaced: 'bg-stone-100 text-stone-700 ring-stone-200',
  Unpaid: 'bg-stone-100 text-stone-700 ring-stone-200',
}

export function StatusChip({ status }: { status: DisplayStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONES[status] ?? STATUS_TONES.Unpaid}`}
    >
      {status}
    </span>
  )
}

export function Flag({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' | 'info' | 'good' }) {
  const tones = {
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    bad: 'bg-red-50 text-red-800 ring-red-200',
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-stone-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <strong className="font-semibold">Something went wrong.</strong> {message}
    </div>
  )
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-left">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children = null, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function LinkButton({ href, children, variant = 'secondary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  const styles =
    variant === 'primary'
      ? 'bg-stone-900 text-white hover:bg-stone-800'
      : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
  return (
    <Link href={href} className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition ${styles}`}>
      {children}
    </Link>
  )
}

/** A short plain-English note explaining a consequence, above a list or form. */
export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
  }
  return <p className={`rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>
}
