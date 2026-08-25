import type {Metadata} from 'next'
import {notFound} from 'next/navigation'

import {getSql} from '@/db/index.ts'
import {
  count,
  country as countryName,
  day,
  dayTime,
  humanise,
  money,
  moneyExact,
  movement,
} from '@/format.ts'
import {
  customerBySlug,
  customerEventFeed,
  customerMovements,
  customerSubscriptions,
  type CustomerDetail,
  type EventRow,
  type MovementRow,
  type SubscriptionRow,
} from '@/metrics/customer-detail.ts'
import {customerHref, parseCustomerParams} from '@/metrics/params.ts'
import type {Query} from '@/metrics/sql.ts'

import {Figure} from '../../figure-block.tsx'
import {Scroller} from '../../scroller.tsx'
import {Unavailable} from '../../unavailable.tsx'

export const dynamic = 'force-dynamic'

const FEED_LIMIT = 50

function run<T>(query: Query): Promise<T[]> {
  return getSql().unsafe(query.text, query.params as never[]) as unknown as Promise<T[]>
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>
}): Promise<Metadata> {
  const {slug} = await params
  // `?from=` makes this page reachable at many URLs that are all the same
  // page, so it declares which one is the real one.
  const alternates = {canonical: `/customers/${slug}`}
  try {
    const [customer] = await run<CustomerDetail>(customerBySlug(slug))
    return customer
      ? {title: customer.name, alternates}
      : {title: 'Customer not found', alternates}
  } catch {
    // generateMetadata runs before the page does, so an unguarded query here
    // throws the request away before the page's own fallback can render.
    return {title: 'Customer', alternates}
  }
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{slug: string}>
  searchParams: Promise<{from?: string | string[]}>
}) {
  const {slug} = await params

  /*
    The view this page was opened from, so going back returns to it.

    "← All customers" was a bare `/customers`, so filtering four thousand rows
    down to a hundred and seventeen, opening one of them and pressing the
    page's own back link threw the filters away and started again. The state
    was in the URL the whole time and the interface discarded it.

    The table passes its own query string on every row link, and it is read
    back here rather than trusted: it goes through the same parser the table
    uses and comes out as a canonical query string, so a hand-edited `from`
    cannot become an open redirect or a nonsense view. Anything unparseable
    quietly becomes plain `/customers`.
  */
  const rawFrom = (await searchParams).from
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom
  const backHref = `/customers${safeFrom(from)}`

  let customer: CustomerDetail | undefined
  try {
    ;[customer] = await run<CustomerDetail>(customerBySlug(slug))
  } catch {
    return <Unavailable title="Customer" retry={`/customers/${slug}`} />
  }
  // A slug that matches nothing is a 404 and not an outage. Only a thrown
  // query is the database being unreachable; an empty result is an answer.
  if (!customer) notFound()

  let subscriptions: SubscriptionRow[]
  let movements: MovementRow[]
  let events: EventRow[]
  try {
    ;[subscriptions, movements, events] = await Promise.all([
      run<SubscriptionRow>(customerSubscriptions(customer.id)),
      run<MovementRow>(customerMovements(customer.id)),
      run<EventRow>(customerEventFeed(customer.id, FEED_LIMIT)),
    ])
  } catch {
    return <Unavailable title={customer.name} retry={`/customers/${slug}`} />
  }

  const churned = customer.churned_at !== null

  /*
    The statement's foot, added up here rather than in SQL.

    Ten rows is the most any customer has. A second query, or a second pass in
    Postgres, to sum ten numbers that are already in memory would be ceremony —
    and this way the total is visibly derived from the rows on screen, which is
    the property the whole section is claiming.
  */
  const debits = movements.reduce((n, m) => (m.amount_pence < 0 ? n - m.amount_pence : n), 0)
  const credits = movements.reduce((n, m) => (m.amount_pence > 0 ? n + m.amount_pence : n), 0)
  const closing = credits - debits

  return (
    <>
      <p className="text-sm">
        <a
          href={backHref}
          className="inline-block py-1 underline underline-offset-4"
        >
          ← All customers
        </a>
      </p>

      <header className="mt-4 border-b border-(--color-ink) pb-4">
        <h1 className="text-2xl">{customer.name}</h1>
        <p className="mt-2 text-sm text-(--color-ink-2)">
          {`${countryName(customer.country)} · ${humanise(customer.acquisition_channel)}` +
            ' · signed up '}
          <span data-numeric>{day(customer.signed_up_at)}</span>
          {churned && (
            <>
              {' · churned '}
              <span data-numeric>{day(customer.churned_at!)}</span>
            </>
          )}
        </p>
      </header>

      {/*
        The same breakpoints as the overview. These were `sm:grid-cols-4`
        against the overview's `lg:grid-cols-4`, so between 640 and 1024px the
        same component was laid out two different ways on two pages.
      */}
      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-b border-(--color-rule-2) pb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Current MRR"
          value={money(customer.mrr_pence)}
          note={churned ? 'nil — account closed' : undefined}
        />
        <Figure size="md" label="Revenue booked" value={money(customer.lifetime_pence)} note="all positive movements" />
        <Figure size="md" label="Events recorded" value={count(customer.event_count)} />
        <Figure
          label="Last seen"
          value={customer.last_seen_at ? day(customer.last_seen_at) : 'Never'}
        />
      </dl>

      <section className="mt-10">
        <h2 className="text-lg">Subscriptions</h2>
        <p className="mt-1 max-w-prose text-sm text-(--color-ink-2)">
          A plan change ends one subscription and starts another on the same day, which is
          why an account can have several and why only the most recent decides which plan it
          is on.
        </p>
        <Scroller label="Subscriptions table" className="mt-3">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Every subscription this customer has held, most recent first.
            </caption>
            <thead>
              <tr>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th numeric>Seats</Th>
                <Th numeric>MRR</Th>
                <Th>Started</Th>
                <Th>Ended</Th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((row) => (
                <tr key={row.id} className="border-b border-(--color-rule)">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {row.plan_name}
                  </th>
                  <td className="py-2 pr-4">{humanise(row.status)}</td>
                  <td data-numeric className="py-2 pr-4 text-right">
                    {count(row.seats)}
                  </td>
                  <td data-numeric className="py-2 pr-4 text-right">
                    {money(row.mrr_pence)}
                  </td>
                  <td data-numeric className="py-2 pr-4 whitespace-nowrap">
                    {day(row.started_at)}
                  </td>
                  <td data-numeric className="py-2 whitespace-nowrap">
                    {row.ended_at ? (
                      day(row.ended_at)
                    ) : (
                      <span className="text-(--color-muted)">Running</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      </section>

      {/*
        The statement.

        This was three consecutive tables in identical treatment, and the
        middle one — the money — was a Change column of signed amounts read
        newest-first. The product is called Ledger and had never once drawn
        one, which is the largest thing a design critique found in it.

        A ledger has facing columns, a foot that adds up, and a double rule
        under the closing balance. All three are here, and none of them are
        decoration: the two columns separate what took revenue away from what
        added it without needing colour to do it, the foot is a sum somebody
        can check against the balance by eye, and the double rule is what an
        accountant's page uses to say "this figure is final".

        Debit and credit are the right way round for a revenue account, where
        an increase is a credit. That is not common knowledge, so the standfirst
        says it rather than leaving the reader to work out which column is
        which.
      */}
      <section className="mt-10">
        <h2 className="text-lg">Statement</h2>
        <p className="mt-1 max-w-prose text-sm text-(--color-ink-2)">
          Every change to this account&rsquo;s recurring revenue, oldest first, adding up to
          the balance it carries today. Recurring revenue is a revenue account, so an
          increase is a <strong>credit</strong> and a reduction is a <strong>debit</strong>.
          The closing balance is the current MRR at the top of this page — the headline
          reconciles to its own history by inspection rather than by trust.
        </p>
        <Scroller label="Statement of revenue movements" className="mt-3">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              Statement of revenue movements, oldest first, with debits, credits and the
              balance after each, footed with the totals and the closing balance.
            </caption>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Movement</Th>
                <Th numeric>Debit</Th>
                <Th numeric>Credit</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => (
                <tr key={row.id} className="border-b border-(--color-rule)">
                  <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                    <span data-numeric>{day(row.occurred_on)}</span>
                  </th>
                  <td className="py-2 pr-4">{humanise(row.kind)}</td>
                  {/*
                    An empty cell rather than a zero. A ledger leaves the column
                    that did not move blank, and printing 0.00 in it would make
                    every row look like two entries instead of one.
                  */}
                  <td data-numeric className="py-2 pr-4 text-right">
                    {row.amount_pence < 0 ? moneyExact(Math.abs(row.amount_pence)) : ''}
                  </td>
                  <td data-numeric className="py-2 pr-4 text-right">
                    {row.amount_pence > 0 ? moneyExact(row.amount_pence) : ''}
                  </td>
                  <td data-numeric className="py-2 text-right">
                    {moneyExact(row.running_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
            {/*
              A real <tfoot>, so it is announced as one and stays with the
              table when the columns scroll.

              Single rule above, double rule below, which is the way round an
              accountant writes it: the line above means "these are being added
              up", and the double line beneath means the figure is final. CSS
              has had `border-style: double` since the beginning and almost
              nothing uses it; at 3px it renders as exactly what it is, two
              hairlines with a gap.
            */}
            <tfoot>
              <tr className="border-t border-(--color-ink) [border-bottom:3px_double_var(--color-ink)]">
                <th scope="row" colSpan={2} className="py-2 pr-4 text-left font-normal">
                  Carried forward
                </th>
                <td data-numeric className="py-2 pr-4 text-right">
                  {debits > 0 ? moneyExact(debits) : ''}
                </td>
                <td data-numeric className="py-2 pr-4 text-right">
                  {credits > 0 ? moneyExact(credits) : ''}
                </td>
                <td data-numeric className="py-2 text-right">
                  {moneyExact(closing)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Scroller>
      </section>

      <section className="mt-10">
        <h2 className="text-lg">Recent activity</h2>
        <p className="mt-1 max-w-prose text-sm text-(--color-ink-2)">
          {`The most recent ${FEED_LIMIT} of `}
          <span data-numeric>{count(customer.event_count)}</span>
          {' events. This is the query the index on '}
          <code>event (customer_id, occurred_at desc)</code>
          {' exists for: without it, finding these fifty rows is a sequential scan of a ' +
            'quarter of a million.'}
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-(--color-muted)">
            No activity recorded inside the report window.
          </p>
        ) : (
          <Scroller label="Recent activity table" className="mt-3">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">
                The {FEED_LIMIT} most recent events for this customer.
              </caption>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Event</Th>
                  <Th>Detail</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} className="border-b border-(--color-rule)">
                    <th scope="row" className="py-2 pr-4 text-left font-normal whitespace-nowrap">
                      <span data-numeric>{dayTime(row.occurred_at)}</span>
                    </th>
                    <td className="py-2 pr-4">{row.kind}</td>
                    <td className="py-2 text-(--color-ink-2)">{describe(row.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </section>
    </>
  )
}

function Th({children, numeric = false}: {children: React.ReactNode; numeric?: boolean}) {
  return (
    <th
      scope="col"
      className={`border-b border-(--color-rule-2) py-2 pr-4 font-normal whitespace-nowrap ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

/**
 * The jsonb payload as a sentence.
 *
 * Nothing queries inside `metadata`, so this is presentation only — but
 * printing raw JSON in a table cell is the moment a dashboard stops looking
 * like a product. Money in the payload is pence, like everywhere else.
 */
function describe(metadata: Record<string, unknown>): string {
  const parts = Object.entries(metadata).map(([key, value]) => {
    if (key === 'amount_pence' && typeof value === 'number') return money(value)
    return `${humanise(key)}: ${String(value)}`
  })
  return parts.join(' · ')
}

/**
 * A `from` query string, re-derived rather than trusted.
 *
 * It is parsed with the table's own parser and re-serialised with the table's
 * own writer, so whatever comes back is a URL the customers page would have
 * produced itself. A hand-edited value cannot smuggle in a path, a host, or a
 * parameter the table does not understand — the worst it can do is describe an
 * unfiltered table.
 */
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
