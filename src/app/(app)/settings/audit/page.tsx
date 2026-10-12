import Link from 'next/link'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { auditLabel, auditSummary, ENTITY_LABELS, type AuditEntry } from '@/lib/audit'
import { dateTime } from '@/lib/format'
import { Card, EmptyState, ErrorState, Note, PageHeader, Table, Td } from '@/components/ui'
import { SettingsBreadcrumb } from '../_components/settings-nav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Audit log · Settings' }

const LIMIT = 200

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  await requireSettingsAdmin()
  const { entity = '' } = await searchParams
  const supabase = await createClient()

  let query = db(supabase).from('audit_log').select('*').order('at', { ascending: false }).limit(LIMIT)
  if (entity) query = query.eq('entity', entity)
  const { data, error } = await query
  const rows = (data ?? []) as AuditEntry[]

  const actorIds = [...new Set(rows.map((r) => r.actor).filter((a): a is string => Boolean(a)))]
  const { data: people } = actorIds.length
    ? await db(supabase).from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] }
  const names = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]))

  const filters = [['', 'Everything'], ...Object.entries(ENTITY_LABELS)]

  return (
    <>
      <SettingsBreadcrumb current="Audit log" />
      <PageHeader title="Audit log" subtitle={`The last ${LIMIT} changes${entity ? ` to ${ENTITY_LABELS[entity] ?? entity}` : ''}, newest first.`} />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          Every change to a setting, a payment or a day close is written here by the database itself, with who did it. Nobody can edit or
          remove a line — not even an admin. Keys and links show as “changed”, never their value.
        </Note>

        <nav className="flex flex-wrap gap-2" aria-label="Filter by what changed">
          {filters.map(([value, label]) => {
            const on = value === entity
            return (
              <Link
                key={value || 'all'}
                href={value ? `/settings/audit?entity=${value}` : '/settings/audit'}
                aria-current={on ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  on ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {!error && rows.length === 0 ? (
          <EmptyState title="Nothing logged yet" description={entity ? 'Nothing has changed here yet. Try Everything.' : undefined} />
        ) : (
          <Card>
            <Table head={['When', 'Who', 'What', 'Change', 'Reason']}>
              {rows.map((r) => {
                const label = auditLabel(r.after ?? r.before)
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs">{dateTime(r.at)}</Td>
                    <Td>{r.actor ? (names.get(r.actor) ?? 'Unknown user') : <span className="text-stone-500">System</span>}</Td>
                    <Td>
                      <div className="font-medium">{ENTITY_LABELS[r.entity] ?? r.entity}</div>
                      <div className="text-xs text-stone-500">
                        {r.action.replace(/_/g, ' ')}
                        {label ? ` · ${label}` : ''}
                      </div>
                    </Td>
                    <Td className="max-w-md break-words text-xs text-stone-700">{auditSummary(r)}</Td>
                    <Td className="text-xs">{r.reason ?? ''}</Td>
                  </tr>
                )
              })}
            </Table>
          </Card>
        )}
      </div>
    </>
  )
}
