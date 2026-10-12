import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fail, handle } from '@/lib/api'
import { loadReport, reportPdf } from '@/lib/report'
import { todayAt } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * GET /report/pdf?location=<id>&date=YYYY-MM-DD
 *
 * The day report as a PDF, generated from the same data as the page, under
 * the person's own permissions. The close stores a copy in Storage; this
 * route exists so anyone who can see the page can download it, closed or not.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    const url = new URL(request.url)
    const location = me.role === 'reception' ? me.location_id : url.searchParams.get('location')
    const dateParam = url.searchParams.get('date') ?? ''
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayAt()
    if (!location) return fail('Which location?', 400)
    const supabase = await createClient()
    const report = await loadReport(supabase, location, date)
    const pdf = await reportPdf(report)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${report.location.slug}-${date}${report.close ? `-${report.close.close_number}` : ''}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  })
}
