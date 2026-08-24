import type {Metadata} from 'next'
import {cache} from 'react'

import {getSql} from '@/db/index.ts'
import {count, country as countryName, day, humanise, money} from '@/format.ts'
import {customerTable, type CustomerRow} from '@/metrics/customers.ts'
import {
  countryFacets,
  planFacets,
  reportBounds,
  type CountryFacet,
  type PlanFacet,
} from '@/metrics/facets.ts'
import {
  activeFilterCount,
  customerHref,
  parseCustomerParams,
  type RawParams,
} from '@/metrics/params.ts'
import type {Query} from '@/metrics/sql.ts'

import {Scroller} from '../scroller.tsx'
import {Unavailable} from '../unavailable.tsx'

import {COLUMNS, columnLabel} from './columns.ts'
import {Filters} from './filters.tsx'
import {Pagination} from './pagination.tsx'
import {SortHeader} from './sort-header.tsx'

export const dynamic = 'force-dynamic'

function run<T>(query: Query): Promise<T[]> {
  return getSql().unsafe(query.text, query.params as never[]) as unknown as Promise<T[]>
}

/**
 * Everything this page needs, fetched once per request.
 *
 * `generateMetadata` and the page body both need the result count — the title
 * says how many customers matched, and that title is the first thing a screen
 * reader announces after a filter is submitted. Two callers would normally
 * mean two sets of queries; React's `cache` makes the second call return the
 * first one's promise instead.
 *
 * The key is the canonical query string rather than the parsed options,
 * because `cache` matches arguments by identity and a freshly parsed object is
 * never identical to another one. Round-tripping through `customerHref` also
 * means the cache key is the URL, which is the same thing this whole page
 * claims its state is.
 *
 * It resolves rather than throws, because a `generateMetadata` that throws
 * takes the request with it — before the page has a chance to render its own
 * fallback.
 */
const load = cache(async (search: string) => {
  const options = parseCustomerParams(rawFromSearch(search))
  try {
    const [rows, plans, countries, bounds] = await Promise.all([
      run<CustomerRow>(customerTable(options)),
      run<PlanFacet>(planFacets()),
      run<CountryFacet>(countryFacets()),
      run<{first_day: string; last_day: string}>(reportBounds()),
    ])
    if (!bounds[0]) return {ok: false as const, options}
    // `count(*) over ()` rides along on every row, so the total costs nothing
    // extra — but there are no rows to carry it when nothing matched.
    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0
    return {ok: true as const, options, rows, plans, countries, bounds: bounds[0], total}
  } catch {
    return {ok: false as const, options}
  }
})

/** A query string back into the shape `parseCustomerParams` reads. */
function rawFromSearch(search: string): RawParams {
  const params = new URLSearchParams(search)
  const raw: Record<string, string | string[]> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    raw[key] = all.length > 1 ? all : all[0]!
  }
  return raw
}

const DESCRIPTION =
  'Every customer, filterable by plan, status, country, channel, signup date and ' +
  'monthly revenue. Filtering, sorting and pagination all happen in the database.'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}): Promise<Metadata> {
  const data = await load(customerHref(parseCustomerParams(await searchParams)))

  /*
    The count goes in the title when a filter is applied.

    NVDA announces the document title first on every page load, and applying a
    filter is a page load. Before this, the first thing a reader heard after
    submitting was "Customers — Ledger" — the same words as before they
    pressed it — and the answer waited further down the page. Now it is
    "1,085 customers — Ledger" and the result arrives in the first two seconds.

    Unfiltered it stays "Customers", so the plain page keeps a title worth
    bookmarking. Verified that this does not cost the streamed shell anything:
    Next streams metadata, and a deliberately delayed `generateMetadata` still
    returned first bytes in 9.9ms.
  */
  const title =
    data.ok && activeFilterCount(data.options) > 0
      ? data.total === 0
        ? 'No customers match'
        : `${count(data.total)} ${data.total === 1 ? 'customer' : 'customers'}`
      : 'Customers'

  return {title, description: DESCRIPTION}
}

