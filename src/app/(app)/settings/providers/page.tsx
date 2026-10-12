import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { Card, ErrorState, Flag, Note, PageHeader, Table, Td } from '@/components/ui'
import { PROVIDER_LABELS, type ProviderKind } from '@/lib/types'
import { SettingsBreadcrumb } from '../_components/settings-nav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payment providers · Settings' }

type Row = {
  id: string
  kind: ProviderKind
  name: string
  currency: string
  enabled: boolean
  is_default: boolean
  credential_ref: string | null
  location: { name: string } | null
}

/** Read-only until Phase 5 adds add/edit/test-connection. */
export default async function ProvidersPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const { data, error } = await db(supabase)
    .from('providers')
    .select('id, kind, name, currency, enabled, is_default, credential_ref, location:locations(name)')
    .order('name')
  const rows = (data ?? []) as unknown as Row[]

  return (
    <>
      <SettingsBreadcrumb current="Payment providers" />
      <PageHeader title="Payment providers" subtitle="Up to five. Network International is live; adding and testing providers arrives in Phase 5." />
      {error && <ErrorState message={error.message} />}
      <div className="space-y-4">
        <Note>
          The API key for each provider is a Supabase Vault secret named in the “credential” column (or an environment variable of
          that name). It is never shown here.
        </Note>
        <Card>
          <Table head={['Provider', 'Location', 'Currency', 'Credential', 'Status']}>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-stone-500">{PROVIDER_LABELS[p.kind]}</div>
                </Td>
                <Td>{p.location?.name ?? '—'}</Td>
                <Td>{p.currency}</Td>
                <Td>
                  <code className="text-xs">{p.credential_ref ?? '—'}</code>
                </Td>
                <Td>
                  <span className="flex gap-1">
                    {p.enabled ? <Flag tone="good">Enabled</Flag> : <Flag tone="bad">Disabled</Flag>}
                    {p.is_default && <Flag tone="info">Default</Flag>}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  )
}
