import {getSql} from '@/db/index.ts'
import {count, countDelta, day, money, movement, percent, percentDelta} from '@/format.ts'
import {reportBounds} from '@/metrics/facets.ts'
import {mrrMonthly, type MrrMonth} from '@/metrics/mrr-series.ts'
import type {Query} from '@/metrics/sql.ts'

import {Figure} from './figure-block.tsx'
import {Unavailable} from './unavailable.tsx'

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
    return <Unavailable title="Overview" retry="/" />
  }
  if (!bounds) return <Unavailable title="Overview" retry="/" />

  // The report window is the last 24 complete months of the dataset.
  const asAt = bounds.last_day
  const start = new Date(`${asAt}T00:00:00Z`)
  start.setUTCDate(1)
  start.setUTCMonth(start.getUTCMonth() - 23)
  const from = start.toISOString().slice(0, 10)

  const months = await run<MrrMonth>(mrrMonthly(from, asAt))
  if (months.length === 0) return <Unavailable title="Overview" retry="/" />

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

      {/*
        One figure per row on a phone, two from `sm`, four from `lg`.

        At two columns on a 360px screen the row was misreading three ways at
        once: "MONTHLY RECURRING REVENUE" wraps to two lines while "ACTIVE
        CUSTOMERS" does not, so the four values sat on three different
        baselines; and £3,439,147 needs 141.6px against a column that gives it
        140px at 360 and 120px at 320, so the largest number on the site spent
        two thirds of the gutter it was supposed to be separated by.

        Stacking is the fix rather than a smaller type size, because the figure
        is the reason the row exists and shrinking it to fit a column is
        answering the wrong question.
      */}
      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-5 border-b border-(--color-rule-2) pb-6 sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-4">
        <Figure
          label="Monthly recurring revenue"
          value={money(mrr)}
          // The rate, not the amount. This note used to read "+£83,063 on the
          // month" and the Net movement figure two cells along reads +£83,063,
          // because they are the same quantity by construction — a quarter of
          // the headline row was restating another cell's subtitle. The rate
          // is the thing the row could not otherwise tell you, and it is what
          // the chart caption below goes on to talk about.
          note={`${percentDelta(priorMrr === 0 ? 0 : (mrr - priorMrr) / priorMrr, 1)} on the month`}
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
          note={
            // The figure names a set of customers, and the table can show that
            // set. Sorted by when they were last seen, because the useful
            // question about a cancelled account is when it went.
            <a
              href="/customers?status=cancelled&sort=last_seen&dir=desc"
              className="underline underline-offset-4"
            >
              {`${count(last.churn_count)} accounts lost`}
            </a>
          }
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
            <a
              href="/cohorts"
              className="inline-block py-1 underline underline-offset-4"
            >
              Retention by signup month →
            </a>
          </li>
          <li>
            <a
              href="/customers"
              className="inline-block py-1 underline underline-offset-4"
            >
              All {count(4000)} customers →
            </a>
          </li>
        </ul>
      </nav>
    </>
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
