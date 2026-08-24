import type {Metadata} from 'next'

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

import {COLUMNS, columnLabel} from './columns.ts'
import {Filters} from './filters.tsx'
import {Pagination} from './pagination.tsx'
import {SortHeader} from './sort-header.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Customers',
  description:
    'Every customer, filterable by plan, status, country, channel, signup date and ' +
    'monthly revenue. Filtering, sorting and pagination all happen in the database.',
}

function run<T>(query: Query): Promise<T[]> {
  return getSql().unsafe(query.text, query.params as never[]) as unknown as Promise<T[]>
}

export default async function Customers({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  const options = parseCustomerParams(await searchParams)

  const [rows, plans, countries, bounds] = await Promise.all([
    run<CustomerRow>(customerTable(options)),
    run<PlanFacet>(planFacets()),
    run<CountryFacet>(countryFacets()),
    run<{first_day: string; last_day: string}>(reportBounds()),
  ])

  // `count(*) over ()` rides along on every row, so the total costs nothing
  // extra — but there are no rows to carry it when nothing matched.
  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0
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
          <div className="mt-4 overflow-x-auto">
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
                      <a
                        href={`/customers/${row.slug}`}
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
          </div>

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

  return (
    <div className="mt-4 border-y border-(--color-rule-2) py-8">
      <h2 className="text-base">No customers match these filters</h2>
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
        {' to see all 4,000 customers.'}
      </p>
    </div>
  )
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}
