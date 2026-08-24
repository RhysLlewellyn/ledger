import {mkdir, writeFile} from 'node:fs/promises'

import {connect} from '../src/db/client.ts'
import {AS_AT, WINDOW_START} from '../src/db/generate.ts'
import {cohortRetention} from '../src/metrics/cohorts.ts'
import {customerEvents, customerTable} from '../src/metrics/customers.ts'
import {
  mrrSeriesCorrelated,
  mrrSeriesFromMovements,
  mrrSeriesFromRollup,
} from '../src/metrics/mrr-series.ts'
import type {Query} from '../src/metrics/sql.ts'

/**
 * The measurement harness.
 *
 * `npm run measure -- before` writes `docs/measurements/before.md`; run it
 * again after a migration with a different label and the two files are the
 * before and after that §4 of the README quotes. Nothing in that section is
 * typed by hand.
 *
 * Three things about the method, because a benchmark whose method is not
 * stated is a number rather than a measurement:
 *
 * One connection, so every run sees the same backend and the same view of the
 * buffer cache. Two connections would be two different machines as far as the
 * numbers are concerned.
 *
 * A warm-up run that is discarded, then a run of timed runs, reported as
 * median and p95. The first execution against a cold cache is a disk
 * measurement; quoting it as the query's cost is the most common way a
 * before-and-after is made to look better than it is. p95 rather than mean
 * because the target in the spec is a p95 target.
 *
 * The sample size adapts, and the table says what it was for each row. Twenty
 * runs of a query that takes half a millisecond costs nothing; twenty runs of
 * the unindexed customer table costs eleven minutes, and the twentieth tells
 * you nothing the third did not. A run count that is quietly different between
 * the before and the after would be a way to cheat the comparison, so it is
 * printed in the same table as the numbers it produced.
 *
 * `explain (analyze, buffers)` is captured separately from the timing, because
 * `explain analyze` adds its own instrumentation overhead and its "Execution
 * Time" is not what a user waits for. The plan is there to say *what changed*;
 * the timings say *by how much*.
 *
 * Both numbers are reported, and against a remote database the gap between
 * them is the point. The wall clock is what this machine waited; the server
 * column is planning plus execution inside Postgres, which is what a function
 * deployed alongside the database would wait. Running the harness from a
 * laptop in one country against Postgres in another and quoting the wall clock
 * as the query's cost is how a database gets blamed for a round trip.
 */

/** Sample size by how slow the query turned out to be, in milliseconds. */
const BUDGET: readonly (readonly [number, number])[] = [
  [200, 20],
  [2_000, 8],
  [20_000, 3],
  [Infinity, 1],
]

const from = WINDOW_START.toISOString().slice(0, 10)
const to = AS_AT.toISOString().slice(0, 10)

type Measurement = {
  name: string
  serverMs: number | null
  medianMs: number
  p95Ms: number
  minMs: number
  runs: number
  rows: number
  plan: string
  planSummary: string
}

async function main() {
  const label = process.argv[2]
  if (!label || !/^[a-z0-9-]+$/.test(label)) {
    console.error('usage: npm run measure -- <label>   (e.g. before, after-indexes)')
    process.exit(1)
  }

  const {sql} = connect()

  // A real customer id from the seeded set, chosen the way the page chooses
  // one: the busiest account, because measuring the event feed against a
  // customer with four events would measure nothing.
  const [busiest] = await sql<{customer_id: string; n: number}[]>`
    select customer_id, count(*)::int as n
    from event
    group by customer_id
    order by n desc
    limit 1
  `
  if (!busiest) throw new Error('No events. Run `npm run seed` first.')

  const queries: Query[] = [
    mrrSeriesFromMovements(from, to),
    mrrSeriesFromRollup(from, to),
    mrrSeriesCorrelated(from, to),
    cohortRetention('2023-02-01', to, 23, to),
    named(
      'customer-table (page 1, unfiltered)',
      customerTable({sort: 'mrr', direction: 'desc', page: 1, perPage: 50}),
    ),
    named(
      'customer-table (page 12, four filters)',
      customerTable({
        sort: 'signed_up',
        direction: 'desc',
        page: 12,
        perPage: 50,
        countries: ['GB', 'US', 'DE'],
        statuses: ['active'],
      }),
    ),
    named(
      'customer-table (sorted by last seen)',
      customerTable({sort: 'last_seen', direction: 'desc', page: 1, perPage: 50}),
    ),
    customerEvents(busiest.customer_id, 50),
  ]

  const results: Measurement[] = []
  for (const query of queries) {
    process.stdout.write(`${query.name}… `)
    results.push(await measure(sql, query))
    const last = results[results.length - 1]!
    console.log(
      `${format(last.medianMs)} median, ` +
        `${last.serverMs == null ? '?' : format(last.serverMs)} in Postgres · ${last.planSummary}`,
    )
  }

  await mkdir('docs/measurements', {recursive: true})
  await writeFile(`docs/measurements/${label}.md`, render(label, results), 'utf8')
  console.log(`\nwritten to docs/measurements/${label}.md`)

  await sql.end()
}

