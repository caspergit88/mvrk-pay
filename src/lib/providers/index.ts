import 'server-only'
import { NGeniusProvider, ngeniusPortal } from './ngenius'
import { resolveCredential } from './credentials'
import { getpayin, nomod, stripe } from './stubs'
import { ProviderError, type PaymentProvider, type ProviderRow } from './types'

export type { PaymentProvider, ProviderRow, StatusResult, CreateLinkInput } from './types'
export { ProviderError } from './types'

/** The adapter for a provider row, with its credential resolved. */
export async function providerFor(row: ProviderRow): Promise<PaymentProvider> {
  switch (row.kind) {
    case 'ngenius':
      return new NGeniusProvider(row, await resolveCredential(row.credential_ref, row.name))
    case 'mock':
      // The mock gateway speaks the N-Genius protocol; `settings.baseUrl` points at it.
      return new NGeniusProvider(
        { ...row, settings: { env: 'mock', realm: 'ni', outletRef: 'mock-outlet', baseUrl: process.env.MOCK_GATEWAY_URL ?? 'http://127.0.0.1:9876', ...row.settings } },
        process.env.MOCK_GATEWAY_KEY ?? 'TESTKEY',
      )
    case 'getpayin':
      return getpayin(row)
    case 'nomod':
      return nomod(row)
    case 'stripe':
      return stripe(row)
    default:
      throw new ProviderError(`Unknown provider kind "${row.kind}".`, 500)
  }
}

/**
 * Where finance looks a payment up in the provider's own portal, from the row
 * alone — no credential lookup, so the transaction list can show it cheaply.
 * Null when the provider has no portal (the mock) or no adapter yet.
 */
export function portalUrlFor(row: Pick<ProviderRow, 'kind' | 'settings'>): string | null {
  return row.kind === 'ngenius' ? ngeniusPortal(row.settings) : null
}
