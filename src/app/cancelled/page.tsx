import { Outcome } from '../thanks/outcome'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Payment cancelled · MVRK Pay' }

export default async function CancelledPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref = '' } = await searchParams
  return <Outcome ref={ref} cancelled />
}
