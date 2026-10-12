/**
 * One line, in plain English, for an audit_log row: what changed, from what to
 * what. Pure, so the Settings → Audit log page and its tests share it.
 */

export type AuditEntry = {
  id: number
  at: string
  actor: string | null
  entity: string
  entity_id: string | null
  action: string
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/** Keys and links that grant access; the log says they changed, never to what. */
const HIDDEN = new Set(['webhook_token', 'display_key', 'pin_hash', 'wifi_password'])
/** Bookkeeping columns that change on every write and say nothing. */
const NOISE = new Set(['id', 'created_at', 'updated_at'])

export const ENTITY_LABELS: Record<string, string> = {
  locations: 'Locations',
  desks: 'Desks',
  profiles: 'Users',
  staff: 'Staff names',
  providers: 'Payment providers',
  transactions: 'Transactions',
  day_closes: 'Day closes',
  apps: 'Apps',
  session: 'Sessions',
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

/** The row's own name, if it has one, so "Added" says what was added. */
export function auditLabel(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  for (const key of ['name', 'full_name', 'merchant_ref', 'close_number', 'slug', 'email']) {
    const v = row[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}

function pairs(row: Record<string, unknown>, limit = 6): string {
  const parts = Object.entries(row)
    .filter(([k]) => !NOISE.has(k))
    .map(([k, v]) => (HIDDEN.has(k) ? `${k} set` : `${k}: ${show(v)}`))
  const extra = parts.length > limit ? ` (+${parts.length - limit} more)` : ''
  return parts.slice(0, limit).join(', ') + extra
}

export function auditSummary(entry: Pick<AuditEntry, 'action' | 'before' | 'after'>): string {
  const { action, before, after } = entry

  if (action === 'update' && before && after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE.has(k))
    const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    if (changed.length === 0) return 'Saved with no visible change.'
    return changed.map((k) => (HIDDEN.has(k) ? `${k} changed` : `${k}: ${show(before[k])} → ${show(after[k])}`)).join('; ')
  }
  if (action === 'insert' && after) {
    const label = auditLabel(after)
    return label ? `Added “${label}”.` : `Added: ${pairs(after)}`
  }
  if (action === 'delete' && before) {
    const label = auditLabel(before)
    return label ? `Removed “${label}”.` : `Removed: ${pairs(before)}`
  }
  // A button press logged by pay.log_action / pay.note_audit.
  const detail = after ?? before
  return detail && Object.keys(detail).length > 0 ? pairs(detail) : '—'
}