/**
 * A display name for one variant of a query.
 *
 * Three different calls into `customerTable` produce three genuinely different
 * plans, and a table listing all three as `customer-table` is a table nobody
 * can read a before-and-after out of.
 */
function named(name: string, query: Query): Query {
  return {...query, name}
}

async function measure(
  sql: ReturnType<typeof connect>['sql'],
  query: Query,
): Promise<Measurement> {
  // One probe run, both to warm the cache and to find out how much this query
  // can afford to be measured.
  const probeStarted = process.hrtime.bigint()
  const rows = (await sql.unsafe(query.text, query.params as never[])).length
  const probeMs = Number(process.hrtime.bigint() - probeStarted) / 1e6

  const runs = BUDGET.find(([ceiling]) => probeMs < ceiling)![1]

  const samples: number[] = []
  if (runs === 1) {
    // Too slow to sample. The probe is the measurement, and it is a cold one —
    // which flatters nothing, since this branch only ever catches the queries
    // that are about to be shown to be too slow anyway.
    samples.push(probeMs)
  } else {
    for (let i = 0; i < runs; i += 1) {
      const started = process.hrtime.bigint()
      await sql.unsafe(query.text, query.params as never[])
      samples.push(Number(process.hrtime.bigint() - started) / 1e6)
    }
  }
  samples.sort((a, b) => a - b)

  const plan = (
    await sql.unsafe(
      `explain (analyze, buffers, verbose false) ${query.text}`,
      query.params as never[],
    )
  )
    .map((row) => (row as Record<string, string>)['QUERY PLAN'])
    .join('\n')

  return {
    name: query.name,
    serverMs: serverTime(plan),
    runs,
    medianMs: samples[Math.floor(samples.length / 2)]!,
    p95Ms: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!,
    minMs: samples[0]!,
    rows,
    plan,
    planSummary: summarise(plan),
  }
}

/**
 * The scan nodes in the plan, in the order they appear, deduplicated.
 *
 * This is the line that actually answers "what changed?" — a sequential scan
 * becoming an index scan is the whole story of a migration that adds indexes,
 * and it is buried thirty lines into an `explain` output that nobody reads in
 * a README.
 */
function summarise(plan: string): string {
  const scans = plan
    .split('\n')
    .map((line) =>
      // Postgres writes `Index Scan using <index> on <table>` but
      // `Seq Scan on <table>`, so the index clause has to be optional --
      // matching it greedily is how the first version of this reported an
      // index scan "on event_customer_occurred_idx", naming the index as if
      // it were the table.
      line.match(
        /(Seq Scan|Index Only Scan|Index Scan|Bitmap Heap Scan|Bitmap Index Scan)(?: using (\w+))? on (\w+)/,
      ),
    )
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => `${match[1]} on ${match[3]}`)
  return [...new Set(scans)].join(', ') || 'no scan nodes'
}

/**
 * Planning plus execution, as Postgres measured them: the part of the wall
 * clock that is the database rather than the wire.
 */
function serverTime(plan: string): number | null {
  const planning = plan.match(/Planning Time: ([\d.]+) ms/)
  const execution = plan.match(/Execution Time: ([\d.]+) ms/)
  if (!execution) return null
  return Number(execution[1]) + Number(planning?.[1] ?? 0)
}

/** Milliseconds up to a second, then seconds. `41056.3 ms` reads as noise. */
function format(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(2)} s` : `${ms.toFixed(1)} ms`
}

function render(label: string, results: readonly Measurement[]): string {
  const lines: string[] = [
    `# Query measurements — \`${label}\``,
    '',
    'Median and p95 over the stated number of runs, after one discarded warm-up run, on one',
    'connection, against the seeded dataset. Generated by `npm run measure` — do not edit by hand.',
    '',
    'A run count of 1 means the query was too slow to sample and the single figure is a cold run.',
    '',
    'The server column is planning plus execution inside Postgres. The rest is wall clock from',
    'the machine running the harness, and against a remote database the difference between them',
    'is the network.',
    '',
    '| Query | Rows | Runs | Server | Median | p95 | Fastest | Scans |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
  ]

  for (const r of results) {
    lines.push(
      `| \`${r.name}\` | ${r.rows.toLocaleString()} | ${r.runs} | ` +
        `${r.serverMs == null ? '—' : format(r.serverMs)} | ` +
        `${format(r.medianMs)} | ${format(r.p95Ms)} | ${format(r.minMs)} | ${r.planSummary} |`,
    )
  }

  lines.push('', '---', '')
  for (const r of results) {
    lines.push(`## \`${r.name}\``, '', '```', r.plan, '```', '')
  }

  return lines.join('\n')
}

await main()
