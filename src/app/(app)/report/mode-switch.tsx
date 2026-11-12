import Link from 'next/link'

/** "One day" or "Date range" — shown to Admin, Manager and Finance only. */
export function ModeSwitch({ mode }: { mode: 'day' | 'range' }) {
  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100'}`
  return (
    <div className="mb-4 inline-flex gap-1 rounded-lg border border-stone-200 bg-white p-1">
      <Link href="/report" className={tab(mode === 'day')}>
        One day
      </Link>
      <Link href="/report?mode=range" className={tab(mode === 'range')}>
        Date range
      </Link>
    </div>
  )
}
