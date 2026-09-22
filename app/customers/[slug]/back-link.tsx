'use client'

import {useSearchParams} from 'next/navigation'

import {customerHref, parseCustomerParams} from '@/metrics/params.ts'

/**
 * "← All customers", returning to the view this page was opened from.
 *
 * The table passes its own query string on every row link as `?from=`, and it
 * is read back here rather than trusted: it goes through the same parser the
 * table uses and comes out as a canonical query string, so a hand-edited
 * `from` cannot become an open redirect or a nonsense view. Anything
 * unparseable quietly becomes plain `/customers`.
 *
 * It is a client component so that the page around it can be cached. Reading
 * `searchParams` in the server component made every one of four thousand
 * customer pages dynamic — a function invocation and a render per request,
 * which is what a crawler walking the table turned into a month's worth of
 * Vercel compute in a week. `useSearchParams` moves the only per-request
 * input to the browser; the page's HTML is the same for everybody and the CDN
 * can hold it. The server renders the fallback (`/customers`, which is also
 * what a page opened cold deserves) and the browser corrects it on hydration.
 */
export function BackLink() {
  const from = useSearchParams().get('from')
  return <BackAnchor href={`/customers${safeFrom(from ?? undefined)}`} />
}

export function BackAnchor({href}: {href: string}) {
  return (
    <a href={href} className="inline-block py-1 underline underline-offset-4">
      ← All customers
    </a>
  )
}

function safeFrom(from: string | undefined): string {
  if (!from) return ''
  const params = new URLSearchParams(from.startsWith('?') ? from.slice(1) : from)
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    raw[key] = all.length > 1 ? all : all[0]!
  }
  return customerHref(parseCustomerParams(raw))
}
