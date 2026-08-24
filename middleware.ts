import {NextResponse, type NextRequest} from 'next/server'

/**
 * Lets the pages into the back/forward cache.
 *
 * Every page here is dynamic, and Next stamps a dynamic route `no-store`,
 * which disqualifies it from bfcache entirely. On most sites that is a small
 * loss. On this one it is not: the whole interface puts its state in the URL,
 * which makes the back button a primary control — it is how somebody undoes a
 * filter, leaves a customer page, or steps back through a sort. Fetching all
 * of that again from London when the browser already has the page in memory is
 * the wrong trade.
 *
 * `no-cache` rather than `no-store` keeps the guarantee that matters — never
 * serve these without revalidating, because the numbers are live — and drops
 * the one that costs bfcache. There is no auth, no personalisation and no
 * cookie on any of these pages, so there is nothing here that must not be
 * written to a disk cache.
 *
 * This is middleware rather than a `headers()` entry in `next.config.ts`
 * because that is not where the header comes from. `headers()` adds headers to
 * a response; the `no-store` on a dynamic route is applied by the framework
 * when it renders, and it wins. Rewriting it on the way out is the only place
 * the change actually lands — which was worth finding out by checking the
 * deployed response rather than by trusting the config.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // The CSV export is a download, not a page, and keeps `no-store`.
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('cache-control', 'private, no-cache, must-revalidate')
  }

  return response
}

export const config = {
  /**
   * Pages only. Static assets are immutable and fingerprinted, `/api` sets its
   * own headers, and running middleware over either would be work with nothing
   * to show for it.
   */
  matcher: ['/((?!_next/static|_next/image|icon.svg|llms.txt|favicon.ico).*)'],
}
