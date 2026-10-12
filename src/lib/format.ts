/**
 * Card amounts are stored in minor units with a currency code. Everything the
 * screens show goes through here, so "EUR 120.50" looks the same everywhere.
 */
export function money(minor: number | string | null | undefined, currency = 'EUR'): string {
  const n = typeof minor === 'string' ? Number(minor) : minor
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
  })
    .format(n / 100)
    .replace(/ /g, ' ')
}

/** "120.50" for an input box or a CSV. */
export function amountInput(minor: number): string {
  return (minor / 100).toFixed(2)
}

/** Typed by staff: "120", "120.5", "1,250.00" → minor units, or null if unreadable. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

const TZ = 'Africa/Cairo'

export function dateTime(value: string | null | undefined, timeZone = TZ): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

export function timeOnly(value: string | null | undefined, timeZone = TZ): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone })
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Today's calendar date at the location, as YYYY-MM-DD. */
export function todayAt(timeZone = TZ, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}
