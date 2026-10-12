'use client'

const SLIP_STYLE_ID = 'print-receipt-page'

/**
 * Print (A4) prints the page as laid out. Print (80 mm slip) swaps in the
 * monospace block and sets an 80 mm page for the duration of the print, so a
 * receipt printer gets a terminal-style slip.
 */
export function PrintButton({ receipt }: { receipt?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        document.body.classList.toggle('print-receipt', !!receipt)
        document.getElementById(SLIP_STYLE_ID)?.remove()
        if (receipt) {
          const style = document.createElement('style')
          style.id = SLIP_STYLE_ID
          style.textContent = '@page { size: 80mm auto; margin: 4mm; }'
          document.head.appendChild(style)
        }
        const cleanup = () => {
          document.body.classList.remove('print-receipt')
          document.getElementById(SLIP_STYLE_ID)?.remove()
          window.removeEventListener('afterprint', cleanup)
        }
        window.addEventListener('afterprint', cleanup)
        window.print()
      }}
      className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
    >
      {receipt ? 'Print (80 mm slip)' : 'Print (A4)'}
    </button>
  )
}
