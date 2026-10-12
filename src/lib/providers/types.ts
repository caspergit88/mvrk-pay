import type { ProviderKind } from '@/lib/types'

/** A provider row from pay.providers, as the adapters need it. */
export type ProviderRow = {
  id: string
  location_id: string
  kind: ProviderKind
  name: string
  currency: string
  enabled: boolean
  is_default: boolean
  credential_ref: string | null
  settings: Record<string, string | undefined>
}

export type CreateLinkInput = {
  amountMinor: number
  currency: string
  merchantRef: string
  note?: string
  customerName?: string
  email: string
  redirectUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}

export type CreateLinkResult = { providerRef: string; payUrl: string; expiresAt?: Date }

export type ProviderState = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | 'refunded'

export type StatusResult = {
  state: ProviderState
  /** The provider's own word for the last attempt (PURCHASED, FAILED, …), kept for the record. */
  rawState: string
  failedAttempts: number
  card?: { scheme: string; last4: string }
  raw: unknown
}

export interface PaymentProvider {
  kind: ProviderKind
  createPaymentLink(input: CreateLinkInput): Promise<CreateLinkResult>
  getStatus(providerRef: string): Promise<StatusResult>
  /** A token or equivalent, without creating a payment. Throws with a readable message on failure. */
  testConnection(): Promise<string>
  /** Verify a webhook call and say which order to re-check; null means "not ours, ignore". */
  parseWebhook?(request: Request, body: unknown): Promise<{ providerRef: string } | null>
  /** Deep link into the provider's own portal for finance. */
  portalUrl?(providerRef: string): string | null
}

export class ProviderError extends Error {
  status: number
  detail: unknown
  constructor(message: string, status = 502, detail?: unknown) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.detail = detail
  }
}
