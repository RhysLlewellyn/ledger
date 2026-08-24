import {afterAll, describe, expect, it} from 'vitest'

import {connect} from '../db/client.ts'
import {AS_AT, WINDOW_START} from '../db/generate.ts'
import {probeDatabase, skipWithoutDatabase, testDatabaseUrl} from '../db/testing.ts'
import {cohortRetention} from './cohorts.ts'
import {customerEvents, customerTable} from './customers.ts'
import {mrrSeriesFromRollup} from './mrr-series.ts'
import type {Query} from './sql.ts'

/**
 * Performance that is not tested is performance that regresses.
 *
 * This file guards the numbers §4 of the README quotes, and it does it in two
 * ways on purpose, because each catches what the other cannot.
 *
 * **The plan assertion.** Every dashboard query is run through
 * `explain (analyze)` and checked for a sequential scan of `event` — the
 * quarter-of-a-million-row table. That is the regression that actually
 * happens: somebody drops an index, or adds a column to a `select` that turns
 * an index-only scan into a heap fetch, or writes a new filter that the index
 * cannot serve. A plan assertion is a claim about the *shape* of the work, so
 * it means the same thing on a laptop, on a build server and on the free tier
 * of Neon. It is the assertion that matters.
 *
 * **The wall-clock assertion.** The ceilings below are roughly five times the
 * measured p95 on the development machine. That is deliberately loose: the
 * point is not to pin down a millisecond figure on hardware nobody else has,
 * it is to fail loudly when a query goes from tens of milliseconds to tens of
 * seconds, which is what every regression here has actually looked like. The
 * unindexed customer table took 32 seconds; the ceiling is 400 milliseconds.
 * Nothing in between is ambiguous.
 *
 * `npm run measure` is the tool for the real numbers. This is the tripwire.
 */

const probe = await probeDatabase()
const skip = skipWithoutDatabase('src/metrics/performance.test.ts', probe)

const {sql} = connect(testDatabaseUrl(), {max: 1})
afterAll(async () => {
  await sql.end({timeout: 5})
})

const from = WINDOW_START.toISOString().slice(0, 10)
const to = AS_AT.toISOString().slice(0, 10)

/** The spec's target: every dashboard query under 100ms at p95. */
const TARGET_MS = 100

/**
 * One case per query a page actually runs, named for the table this prints —
 * three different calls into `customerTable` produce three different plans,
 * and three rows all labelled `customer-table` would be a report nobody can
 * act on.
 */
const CASES: {label: string; query: Query; ceilingMs: number}[] = [
  {
    label: 'overview: MRR series from the rollup',
    query: mrrSeriesFromRollup(from, to),
    ceilingMs: 100,
  },
  {
    label: 'cohorts: retention grid',
    query: cohortRetention('2023-02-01', to, 23, to),
    ceilingMs: 300,
  },
  {
    label: 'customers: page 1, unfiltered',
    query: customerTable({sort: 'mrr', direction: 'desc', page: 1, perPage: 50}),
    ceilingMs: 150,
  },
  {
    label: 'customers: page 12, four filters',
    query: customerTable({
      sort: 'signed_up',
      direction: 'desc',
      page: 12,
      perPage: 50,
      countries: ['GB', 'US', 'DE'],
      statuses: ['active'],
    }),
    ceilingMs: 150,
  },
  {
    label: 'customers: sorted by last seen',
    query: customerTable({sort: 'last_seen', direction: 'desc', page: 1, perPage: 50}),
    ceilingMs: 400,
  },
  {label: 'customer: event feed', query: customerEvents('', 50), ceilingMs: 50},
]

describe.skipIf(skip)('every dashboard query stays fast at volume', () => {
  it.each(CASES.map((c) => [c.label, c] as const))(
    '%s reads no table sequentially that it has an index for',
    async (_name, {query}) => {
      const resolved = await resolve(query)
      const plan = await explain(resolved)

      // `event` has a quarter of a million rows in it and every query that
      // touches it here touches a handful. A sequential scan of it in any of
      // these plans means the index is gone or is no longer usable.
      expect(plan, 'sequential scan of the event table').not.toMatch(/Seq Scan on event\b/)
    },
  )

  it.each(CASES.map((c) => [c.label, c] as const))(
    '%s stays under its ceiling',
    async (_name, {query, ceilingMs}) => {
      const resolved = await resolve(query)

      // One warm-up, then five timed runs, and the slowest is the one that
      // has to pass. A median would let one run in five be arbitrarily bad,
      // and a page that is slow one time in five is a slow page.
      await sql.unsafe(resolved.text, resolved.params as never[])
      const samples: number[] = []
      for (let i = 0; i < 5; i += 1) {
        const started = process.hrtime.bigint()
        await sql.unsafe(resolved.text, resolved.params as never[])
        samples.push(Number(process.hrtime.bigint() - started) / 1e6)
      }

      const slowest = Math.max(...samples)
      expect(slowest, `${slowest.toFixed(1)}ms`).toBeLessThan(ceilingMs)
    },
  )

  it('meets the target the spec set, on this machine', async () => {
    // Reported rather than merely asserted: the spec asks for every dashboard
    // query under 100ms at p95, and this prints the table that shows whether
    // that is true here. It is a separate test from the ceilings above
    // because it is a claim about *this* hardware, and a build server that
    // cannot meet it is not a broken build.
    const rows: string[] = []
    let met = true

    for (const {label, query} of CASES) {
      const resolved = await resolve(query)
      await sql.unsafe(resolved.text, resolved.params as never[])
      const samples: number[] = []
      for (let i = 0; i < 10; i += 1) {
        const started = process.hrtime.bigint()
        await sql.unsafe(resolved.text, resolved.params as never[])
        samples.push(Number(process.hrtime.bigint() - started) / 1e6)
      }
      samples.sort((a, b) => a - b)
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!
      met &&= p95 < TARGET_MS
      rows.push(`    ${p95 < TARGET_MS ? '✓' : '✗'} ${p95.toFixed(1).padStart(7)} ms  ${label}`)
    }

    console.log(`\n  p95 against the seeded dataset (target ${TARGET_MS} ms):\n${rows.join('\n')}\n`)
    expect(met, 'a dashboard query missed the p95 target — see the table above').toBe(true)
  })
})

/**
 * Fills in the one parameter that cannot be known in advance.
 *
 * The event feed needs a real customer id, and it has to be a busy one: the
 * query is `limit 50` over that account's history, and an account with four
 * events measures nothing about an index that exists to stop a scan.
 */
async function resolve(query: Query): Promise<Query> {
  if (query.name !== 'customer-events') return query
  const [busiest] = await sql<{customer_id: string}[]>`
    select customer_id from event group by customer_id order by count(*) desc limit 1
  `
  return customerEvents(busiest!.customer_id, 50)
}

async function explain(query: Query): Promise<string> {
  const rows = await sql.unsafe(
    `explain (analyze, buffers) ${query.text}`,
    query.params as never[],
  )
  return rows.map((row) => (row as Record<string, string>)['QUERY PLAN']).join('\n')
}