export default async function Customers({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  const options = parseCustomerParams(await searchParams)
  const data = await load(customerHref(options))

  /*
    This page and the customer detail page were the only two routes without a
    fallback, and they are the two most likely to arrive as a link in somebody
    else's inbox. Without this, a request that lands while Neon's compute is
    suspended renders the framework's own "Application error: a server-side
    exception has occurred" -- the worst first impression this build can make,
    on its best page, in exactly the situation it was written for.
  */
  if (!data.ok) {
    return <Unavailable title="Customers" retry={`/customers${customerHref(options)}`} />
  }
  const {rows, plans, countries, total} = data
  const here = customerHref(options)
  const bounds = [data.bounds]
  const applied = activeFilterCount(options)

  return (
    <>
      <header className="border-b border-(--color-rule-2) pb-4">
        <h1 className="text-2xl">Customers</h1>
        <p className="mt-2 max-w-prose text-sm text-(--color-ink-2)">
          Every filter, sort and page is in the address bar, and every one of them is applied
          by Postgres rather than in the browser. Copy the URL and you have copied the view.
        </p>
      </header>

      {/*
        The count sits above the filter panel, not below it, and that is the
        whole of what makes it reachable.

        It was written as an `aria-live="polite"` region on the theory that a
        filter would announce its own result. It never did and it never could:
        applying a filter submits a GET form, which loads a new document, and a
        live region only announces a change made to a region that is already on
        the page. NVDA reads the new page from the top instead. The attribute
        has gone rather than been left in place looking helpful -- an ARIA
        attribute that cannot fire is a claim, not a feature, and this build
        argues that about other people's markup.

        What replaces it is position. The question was never what the region is
        marked as, it is how far down the page the answer sits, and below the
        panel it was thirty checkboxes deep. Here it is the first thing after
        the heading, which is where the answer to "did that do anything?"
        belongs for everybody and not only for a reader.

        The export link travels with it. It downloads every matching row rather
        than the fifty on screen, and it is the page's own query string with a
        different path, so the file and the screen cannot disagree about what
        the current view is.
      */}
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-sm">
          {total === 0 ? (
            'No customers match'
          ) : (
            <>
              {/*
                The leading space belongs to this text node rather than
                standing on its own. A whitespace-only node between two
                elements is dropped from the accessibility text -- that is
                what made the table caption read "Showing50 of 4,000".
              */}
              <span data-numeric>{count(total)}</span>
              {total === 1 ? ' customer matches' : ' customers match'}
            </>
          )}
          {applied === 0
            ? ' — no filters applied.'
            : applied === 1
              ? ' the filter applied.'
              : ` all ${applied} filters applied.`}
        </p>

        {total > 0 && (
          <p className="text-sm">
            <a
              href={`/api/export${customerHref(options)}`}
              download
              className="inline-block py-1 underline underline-offset-4"
            >
              Download all {count(total)} as CSV
            </a>
          </p>
        )}
      </div>

      <Filters options={options} plans={plans} countries={countries} bounds={bounds[0]!} />

      {total === 0 ? (
        <EmptyState options={options} plans={plans} />
      ) : (
        <>
          <Scroller label="Customers table" className="mt-4">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              {/*
                One interpolated string, not a dozen JSX children.

                This caption used to be written as text interleaved with {' '}
                separators. It rendered correctly and NVDA read it as
                "sorted by Mrrdescending. Showing50 of 4,000." A whitespace-only
                text node standing between two elements is collapsed away when
                Chrome computes the accessibility text, even though layout keeps
                it -- so the page looked right and sounded wrong, which is the
                one kind of defect no automated check catches. Building the
                sentence in JavaScript puts the spaces inside a text node where
                nothing can drop them.
              */}
              <caption className="sr-only">
                {`Customers, sorted by ${columnLabel(options.sort)} ` +
                  `${options.direction === 'asc' ? 'ascending' : 'descending'}. ` +
                  `Showing ${count(rows.length)} of ${count(total)}.`}
              </caption>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <SortHeader
                      key={c.column}
                      column={c.column}
                      label={c.label}
                      options={options}
                      numeric={c.numeric}
                      initial={c.initial}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-(--color-rule)">
                    {/*
                      The name is the link, not the row. A whole-row link
                      cannot contain the other links a row might need, is
                      announced as one enormous link, and makes selecting the
                      text in a cell impossible.
                    */}
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {/*
                        The row link carries the current view, so the detail
                        page's own back link can return to it rather than to
                        an unfiltered table. It is the query string this page
                        was built from, which is the only description of the
                        view that exists.
                      */}
                      <a
                        href={`/customers/${row.slug}${
                          here ? `?from=${encodeURIComponent(here)}` : ''
                        }`}
                        className="underline underline-offset-4"
                      >
                        {row.name}
                      </a>
                    </th>
                    <td className="py-2 pr-4">{row.plan_name}</td>
                    <td className="py-2 pr-4">{humanise(row.status)}</td>
                    <td className="py-2 pr-4">{countryName(row.country)}</td>
                    <td className="py-2 pr-4">{humanise(row.acquisition_channel)}</td>
                    <td data-numeric className="py-2 pr-4 text-right">
                      {count(row.seats)}
                    </td>
                    <td data-numeric className="py-2 pr-4 text-right">
                      {money(row.mrr_pence)}
                    </td>
                    <td data-numeric className="py-2 pr-4 whitespace-nowrap">
                      {day(row.signed_up_at)}
                    </td>
                    <td data-numeric className="py-2 whitespace-nowrap">
                      {row.last_seen_at ? (
                        day(row.last_seen_at)
                      ) : (
                        <span className="text-(--color-muted)">Never</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>

          <Pagination options={options} total={total} />
        </>
      )}
    </>
  )
}

/**
 * The empty state names what is excluding everything and offers to undo it.
 *
 * "No results" on its own is a dead end: the reader has to reconstruct which
 * of six filters is the one doing the damage. Listing them turns it into a
 * question with an answer.
 */
function EmptyState({
  options,
  plans,
}: {
  options: ReturnType<typeof parseCustomerParams>
  plans: readonly PlanFacet[]
}) {
  const planName = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? slug

  const active: string[] = [
    // Search first: it is the narrowest clause and the likeliest culprit.
    ...(options.query ? [`the name contains “${options.query}”`] : []),
    ...(options.plans?.length ? [`plan is ${list(options.plans.map(planName))}`] : []),
    ...(options.statuses?.length ? [`status is ${list(options.statuses.map(humanise))}`] : []),
    ...(options.countries?.length
      ? [`country is ${list(options.countries.map(countryName))}`]
      : []),
    ...(options.channels?.length ? [`channel is ${list(options.channels.map(humanise))}`] : []),
    ...(options.signedUpFrom ? [`signed up on or after ${day(options.signedUpFrom)}`] : []),
    ...(options.signedUpTo ? [`signed up on or before ${day(options.signedUpTo)}`] : []),
    ...(options.mrrMinPence != null ? [`MRR is at least ${money(options.mrrMinPence)}`] : []),
    ...(options.mrrMaxPence != null ? [`MRR is at most ${money(options.mrrMaxPence)}`] : []),
  ]

  /*
    A revenue range with its ends the wrong way round can never match anything,
    and listing the two bounds as separate clauses leaves the reader checking
    six filters to find the one at fault. It is named instead.

    The bounds are not silently swapped. Somebody typed those two numbers, and
    quietly reinterpreting them would mean the table disagrees with the form
    that produced it -- which is the one thing the URL contract exists to stop.
  */
  const impossibleRange =
    options.mrrMinPence != null &&
    options.mrrMaxPence != null &&
    options.mrrMinPence > options.mrrMaxPence

  // Not the constant 4,000. Every plan facet counts the customers currently on
  // it, so their sum is the real total, and a re-seeded dataset cannot make
  // this sentence wrong the way a hard-coded figure could.
  const everyone = plans.reduce((n, plan) => n + plan.customers, 0)

  return (
    <div className="mt-4 border-y border-(--color-rule-2) py-8">
      <h2 className="text-base">No customers match these filters</h2>
      {impossibleRange && (
        <p className="mt-3 max-w-prose text-sm">
          {`The revenue range is inverted: the minimum of ${money(options.mrrMinPence!)} is ` +
            `above the maximum of ${money(options.mrrMaxPence!)}, so nothing can fall inside ` +
            'it. Swapping the two would fix it.'}
        </p>
      )}
      {active.length > 0 && (
        <>
          <p className="mt-3 text-sm text-(--color-ink-2)">Currently filtering where:</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {active.map((clause) => (
              <li key={clause}>{clause}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-sm">
        <a href="/customers" className="inline-block py-1 underline underline-offset-4">
          Clear all filters
        </a>
        {` to see all ${count(everyone)} customers.`}
      </p>
    </div>
  )
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
