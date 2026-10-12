import { ProviderError, type PaymentProvider, type ProviderRow } from './types'
import type { ProviderKind } from '@/lib/types'

/**
 * Getpayin, Nomod and Stripe are on the roadmap. Each is a typed stub that
 * says so; see README.providers.md for what implementing one involves.
 */
class NotYet implements PaymentProvider {
  constructor(
    public kind: ProviderKind,
    private row: ProviderRow,
  ) {}
  private refuse(): never {
    throw new ProviderError(`${this.row.name} is not configured yet: the ${this.kind} adapter has not been built. See src/lib/providers/README.providers.md.`, 501)
  }
  async createPaymentLink(): Promise<never> {
    this.refuse()
  }
  async getStatus(): Promise<never> {
    this.refuse()
  }
  async testConnection(): Promise<never> {
    this.refuse()
  }
}

export const getpayin = (row: ProviderRow) => new NotYet('getpayin', row)
export const nomod = (row: ProviderRow) => new NotYet('nomod', row)
export const stripe = (row: ProviderRow) => new NotYet('stripe', row)
