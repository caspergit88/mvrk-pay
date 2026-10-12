import { apiProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/supabase/db'
import { fail, handle } from '@/lib/api'
import { toCsv, type ReportLine } from '@/lib/report'
import { listQuery, readFilters } from '../_lib/filters'

export const dynamic = 'force-dynamic'

const PAGE = 1000

/**
 * GET /transactions/export?location=&from=&to=&status=&cashier=&q=&late=1
 *
 * The transaction list as CSV, same filters as the page, no row limit. RLS
 * decides what the person may export, exactly as it decides what they see.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const me = await apiProfile()
    if (!me) return fail('Sign in again.', 401)
    const supabase = await createClient()
    const url = new URL(request.url)
    const params = Object.fromEntries(url.searchParams.entries())
    const filters = readFilters(params)
    if (me.role === 'reception') filters.location = me.location_id

    const rows: ReportLine[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await listQuery(supabase, filters, PAGE).range(offset, offset + PAGE - 1)
      if (error) return fail(error.message, 400)
      const batch = (data ?? []) as unknown as ReportLine[]
      rows.push(...batch)
      if (batch.length < PAGE) break
    }

    // Audit: an export is worth a line in the log.
    await db(supabase).rpc('note_audit', { p_entity: 'transactions', p_action: 'export_csv', p_detail: { filters, rows: rows.length } })

    const name = `mvrk-pay-${filters.from}-to-${filters.to}${filters.location ? '' : '-all'}.csv`
    return new Response('\uFEFF' + toCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  })
}
