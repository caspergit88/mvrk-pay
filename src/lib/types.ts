/**
 * The shapes the app passes around. They mirror the `pay` schema in
 * supabase/migrations; when a column changes there, it changes here.
 */

export type AppRole = 'admin' | 'finance' | 'reception'

export const ROLES: AppRole[] = ['admin', 'finance', 'reception']

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  finance: 'Finance',
  reception: 'Reception',
}

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: 'Everything, at every location, including Settings. David.',
  finance:
    'Sees every location’s transactions, reports and exports. Cannot take a payment or change a setting; can re-open a closed day with a reason.',
  reception:
    'Takes payments and prints the day’s report for their own location, which is decided by their email domain.',
}

export const isRole = (value: unknown): value is AppRole =>
  typeof value === 'string' && (ROLES as string[]).includes(value)

export type Profile = {
  id: string
  email: string
  full_name: string
  role: AppRole
  location_id: string | null
  active: boolean
  must_change_password: boolean
}

export type Location = {
  id: string
  slug: string
  name: string
  email_domain: string
  timezone: string
  brand_label: string
  idle_text: string
  finance_email: string | null
  max_amount_minor: number
  order_expiry_min: number
  logout_time: string
  require_pin: boolean
  wifi_ssid: string | null
  wifi_security: 'WPA' | 'WEP' | 'nopass'
  active: boolean
}

export type Desk = {
  id: string
  location_id: string
  slug: string
  name: string
  display_key: string
  active: boolean
}

export type StaffName = {
  id: string
  location_id: string
  name: string
  active: boolean
  sort_order: number
  has_pin: boolean
}

export type Session = {
  session_id: string
  profile_id: string
  staff_id: string | null
  expires_at: string
}

export type AppTile = {
  id: string
  name: string
  url: string
  icon: string
  roles: AppRole[]
  sort_order: number
  active: boolean
}

export type ProviderKind = 'ngenius' | 'getpayin' | 'nomod' | 'stripe' | 'mock'

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  ngenius: 'Network International (N-Genius)',
  getpayin: 'Getpayin',
  nomod: 'Nomod',
  stripe: 'Stripe',
  mock: 'Mock (testing only)',
}

export type TxStatus = 'waiting' | 'paid' | 'closed' | 'refunded'
export type ClosedReason = 'done' | 'cleared' | 'replaced' | 'expired'

/** What a transaction reads as on screens and reports — computed by pay.v_transactions. */
export type DisplayStatus =
  | 'Waiting'
  | 'Declined'
  | 'Paid'
  | 'Refunded'
  | 'Not confirmed'
  | 'Expired'
  | 'Replaced'
  | 'Unpaid'
