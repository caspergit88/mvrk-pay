'use client'

import { useActionState } from 'react'
import { sendReceipt, type ReceiptState } from './actions'

/** The small "Email me a receipt" box under a paid outcome. */
export function ReceiptForm({ orderRef }: { orderRef: string }) {
  const [state, action, pending] = useActionState<ReceiptState, FormData>(sendReceipt, null)
  if (state?.ok) return <p className="mt-6 text-sm text-emerald-300">{state.ok}</p>
  return (
    <form action={action} className="mx-auto mt-6 w-full max-w-xs text-left">
      <input type="hidden" name="ref" value={orderRef} />
      <label className="block text-xs uppercase tracking-wide text-[#94a3b8]" htmlFor="receipt-email">
        Email me a receipt
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="receipt-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border border-[#334155] bg-[#111a2e] px-3 py-2 text-sm text-[#f1f5f9] outline-none placeholder:text-[#64748b] focus:border-[#60a5fa]"
        />
        <button type="submit" disabled={pending} className="rounded-lg bg-[#f1f5f9] px-3 py-2 text-sm font-semibold text-[#0b1220] disabled:opacity-50">
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-xs text-red-300">{state.error}</p>}
    </form>
  )
}
