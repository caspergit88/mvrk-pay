import { headers } from 'next/headers'
import { requireSettingsAdmin } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { credentialStatus, type CredentialStatus } from '@/lib/providers/credentials'
import { Card, ErrorState, Flag, Note, PageHeader } from '@/components/ui'
import { SubmitButton } from '@/components/forms'
import { PROVIDER_LABELS, type Location, type ProviderKind } from '@/lib/types'
import { ActionForm } from '../_components/action-form'
import { ConfirmSubmit, Disclosure } from '../_components/confirm'
import { CopyButton } from '../_components/copy-button'
import { SettingsBreadcrumb } from '../_components/settings-nav'
import { ProviderForm } from './provider-form'
import { regenerateWebhookToken, testProviderConnection } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payment providers · Settings' }

/** The database refuses a sixth (pay.providers_max_five). */
const MAX_PROVIDERS = 5

type Row = {
  id: string
  location_id: string
  kind: ProviderKind
  name: string
  currency: string
  enabled: boolean
  is_default: boolean
  credential_ref: string | null
  settings: { env?: string; outletRef?: string }
  webhook_token: string
}

async function origin() {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  return `${proto}://${host}`
}

function CredentialFlag({ kind, status }: { kind: ProviderKind; status: CredentialStatus }) {
  if (kind === 'mock') return <Flag tone="info">Not needed (mock)</Flag>
  switch (status.source) {
    case 'vault':
      return <Flag tone="good">Set in Vault</Flag>
    case 'env':
      return <Flag tone="good">Set in environment</Flag>
    case 'unnamed':
      return <Flag tone="warn">No credential name</Flag>
    case 'missing':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Flag tone="bad">Not found</Flag>
          {!status.vaultChecked && <span className="text-xs text-stone-500">Vault not checked here (no service-role key).</span>}
        </span>
      )
  }
}

export default async function ProvidersPage() {
  await requireSettingsAdmin()
  const supabase = await createClient()
  const [{ data: locations, error }, { data }] = await Promise.all([
    db(supabase).from('locations').select('id, name, active').order('name'),
    db(supabase)
      .from('providers')
      .select('id, location_id, kind, name, currency, enabled, is_default, credential_ref, settings, webhook_token')
      .order('name'),
  ])
  const locs = (locations ?? []) as Pick<Location, 'id' | 'name' | 'active'>[]
  const rows = (data ?? []) as Row[]
  const base = await origin()

  const refs = [...new Set(rows.map((r) => r.credential_ref ?? ''))]
  const statuses = new Map(await Promise.all(refs.map(async (ref) => [ref, await credentialStatus(ref || null)] as const)))
  const full = rows.length >= MAX_PROVIDERS

  return (
    <>
      <SettingsBreadcrumb current="Payment providers" />
      <PageHeader title="Payment providers" subtitle={`${rows.length} of ${MAX_PROVIDERS}. Euro only. Each location takes payments through its default.`} />
      {error && <ErrorState message={error.message} />}

      <div className="space-y-4">
        <Note>
          A provider’s API key is a Supabase Vault secret (Integrations → Vault → Add secret) under the credential name shown here, or an
          environment variable of that name. This page only says whether it is found — the key itself is never shown, logged or sent to the
          browser.
        </Note>

        {locs.map((l) => {
          const mine = rows.filter((p) => p.location_id === l.id)
          if (mine.length === 0 && !l.active) return null
          return (
            <Card key={l.id} title={l.name}>
              <div className="space-y-4">
                {mine.length === 0 && <p className="text-sm text-stone-500">No provider yet — this location cannot take payments.</p>}
                {mine.map((p) => {
                  const webhook = `${base}/api/webhooks/ngenius?token=${p.webhook_token}`
                  return (
                    <div key={p.id} className="rounded-lg border border-stone-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-stone-900">{p.name}</span>
                        <span className="text-xs text-stone-500">{PROVIDER_LABELS[p.kind]}</span>
                        {p.enabled ? <Flag tone="good">Enabled</Flag> : <Flag tone="bad">Disabled</Flag>}
                        {p.is_default && <Flag tone="info">Default</Flag>}
                        {p.kind === 'ngenius' && p.settings.env === 'sandbox' && <Flag tone="warn">Sandbox</Flag>}
                      </div>

                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                        <dt className="text-stone-500">Credential</dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          {p.credential_ref && <code className="text-xs text-stone-700">{p.credential_ref}</code>}
                          <CredentialFlag kind={p.kind} status={statuses.get(p.credential_ref ?? '')!} />
                        </dd>
                        {p.settings.outletRef && (
                          <>
                            <dt className="text-stone-500">Outlet</dt>
                            <dd>
                              <code className="text-xs text-stone-700">{p.settings.outletRef}</code>
                            </dd>
                          </>
                        )}
                        <dt className="text-stone-500">Currency</dt>
                        <dd>{p.currency}</dd>
                      </dl>

                      {p.kind === 'ngenius' && (
                        <div className="mt-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-stone-600">Webhook URL for the N-Genius portal</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <code className="max-w-full truncate rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">{webhook}</code>
                            <CopyButton text={webhook} label="Copy URL" />
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        <ActionForm action={testProviderConnection}>
                          <input type="hidden" name="id" value={p.id} />
                          <SubmitButton variant="secondary" pendingLabel="Testing…">
                            Test connection
                          </SubmitButton>
                        </ActionForm>
                        {p.kind === 'ngenius' && (
                          <ActionForm action={regenerateWebhookToken}>
                            <input type="hidden" name="id" value={p.id} />
                            <ConfirmSubmit
                              label="Regenerate webhook URL"
                              consequence="The current URL is refused the moment you confirm. Paste the new one into the N-Genius portal; until then payments still confirm, because the screens ask Network directly."
                              variant="danger"
                              pendingLabel="Regenerating…"
                            />
                          </ActionForm>
                        )}
                      </div>

                      <div className="mt-3">
                        <Disclosure label="Edit">
                          <ProviderForm values={p} locations={locs} submitLabel="Save" />
                        </Disclosure>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}

        <Card title="Add a provider">
          {full ? (
            <p className="text-sm text-stone-600">
              All {MAX_PROVIDERS} places are taken. Providers are never deleted (their payments refer to them), so edit one that is no longer
              used instead.
            </p>
          ) : (
            <Disclosure label="Add a provider">
              <ProviderForm values={{}} locations={locs.filter((l) => l.active)} submitLabel="Add provider" />
            </Disclosure>
          )}
        </Card>
      </div>
    </>
  )
}
