import {getSql} from '@/db/index.ts'

/**
 * A holding page, so the URL exists from the first day of the build rather
 * than from the last one.
 *
 * It reads three real numbers out of the deployed database rather than being
 * static text. That is not decoration either: it is the only thing that proves
 * the whole path — a function in `lhr1`, through Neon's pooled endpoint, to a
 * database in `eu-west-2` — actually works. A connection string that is
 * configured but never exercised is a connection string that fails on the day
 * the first real page needs it.
 */
export const dynamic = 'force-dynamic'

type Summary = {
  day: string
  mrr_pence: number
  active_customers: number
  events: number
}

async function summary(): Promise<Summary | null> {
  try {
    const sql = getSql()
    const [row] = await sql<Summary[]>`
      select
        r.day::text as day,
        r.mrr_pence,
        r.active_customers,
        (select count(*)::int from event) as events
      from daily_rollup r
      order by r.day desc
      limit 1
    `
    return row ?? null
  } catch {
    // The page still renders. A holding page that 500s because a free-tier
    // database was asleep is a worse first impression than one that says the
    // numbers are not available.
    return null
  }
}

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

export default async function Home() {
  const data = await summary()

  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-2xl">Ledger</h1>
      <p className="mt-4 max-w-prose text-sm">
        Subscription billing analytics for an invented SaaS. Four thousand customers, two
        complete years of billing history and a quarter of a million product events.
      </p>
      <p className="mt-4 max-w-prose text-sm">
        The data layer is built and measured; the interface is not here yet. The
        query-performance work — the seeded dataset, the plans before and after the
        indexes, and the test that guards them — is written up in the README.
      </p>

      {data ? (
        <>
          <dl className="mt-10 border-t border-(--color-rule) text-sm">
            <div className="flex justify-between border-b border-(--color-rule) py-2">
              <dt>MRR</dt>
              <dd data-numeric>{money.format(data.mrr_pence / 100)}</dd>
            </div>
            <div className="flex justify-between border-b border-(--color-rule) py-2">
              <dt>Active customers</dt>
              <dd data-numeric>{data.active_customers.toLocaleString('en-GB')}</dd>
            </div>
            <div className="flex justify-between border-b border-(--color-rule) py-2">
              <dt>Events recorded</dt>
              <dd data-numeric>{data.events.toLocaleString('en-GB')}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-(--color-ink-2)">
            As at <span data-numeric>{data.day}</span>. Read live from the deployed database
            on every request — nothing here is cached or hard-coded.
          </p>
        </>
      ) : (
        <p className="mt-10 text-sm text-(--color-ink-2)">
          The database is not answering at the moment, so the figures are not shown. The
          free tier suspends compute when idle; a refresh usually wakes it.
        </p>
      )}
    </main>
  )
}
