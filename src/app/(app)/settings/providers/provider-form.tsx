import { Field, SubmitButton, inputClass } from '@/components/forms'
import { PROVIDER_LABELS, type Location, type ProviderKind } from '@/lib/types'
import { ActionForm } from '../_components/action-form'
import { saveProvider } from './actions'

export type ProviderValues = {
  id?: string
  location_id?: string
  kind?: ProviderKind
  name?: string
  credential_ref?: string | null
  enabled?: boolean
  is_default?: boolean
  settings?: { env?: string; outletRef?: string }
}

/** One form for both "edit this provider" and "add a provider". */
export function ProviderForm({
  values,
  locations,
  submitLabel,
}: {
  values: ProviderValues
  locations: Pick<Location, 'id' | 'name'>[]
  submitLabel: string
}) {
  const editing = Boolean(values.id)
  return (
    <ActionForm action={saveProvider} className="grid gap-3 sm:grid-cols-2">
      {editing && <input type="hidden" name="id" value={values.id} />}
      {!editing && (
        <Field label="Location" hint="Fixed once added — its payments are filed under it.">
          <select name="location_id" required defaultValue={values.location_id ?? ''} className={inputClass}>
            <option value="" disabled>
              Pick a location
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Type">
        <select name="kind" required defaultValue={values.kind ?? 'ngenius'} className={inputClass}>
          {(Object.keys(PROVIDER_LABELS) as ProviderKind[]).map((k) => (
            <option key={k} value={k}>
              {PROVIDER_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name" hint="As it shows on reports.">
        <input name="name" required defaultValue={values.name ?? ''} placeholder="Network (N-Genius)" className={inputClass} maxLength={60} />
      </Field>
      <Field label="Outlet reference" hint="Network: from the N-Genius portal → Settings → Outlets.">
        <input name="outlet_ref" defaultValue={values.settings?.outletRef ?? ''} className={inputClass} autoComplete="off" />
      </Field>
      <Field label="Environment" hint="Network only. Sandbox takes test cards, never real money.">
        <select name="env" defaultValue={values.settings?.env === 'sandbox' ? 'sandbox' : 'live'} className={inputClass}>
          <option value="live">Live</option>
          <option value="sandbox">Sandbox</option>
        </select>
      </Field>
      <Field label="Credential name" hint="The name of the Vault secret holding the API key — not the key itself.">
        <input
          name="credential_ref"
          defaultValue={values.credential_ref ?? ''}
          placeholder="NGENIUS_API_KEY"
          pattern="[A-Za-z][A-Za-z0-9_]{1,63}"
          autoComplete="off"
          className={`${inputClass} font-mono`}
        />
      </Field>
      <div className="flex flex-col justify-end gap-2 text-sm text-stone-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={values.enabled ?? true} /> Enabled
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="is_default" defaultChecked={values.is_default ?? false} /> Default for this location
        </label>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  )
}
