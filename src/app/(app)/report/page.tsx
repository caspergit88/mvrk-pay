import { requireProfile } from '@/lib/auth'
import { Card, Note, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Day report · MVRK Pay' }

export default async function ReportPage() {
  await requireProfile()
  return (
    <>
      <PageHeader title="Day report" subtitle="Printable end-of-day report, like the card terminal’s." />
      <Card>
        <Note>The report and End of day arrive in Phase 4.</Note>
      </Card>
    </>
  )
}
