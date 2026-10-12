import Link from 'next/link'

export const SETTINGS_SECTIONS = [
  {
    href: '/settings/locations',
    label: 'Locations',
    blurb: 'Each site: its email domain, timezone, what the display says, the finance address, limits, Wi-Fi.',
  },
  {
    href: '/settings/desks',
    label: 'Desks & displays',
    blurb: 'The desks at each location and the link each customer display opens.',
  },
  {
    href: '/settings/staff',
    label: 'Staff names',
    blurb: 'The names in the “Who are you?” list at sign-in, and their PINs.',
  },
  {
    href: '/settings/users',
    label: 'Users',
    blurb: 'Who can sign in, with which role, at which location.',
  },
  {
    href: '/settings/providers',
    label: 'Payment providers',
    blurb: 'Network today; up to five. Arrives in Phase 5.',
  },
  {
    href: '/settings/apps',
    label: 'Apps',
    blurb: 'The tiles on the launcher, and which roles see each one.',
  },
]

/** Back link + sibling jump list, so a phone never has to go via the hub. */
export function SettingsBreadcrumb({ current }: { current: string }) {
  const others = SETTINGS_SECTIONS.filter((s) => s.label !== current)
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
      <Link href="/settings" className="font-medium text-stone-700 hover:underline">
        Settings
      </Link>
      <span aria-hidden>/</span>
      <span className="font-medium text-stone-900">{current}</span>
      <span aria-hidden className="mx-1 text-stone-300">
        |
      </span>
      {others.map((s) => (
        <Link key={s.href} href={s.href} className="hover:text-stone-800 hover:underline">
          {s.label}
        </Link>
      ))}
    </nav>
  )
}
