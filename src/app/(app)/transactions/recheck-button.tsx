'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Ask the provider about one code again and refresh the list with the answer. */
export function RecheckButton({ id }: { id: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function recheck() {
    setState('busy')
    try {
      const res = await fetch(`/api/transactions/${id}/check`, { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; checkError?: string | null; transaction?: { display_status?: string } }
      if (!res.ok || !body.ok) {
        setState('error')
        setMessage(body.error ?? `HTTP ${res.status}`)
        return
      }
      setState(body.checkError ? 'error' : 'done')
      setMessage(body.checkError ?? body.transaction?.display_status ?? 'Checked')
      router.refresh()
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={recheck}
        disabled={state === 'busy'}
        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
      >
        {state === 'busy' ? 'Checking…' : 'Re-check'}
      </button>
      {message && <div className={`mt-1 max-w-[12rem] text-xs ${state === 'error' ? 'text-red-700' : 'text-stone-500'}`}>{message}</div>}
    </div>
  )
}
