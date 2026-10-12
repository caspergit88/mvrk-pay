import { db } from '@/lib/supabase/db'
import { checkTransaction, serviceOrNull } from '@/lib/payments'
import { money } from '@/lib/format'

type Outcome = 'paid' | 'pending' | 'failed' | 'cancelled' | 'unknown'

const COPY: Record<Outcome, { title: string; message: string; tone: string; icon: string }> = {
  paid: { title: 'Payment received', message: 'Thank you — you can close this page.', tone: 'bg-emerald-500', icon: '✓' },
  pending: { title: 'Almost there', message: 'We are confirming your payment. Please check with the desk.', tone: 'bg-amber-500', icon: '…' },
  failed: { title: 'Payment not completed', message: 'The card was not accepted. Please try again at the desk.', tone: 'bg-red-400', icon: '!' },
  cancelled: { title: 'Payment cancelled', message: 'No charge was made. Please return to the desk.', tone: 'bg-red-400', icon: '×' },
  unknown: { title: 'Thank you', message: 'Please check with the desk if you need a receipt.', tone: 'bg-emerald-500', icon: '✓' },
}

/**
 * Where the customer's phone lands after the provider's hosted page. Network
 * appends ?ref=<order reference>; we look the order up (service role — there
 * is no login on a customer's phone), ask the provider, and say what happened.
 */
export async function Outcome({ ref, cancelled }: { ref: string; cancelled: boolean }) {
  let outcome: Outcome = cancelled ? 'cancelled' : 'unknown'
  let amount = ''
  let brand = 'MVRK'
  const service = serviceOrNull()
  if (service && ref && !cancelled) {
    const { data: tx } = await db(service)
      .from('transactions')
      .select('id, location_id, desk_id, provider_id, provider_ref, status, last_checked_at, amount_minor, currency, location:locations(brand_label)')
      .eq('provider_ref', ref)
      .maybeSingle()
    if (tx) {
      const t = tx as unknown as { id: string; status: string; amount_minor: number; currency: string; location: { brand_label: string } | null }
      brand = t.location?.brand_label ?? brand
      amount = money(t.amount_minor, t.currency)
      try {
        const r = await checkTransaction(service, tx as never, { force: true })
        const status = r.skipped ? t.status : r.transaction.status
        const failed = !r.skipped && r.transaction && (r.transaction as unknown as { failed_attempts: number }).failed_attempts > 0
        outcome = status === 'paid' || status === 'refunded' ? 'paid' : failed ? 'failed' : 'pending'
      } catch {
        outcome = 'pending'
      }
    }
  }
  const c = COPY[outcome]
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1220] px-6 text-center text-[#f1f5f9]">
      <div>
        <div className="mb-7 text-xs uppercase tracking-[0.3em] text-[#94a3b8]">{brand}</div>
        <div className={`mx-auto mb-5 grid h-22 w-22 place-items-center rounded-full ${c.tone}`} style={{ width: 88, height: 88 }}>
          <span className="text-5xl font-extrabold leading-none text-[#0b1220]">{c.icon}</span>
        </div>
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="mt-2 text-[17px] leading-relaxed text-[#cbd5e1]">{c.message}</p>
        {amount && <div className="mt-4 text-xl font-bold">{amount}</div>}
      </div>
    </div>
  )
}
