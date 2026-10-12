import 'server-only'
import { timingSafeEqual } from 'node:crypto'

/**
 * Scheduled routes share one gate: `Authorization: Bearer $CRON_SECRET` (what
 * Vercel's scheduler sends) or `?secret=` for a manual run. Without the secret
 * a production deployment refuses to run at all — a nightly job that silently
 * ran open to the internet would be worse than one that visibly did not run.
 */

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function authoriseCron(request: Request, jobName: string): { status: number; message: string } | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return {
        status: 503,
        message: `CRON_SECRET is not set on this deployment, so ${jobName} will not run. Add it in Vercel → Environment Variables and redeploy.`,
      }
    }
    console.warn(`[cron/${jobName}] CRON_SECRET is not set — running unauthenticated because this is development.`)
    return null
  }
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const query = new URL(request.url).searchParams.get('secret') ?? ''
  if ((bearer && matches(bearer, secret)) || (query && matches(query, secret))) return null
  return { status: 401, message: 'Not authorised.' }
}
