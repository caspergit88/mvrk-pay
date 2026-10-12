import { requireDesk } from '@/lib/auth'
import { Card, Note, PageHeader } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Take payment · MVRK Pay' }

/**
 * The payment screen. Phase 3 fills this in (amount, Show QR on customer
 * display, live status, Recent). Phase 2 only proves the way in: sign-in,
 * "Who are you?", the session and the header.
 */
export default async function PayPage() {
  const profile = await requireDesk()
  return (
    <>
      <PageHeader title="Take a payment" subtitle="Type the amount; the customer display shows the code." />
      <Card>
        <Note>
          The payment screen arrives in Phase 3. You are signed in as {profile.full_name}
          {profile.session.staff_id ? ' and your name is on the desk' : ''}; the session ends at 22:00.
        </Note>
      </Card>
    </>
  )
}
