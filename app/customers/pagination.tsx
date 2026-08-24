import Link from 'next/link'

import {count} from '@/format.ts'
import type {CustomerQueryOptions} from '@/metrics/customers.ts'
import {customerHref} from '@/metrics/params.ts'

/**
 * Previous and next, plus where you are.
 *
 * A numbered pager over eighty pages is eighty links nobody uses and a screen
 * reader has to walk past to reach the table. Two links and a sentence say
 * more and cost less. The sentence is the part that matters: "51–100 of 4,000"
 * answers where you are, how far in, and how much is left, in one line that
 * reads correctly aloud.
 *
 * At the ends the unavailable direction is a `<span>` rather than a disabled
 * link. A disabled link is not a thing HTML has; the usual imitation is an
 * anchor with no href, which stays in the tab order and announces as a link
 * that does nothing.
 */
export function Pagination({
  options,
  total,
}: {
  options: CustomerQueryOptions
  total: number
}) {
  const lastPage = Math.max(1, Math.ceil(total / options.perPage))
  if (total === 0) return null

  const first = (options.page - 1) * options.perPage + 1
  const last = Math.min(total, options.page * options.perPage)

  return (
    <nav
      aria-label="Customer table pages"
      className="mt-6 flex items-baseline justify-between gap-4 border-t border-(--color-rule) pt-4 text-sm"
    >
      {options.page > 1 ? (
        <Link
          href={`/customers${customerHref(options, {page: options.page - 1})}`}
          rel="prev"
          className="underline underline-offset-4"
        >
          ← Previous
        </Link>
      ) : (
        <span className="text-(--color-muted)">← Previous</span>
      )}

      <p className="text-center text-(--color-ink-2)">
        <span data-numeric>{count(first)}</span>–<span data-numeric>{count(last)}</span> of{' '}
        <span data-numeric>{count(total)}</span>
        <span className="sr-only">
          {' '}
          · page {options.page} of {lastPage}
        </span>
      </p>

      {options.page < lastPage ? (
        <Link
          href={`/customers${customerHref(options, {page: options.page + 1})}`}
          rel="next"
          className="underline underline-offset-4"
        >
          Next →
        </Link>
      ) : (
        <span className="text-(--color-muted)">Next →</span>
      )}
    </nav>
  )
}
