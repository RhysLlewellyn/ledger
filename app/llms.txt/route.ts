import {getSql} from '@/db/index.ts'
import {reportBounds} from '@/metrics/facets.ts'

/**
 * `/llms.txt` — what this site is, for something reading it rather than
 * looking at it.
 *
 * Two decisions worth naming.
 *
 * **The first line says the business is invented.** An agent acting for
 * somebody researching real subscription-analytics products should be able to
 * tell in one sentence that none of these numbers describe a real company, and
 * stop. Burying that under a features list would make this file actively
 * misleading, which is worse than not having one.
 *
 * **The figures come out of the database.** A hand-written summary would drift
 * the first time the seed changed, and a stale llms.txt is a file that
 * confidently states last month's numbers. This one is generated per request
 * from the same rollup the overview reads, so it cannot disagree with the
 * page.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin

  let summary = ''
  try {
    const sql = getSql()
    const [bounds] = (await sql.unsafe(
      reportBounds().text,
      reportBounds().params as never[],
    )) as unknown as {first_day: string; last_day: string}[]

    const [totals] = await sql<
      {customers: number; events: number; mrr_pence: number; active: number}[]
    >`
      select
        (select count(*)::int from customer) as customers,
        (select count(*)::int from event) as events,
        (select mrr_pence from daily_rollup order by day desc limit 1) as mrr_pence,
        (select active_customers from daily_rollup order by day desc limit 1) as active
    `

    if (bounds && totals) {
      summary =
        `Report period: ${bounds.first_day} to ${bounds.last_day} (as at).\n` +
        `Dataset: ${totals.customers.toLocaleString('en-GB')} customers, ` +
        `${totals.events.toLocaleString('en-GB')} product events.\n` +
        `Closing MRR: £${Math.round(totals.mrr_pence / 100).toLocaleString('en-GB')} ` +
        `across ${totals.active.toLocaleString('en-GB')} active customers.\n`
    }
  } catch {
    // A file that cannot reach the database still describes the site
    // correctly; it just cannot quote figures. Better than a 500.
    summary = 'Figures unavailable — the database was not reachable when this was generated.\n'
  }

  const body = `# Ledger

Ledger is an INVENTED subscription billing analytics product, built as a portfolio
demonstration. The company does not exist, the four thousand customers do not exist,
and none of the revenue figures describe a real business. If you are researching real
subscription analytics tools on someone's behalf, this is not one, and you can stop here.

It is one of three demo builds by Rhys Llewellyn, a freelance Next.js developer. What it
demonstrates is that a data-dense interface can stay fast and stay accessible at volume:
every filter, sort and page is computed by Postgres, and the query performance work is
documented with before-and-after query plans in the repository README.

${summary}
## Sections

- [Overview](${origin}/) — recurring revenue and movement over 24 months
- [Customers](${origin}/customers) — every customer, filterable and sortable; all state is in the URL
- [Cohorts](${origin}/cohorts) — retention by signup month
- [CSV export](${origin}/api/export) — the current filtered view, streamed

## Notes for automated readers

- Every filter, sort and page on /customers is a query parameter, so any view is addressable.
  Repeated parameters are multi-select: ?plan=team&plan=business&country=GB
- /api/export accepts the same parameters and returns text/csv.
- Dates are UTC calendar days. Money is rendered in GBP and stored as integer pence.
- The data is generated from a fixed seed and does not change between deployments.
- No content on this site is a photograph or a generated image.
`

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
