import { requireRole } from '@/lib/auth'
import { Card, Note, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transactions · MVRK Pay' }

export default async function TransactionsPage() {
  await requireRole('admin', 'finance')
  return (
    <>
      <PageHeader title="Transactions" subtitle="Every location, with filters and export." />
      <Card>
        <Note>The transaction list arrives in Phase 4, once payments are flowing.</Note>
      </Card>
    </>
  )
}
