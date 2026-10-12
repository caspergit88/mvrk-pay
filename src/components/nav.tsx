'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { AppRole } from '@/lib/types'

const NAV: { href: string; label: string; roles: AppRole[] }[] = [
  { href: '/pay', label: 'Take payment', roles: ['admin', 'reception'] },
  { href: '/transactions', label: 'Transactions', roles: ['admin', 'finance'] },
  { href: '/report', label: 'Day report', roles: ['admin', 'finance', 'reception'] },
  { href: '/settings', label: 'Settings', roles: ['admin'] },
]

/**
 * The header on every signed-in screen: where you are, who you are, and the
 * two exits — Switch person for a shift change, Sign out for the night.
 */
export function Nav({
  role,
  name,
  locationName,
  cashierName,
  switchPerson,
}: {
  role: AppRole
  name: string
  locationName: string | null
  cashierName: string | null
  switchPerson?: () => Promise<void>
}) {
  const pathname = usePathname()
  const items = NAV.filter((n) => n.roles.includes(role))

  return (
    <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-900 text-navy-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
        <Link href="/" className="font-semibold tracking-[0.2em] text-white">
          MVRK PAY
        </Link>
        {locationName && <span className="rounded-full bg-navy-800 px-2 py-0.5 text-xs text-navy-200">{locationName}</span>}
        <nav className="flex items-center gap-1">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/')
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-2.5 py-1 ${active ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'}`}
              >
                {n.label}
              </Link>
            )
          })}
          {role === 'admin' && (
            <Link href="/apps" className="rounded-md px-2.5 py-1 text-navy-200 hover:bg-navy-800 hover:text-white">
              Apps
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-navy-200">
          <span className="hidden sm:inline">{cashierName ?? name}</span>
          {switchPerson && (
            <form action={switchPerson}>
              <button className="rounded-md border border-navy-600 px-2.5 py-1 text-xs hover:bg-navy-800">Switch person</button>
            </form>
          )}
          <form action="/auth/sign-out" method="post">
            <button className="rounded-md border border-navy-600 px-2.5 py-1 text-xs hover:bg-navy-800">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  )
}
