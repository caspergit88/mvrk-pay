import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Pages that render without a signed-in person:
 * - /sign-in, /no-access, /auth/* — the login flow itself;
 * - /set-password — where a reset lands, before there is a session;
 * - /display — the customer iPad, keyed by the desk's display key, never a login;
 * - /thanks and /cancelled — the customer's phone after the provider's page.
 * Exact match, or the path plus a separator, so /display never swallows
 * /displays-settings or the like.
 */
const PUBLIC_PATHS = ['/sign-in', '/no-access', '/auth', '/set-password', '/display', '/thanks', '/cancelled']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  // Refreshes the session cookie; must run before any redirect decision.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // api/cron and api/webhooks authenticate themselves (CRON_SECRET, provider
  // signatures); left in the matcher they would be bounced to /sign-in and
  // silently never run.
  matcher: ['/((?!api/cron|api/webhooks|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
