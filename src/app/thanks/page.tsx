import { Outcome } from './outcome'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Thank you · MVRK Pay' }

export default async function ThanksPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref = '' } = await searchParams
  return <Outcome ref={ref} cancelled={false} />
}
