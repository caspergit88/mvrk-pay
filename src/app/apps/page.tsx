import Link from 'next/link'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import type { AppTile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apps · MVRK' }

/**
 * The launcher: one big tile per app this person may open, in the style of the
 * Odoo home screen. The tiles are rows in pay.apps (Settings → Apps), so a third
 * app is a row, not a code change. RLS already limits the rows to the roles that
 * may see them.
 */
export default async function AppsPage() {
  const profile = await requireProfile()
  const supabase = await createClient()
  const { data } = await db(supabase).from('apps').select('*').eq('active', true).order('sort_order')
  const tiles = (data ?? []) as AppTile[]

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      <header className="flex items-center justify-between px-6 py-4 text-sm text-navy-200">
        <span className="font-semibold tracking-[0.25em] text-white">MVRK</span>
        <div className="flex items-center gap-4">
          <span>{profile.full_name}</span>
          <form action="/auth/sign-out" method="post">
            <button className="rounded-md border border-navy-600 px-3 py-1 text-navy-100 hover:bg-navy-800">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {tiles.length === 0 ? (
          <p className="text-center text-navy-200">No apps are switched on for your role yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-4">
            {tiles.map((t) => (
              <li key={t.id} className="flex flex-col items-center">
                <Tile tile={t} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function Tile({ tile }: { tile: AppTile }) {
  const body = (
    <>
      <span
        aria-hidden
        className="flex h-24 w-24 items-center justify-center rounded-3xl bg-navy-700 text-3xl font-bold text-teal-300 shadow-lg ring-1 ring-navy-500 transition group-hover:bg-navy-600"
      >
        {icon(tile.icon)}
      </span>
      <span className="mt-3 text-center text-sm font-medium text-navy-50">{tile.name}</span>
    </>
  )
  const className = 'group flex flex-col items-center'
  // Tiles without a URL yet (the weddings app's address is a Settings row) are shown but inert.
  if (!tile.url) {
    return (
      <span className={`${className} opacity-50`} title="No address set yet — Settings → Apps">
        {body}
      </span>
    )
  }
  const external = /^https?:\/\//.test(tile.url)
  return external ? (
    <a href={tile.url} className={className}>
      {body}
    </a>
  ) : (
    <Link href={tile.url} className={className}>
      {body}
    </Link>
  )
}

/** A glyph per tile. Plain characters so there is nothing to load on a kiosk. */
function icon(name: string): string {
  switch (name) {
    case 'pay':
      return '€'
    case 'weddings':
      return '♥'
    case 'kite':
      return '✦'
    default:
      return '▣'
  }
}
