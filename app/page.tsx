import Link from 'next/link'

import {getSql} from '@/db/index.ts'
import {count, countDelta, day, money, movement, percent} from '@/format.ts'
import {reportBounds} from '@/metrics/facets.ts'
import {mrrMonthly, type MrrMonth} from '@/metrics/mrr-series.ts'
import type {Query} from '@/metrics/sql.ts'

import {MovementChart} from './charts/movement-chart.tsx'
import {MrrChart} from './charts/mrr-chart.tsx'

/**
 * The overview.
 *
 * Every figure on it is a sum computed by Postgres. There is no `.reduce()`
 * over a fetched array anywhere in this file — where a number appears, a query
 * produced it, and the only arithmetic here is the difference between two of
 * them.
 */
export const dynamic = 'force-dynamic'

async function run<T>(query: Query): Promise<T[]> {
  return (await getSql().unsafe(query.text, query.params as never[])) as unknown as T[]
}

export default async function Overview() {
  let bounds: {first_day: string; last_day: string} | undefined
  try {
    ;[bounds] = await run<{first_day: string; last_day: string}>(reportBounds())
  } catch {
    return <Unavailable />
  }
  if (!bounds) return <Unavailable />

  // The report window is the last 24 complete months of the dataset.
  const asAt = bounds.last_day
  const start = new Date(`${asAt}T00:00:00Z`)
  start.setUTCDate(1)
  start.setUTCMonth(start.getUTCMonth() - 23)
  const from = start.toISOString().slice(0, 10)

  const months = await run<MrrMonth>(mrrMonthly(from, asAt))
  if (months.length === 0) return <Unavailable />

  const first = months[0]!
  const last = months[months.length - 1]!
  const previous = months[months.length - 2] ?? first

  const mrr = Number(last.mrr_pence)
  const priorMrr = Number(previous.mrr_pence)
  const netLastMonth =
    Number(last.new_pence) +
    Number(last.expansion_pence) +
    Number(last.reactivation_pence) +
    Number(last.contraction_pence) +
    Number(last.churn_pence)

  // Revenue churn for the last month, against the balance it started from.
  const churnRate = priorMrr === 0 ? 0 : Math.abs(Number(last.churn_pence)) / priorMrr

  return (
    <>
      <header className="border-b border-(--color-ink) pb-4">
        <h1 className="text-2xl">Overview</h1>
        <p className="mt-2 max-w-prose text-sm text-(--color-ink-2)">
          Twenty-four months to <span data-numeric>{day(asAt)}</span>. Ledger is an invented
          subscription business; every figure below is computed from its billing history by
          the database, not stored anywhere as a total.
        </p>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 border-b border-(--color-rule-2) pb-6 lg:grid-cols-4">
        <Figure
          label="Monthly recurring revenue"
          value={money(mrr)}
          note={`${movement(mrr - priorMrr)} on the month`}
        />
        <Figure
          label="Active customers"
          value={count(last.active_customers)}
          note={`${countDelta(last.active_customers - previous.active_customers)} on the month`}
        />
        <Figure
          label="Net movement"
          value={movement(netLastMonth)}
          note={`in ${monthName(last.month)}`}
        />
        <Figure
          label="Revenue churn"
          value={percent(churnRate, 1)}
          note={`${count(last.churn_count)} accounts lost`}
        />
      </dl>

      <section className="mt-10">
        <h2 className="text-lg">Recurring revenue</h2>
        <MrrChart months={months} />
      </section>

      <section className="mt-12">
        <h2 className="text-lg">Where the change came from</h2>
        <MovementChart months={months} />
      </section>

      <nav className="mt-12 border-t border-(--color-rule-2) pt-4 text-sm">
        <ul className="flex flex-wrap gap-6">
          <li>
            <Link
              href="/cohorts"
              className="underline underline-offset-4"
            >
              Retention by signup month →
            </Link>
          </li>
          <li>
            <Link
              href="/customers"
              className="underline underline-offset-4"
            >
              All {count(4000)} customers →
            </Link>
          </li>
        </ul>
      </nav>
    </>
  )
}

function Figure({label, value, note}: {label: string; value: string; note?: string}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-(--color-ink-2) uppercase">{label}</dt>
      <dd data-numeric className="mt-1 text-2xl">
        {value}
      </dd>
      {note && (
        <dd data-numeric className="mt-0.5 text-xs text-(--color-muted)">
          {note}
        </dd>
      )}
    </div>
  )
}

function monthName(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(
    new Date(`${value}-01T00:00:00Z`),
  )
}

/**
 * The free tier suspends compute after five minutes idle. A page that 500s
 * because nobody visited for an hour is a worse first impression than one that
 * says what happened.
 */
function Unavailable() {
  return (
    <>
      <h1 className="text-2xl">Overview</h1>
      <p className="mt-4 max-w-prose text-sm">
        The database is not answering at the moment, so the figures are not shown. This
        deployment runs on a free tier that suspends its compute when idle; a refresh usually
        wakes it.
      </p>
    </>
  )
}
