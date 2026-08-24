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
      {/*
        First and last, either side of Previous and Next.

        Two links was the right answer for a numbered pager over eighty pages
        and the wrong answer for reaching page eighty: it cost seventy-nine
        clicks, and the only person who got there was somebody who worked out
        they could edit the URL. Four links reach both ends and still do not
        put eighty numbers in front of a screen reader.
      */}
      <p className="flex gap-4">
        {options.page > 1 ? (
          <>
            <a
              href={`/customers${customerHref(options, {page: 1})}`}
              className="inline-block py-1 underline underline-offset-4"
            >
              ⇤ First
            </a>
            <a
              href={`/customers${customerHref(options, {page: options.page - 1})}`}
              rel="prev"
              className="inline-block py-1 underline underline-offset-4"
            >
              ← Previous
            </a>
          </>
        ) : (
          <span className="py-1 text-(--color-muted)">← Previous</span>
        )}
      </p>

      {/*
        The spaces live inside text nodes that have something else in them.

        Written with {' '} separators, this line rendered as "51–100 of 4,000"
        and NVDA read it as "51–100 of4,000· page 2 of 80". A text node holding
        nothing but whitespace survives layout and is dropped when Chrome
        computes the accessibility text, so the page looked right and sounded
        wrong. `{' of '}` is not a whitespace-only node -- it has a word in it
        -- and nothing is entitled to throw its spaces away.
      */}
      <p className="text-center text-(--color-ink-2)">
        <span data-numeric>{count(first)}</span>–<span data-numeric>{count(last)}</span>
        {' of '}
        <span data-numeric>{count(total)}</span>
        {/*
          A comma, not the leading space and middle dot this used to carry.
          `sr-only` is `position: absolute`, which makes the span its own box,
          and leading whitespace at the start of a box is collapsed away before
          anything else gets a look at it -- so it read as "4,000· page 2 of
          80". A comma needs no space in front of it and is what somebody
          listening would expect to hear between the two facts anyway. The
          middle dot was a visual separator inside text that is never seen.
        */}
        <span className="sr-only">{`, page ${options.page} of ${lastPage}`}</span>
      </p>

      <p className="flex gap-4">
        {options.page < lastPage ? (
          <>
            <a
              href={`/customers${customerHref(options, {page: options.page + 1})}`}
              rel="next"
              className="inline-block py-1 underline underline-offset-4"
            >
              Next →
            </a>
            <a
              href={`/customers${customerHref(options, {page: lastPage})}`}
              className="inline-block py-1 underline underline-offset-4"
            >
              Last ⇥
            </a>
          </>
        ) : (
          <span className="py-1 text-(--color-muted)">Next →</span>
        )}
      </p>
    </nav>
  )
}
