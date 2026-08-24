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
import type {Query} from '@/metrics/sql.ts'

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
  const [customer] = await run<CustomerDetail>(customerBySlug(slug))
  return customer ? {title: customer.name} : {title: 'Customer not found'}
}

export default async function CustomerPage({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params
  const [customer] = await run<CustomerDetail>(customerBySlug(slug))
  if (!customer) notFound()

  const [subscriptions, movements, events] = await Promise.all([
    run<SubscriptionRow>(customerSubscriptions(customer.id)),
    run<MovementRow>(customerMovements(customer.id)),
    run<EventRow>(customerEventFeed(customer.id, FEED_LIMIT)),
  ])

  const churned = customer.churned_at !== null

  return (
    <>
      <p className="text-sm">
        <a
          href="/customers"
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

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-b border-(--color-rule-2) pb-6 sm:grid-cols-4">
        <Figure
          label="Current MRR"
          value={money(customer.mrr_pence)}
          note={churned ? 'nil — account closed' : undefined}
        />
        <Figure label="Revenue booked" value={money(customer.lifetime_pence)} note="all positive movements" />
        <Figure label="Events recorded" value={count(customer.event_count)} />
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
        <div className="mt-3 overflow-x-auto">
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
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg">Revenue movements</h2>
        <p className="mt-1 max-w-prose text-sm text-(--color-ink-2)">
          Every change to this account&rsquo;s recurring revenue, with the balance after each
          one. The last figure in the running column is the current MRR above — the headline
          reconciles to the history by inspection rather than by trust.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">
              Revenue movements, most recent first, with the running balance after each.
            </caption>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Kind</Th>
                <Th numeric>Change</Th>
                <Th numeric>Running MRR</Th>
              </tr>
            </thead>
            <tbody>
              {movements.map((row) => (
                <tr key={row.id} className="border-b border-(--color-rule)">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    <span data-numeric>{day(row.occurred_on)}</span>
                  </th>
                  <td className="py-2 pr-4">{humanise(row.kind)}</td>
                  <td
                    data-numeric
                    className={`py-2 pr-4 text-right ${
                      row.amount_pence < 0 ? 'text-(--color-data-neg)' : ''
                    }`}
                  >
                    {movement(row.amount_pence)}
                  </td>
                  <td data-numeric className="py-2 text-right">
                    {moneyExact(row.running_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          <div className="mt-3 overflow-x-auto">
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
          </div>
        )}
      </section>
    </>
  )
}

function Figure({label, value, note}: {label: string; value: string; note?: string}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-(--color-ink-2) uppercase">{label}</dt>
      <dd data-numeric className="mt-1 text-xl">
        {value}
      </dd>
      {note && <dd className="text-xs text-(--color-muted)">{note}</dd>}
    </div>
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
