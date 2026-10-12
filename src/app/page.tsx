import { redirect } from 'next/navigation'
import { homePathFor, requireProfile } from '@/lib/auth'

/**
 * The root. Reception's home is the payment screen itself (Phase 3 puts it at
 * /pay and this redirects there); admins land on the launcher, finance on the
 * transaction list.
 */
export default async function RootPage() {
  const profile = await requireProfile()
  if (profile.role === 'reception') redirect('/pay')
  redirect(homePathFor(profile.role))
}
