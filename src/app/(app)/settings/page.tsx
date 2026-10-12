import Link from 'next/link'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, PageHeader } from '@/components/ui'
import { SETTINGS_SECTIONS } from './_components/settings-nav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · MVRK Pay' }

async function counts() {
  const supabase = await createClient()
  const head = { count: 'exact' as const, head: true }
  const [locations, desks, staff, users, providers, apps] = await Promise.all([
    db(supabase).from('locations').select('id', head).eq('active', true),
    db(supabase).from('desks').select('id', head).eq('active', true),
    db(supabase).from('staff_names').select('id', head).eq('active', true),
    db(supabase).from('profiles').select('id', head).eq('active', true),
    db(supabase).from('providers').select('id', head).eq('enabled', true),
    db(supabase).from('apps').select('id', head).eq('active', true),
  ])
  const n = (r: { count: number | null }) => r.count ?? 0
  return {
    '/settings/locations': `${n(locations)} active`,
    '/settings/desks': `${n(desks)} active`,
    '/settings/staff': `${n(staff)} names`,
    '/settings/users': `${n(users)} active ${n(users) === 1 ? 'account' : 'accounts'}`,
    '/settings/providers': `${n(providers)} of 5 enabled`,
    '/settings/apps': `${n(apps)} tiles`,
  } as Record<string, string>
}

export default async function SettingsHubPage() {
  const profile = await requireSettingsAdmin()
  const hints = await counts()
  return (
    <>
      <PageHeader title="Settings" subtitle={`Admin only. Signed in as ${profile.full_name}.`} />
      <p className="mb-5 max-w-2xl text-sm text-stone-600">
        Everything here changes how the rest of the app behaves, without a redeploy. Rows are deactivated
        rather than deleted, and every change is written to the audit log with your name on it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="group block">
            <Card className="h-full transition group-hover:border-stone-400 group-hover:shadow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-stone-900">{section.label}</h2>
                  <p className="mt-1 text-sm text-stone-500">{section.blurb}</p>
                  {hints[section.href] && <p className="mt-2 text-xs font-medium text-stone-400">{hints[section.href]}</p>}
                </div>
                <span aria-hidden className="mt-0.5 text-stone-300 transition group-hover:text-stone-500">
                  →
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}
