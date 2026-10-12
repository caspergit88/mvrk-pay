import { Field, SubmitButton, inputClass } from '@/components/forms'
import { ActionForm } from '../_components/action-form'
import type { ActionState } from '../_lib/action-state'
import type { Location } from '@/lib/types'

type Values = Partial<Location & { wifi_set: boolean }>

/** One form for both "edit this location" and "add a location". */
export function LocationForm({
  action,
  values,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>
  values: Values
  submitLabel: string
}) {
  return (
    <ActionForm action={action} className="grid gap-3 sm:grid-cols-2">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Field label="Name">
        <input name="name" required defaultValue={values.name ?? ''} className={inputClass} />
      </Field>
      <Field label="Slug" hint="Short, lower-case; used in links.">
        <input name="slug" required defaultValue={values.slug ?? ''} className={inputClass} pattern="[a-z0-9][a-z0-9-]{0,31}" />
      </Field>
      <Field label="Email domain" hint="Logins on this domain belong here.">
        <input name="email_domain" required defaultValue={values.email_domain ?? ''} className={inputClass} placeholder="kitepeople.com" />
      </Field>
      <Field label="Timezone">
        <input name="timezone" required defaultValue={values.timezone ?? 'Africa/Cairo'} className={inputClass} />
      </Field>
      <Field label="Brand label on the display">
        <input name="brand_label" required defaultValue={values.brand_label ?? 'MVRK'} className={inputClass} maxLength={20} />
      </Field>
      <Field label="Idle text on the display">
        <input name="idle_text" required defaultValue={values.idle_text ?? 'Ready when you are'} className={inputClass} maxLength={60} />
      </Field>
      <Field label="Finance email" hint="Where the end-of-day report goes. Blank = nobody.">
        <input name="finance_email" type="email" defaultValue={values.finance_email ?? ''} className={inputClass} />
      </Field>
      <Field label="Max amount per payment (EUR)">
        <input
          name="max_amount"
          type="number"
          step="0.01"
          min="1"
          required
          defaultValue={values.max_amount_minor !== undefined ? (values.max_amount_minor / 100).toFixed(2) : '50000.00'}
          className={inputClass}
        />
      </Field>
      <Field label="Code expiry (minutes)">
        <input name="order_expiry_min" type="number" min={1} max={240} required defaultValue={values.order_expiry_min ?? 20} className={inputClass} />
      </Field>
      <Field label="Nightly sign-out time">
        <input name="logout_time" type="time" required defaultValue={(values.logout_time ?? '22:00').slice(0, 5)} className={inputClass} />
      </Field>
      <Field label="Wi-Fi network name" hint="Blank = no Wi-Fi screen on the display.">
        <input name="wifi_ssid" defaultValue={values.wifi_ssid ?? ''} className={inputClass} maxLength={32} />
      </Field>
      <Field
        label="Wi-Fi password"
        hint={values.wifi_set ? 'A password is set. Leave blank to keep it, type CLEAR to remove it.' : 'Shown to guests under the join code.'}
      >
        <input name="wifi_password" type="text" autoComplete="off" defaultValue="" className={inputClass} maxLength={63} />
      </Field>
      <Field label="Wi-Fi security">
        <select name="wifi_security" defaultValue={values.wifi_security ?? 'WPA'} className={inputClass}>
          <option value="WPA">WPA / WPA2 / WPA3</option>
          <option value="WEP">WEP</option>
          <option value="nopass">Open (no password)</option>
        </select>
      </Field>
      <div className="flex flex-col justify-end gap-2 text-sm text-stone-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="require_pin" defaultChecked={values.require_pin ?? true} /> Ask for a PIN at “Who are you?”
        </label>
        {values.id && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={values.active ?? true} /> Active (logins on this domain allowed)
          </label>
        )}
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  )
}
