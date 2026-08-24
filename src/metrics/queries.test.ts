import {afterAll, describe, expect, it} from 'vitest'

import {connect} from '../db/client.ts'
import {AS_AT, WINDOW_START} from '../db/generate.ts'
import {refreshRollup} from '../db/rollup.ts'
import {probeDatabase, skipWithoutDatabase, testDatabaseUrl} from '../db/testing.ts'
import {cohortRetention, type CohortCell} from './cohorts.ts'
import {customerMovements, type MovementRow} from './customer-detail.ts'
import {customerTable, type CustomerQueryOptions, type CustomerRow} from './customers.ts'
import {customerExport} from './export.ts'
import {mrrSeriesFromMovements, mrrSeriesFromRollup, type MrrPoint} from './mrr-series.ts'
import type {Query} from './sql.ts'

/**
 * What the queries return, against the seeded database.
 *
 * The theme of this file is that nothing is trusted twice. `daily_rollup` is a
 * cache, so it is checked against the computation it caches. The trigger that
 * maintains it is checked against the full rebuild. Pagination is checked by
 * walking every page and looking for a row that appears twice or not at all,
 * which is the only way that particular bug ever shows up.
 */

const probe = await probeDatabase()
const skip = skipWithoutDatabase('src/metrics/queries.test.ts', probe)

const {sql} = connect(testDatabaseUrl(), {max: 1})
afterAll(async () => {
  await sql.end({timeout: 5})
})

const from = WINDOW_START.toISOString().slice(0, 10)
const to = AS_AT.toISOString().slice(0, 10)

function run<T>(query: Query): Promise<T[]> {
  return sql.unsafe(query.text, query.params as never[]) as unknown as Promise<T[]>
}

describe.skipIf(skip)('the rollup agrees with the spine', () => {
  it('returns the same series computed either way', async () => {
    const [honest, cached] = await Promise.all([
      run<MrrPoint>(mrrSeriesFromMovements(from, to)),
      run<MrrPoint>(mrrSeriesFromRollup(from, to)),
    ])

    expect(cached).toHaveLength(honest.length)
    expect(honest.length).toBe(730)
    // Row for row, not spot-checked. A cache that agrees on the first and last
    // day and diverges in March is the failure this is looking for.
    expect(cached.map(normalise)).toEqual(honest.map(normalise))
  })

  it('is what a full rebuild would produce', async () => {
    const before = await sql`select * from daily_rollup order by day`
    const rows = await refreshRollup(sql)
    const after = await sql`select * from daily_rollup order by day`

    expect(rows).toBe(before.length)
    expect(after).toEqual(before)
  })
})

describe.skipIf(skip)('the rollup triggers', () => {
  it('carries a new movement forward through every later day', async () => {
    const day = '2025-06-15'
    const [customer] = await sql<{id: string}[]>`select id from customer limit 1`

    const before = await rollupRows()
    await sql`
      insert into mrr_movement (customer_id, occurred_on, kind, amount_pence)
      values (${customer!.id}, ${day}::date, 'expansion', 123456)
    `

    try {
      const after = await rollupRows()
      for (const row of after) {
        const previous = before.find((r) => r.day === row.day)!
        const expected = row.day >= day ? previous.mrr_pence + 123456 : previous.mrr_pence
        expect(row.mrr_pence, `on ${row.day}`).toBe(expected)
      }
    } finally {
      await sql`
        delete from mrr_movement
        where occurred_on = ${day}::date and amount_pence = 123456
      `
    }

    // And back to where it started, which is the half of a trigger that is
    // usually written and never tested.
    expect(await rollupRows()).toEqual(before)
  })

  it('leaves the table identical to a rebuild after a write', async () => {
    const [customer] = await sql<{id: string}[]>`select id from customer limit 1`
    await sql`
      insert into mrr_movement (customer_id, occurred_on, kind, amount_pence)
      values (${customer!.id}, '2025-11-04'::date, 'churn', -4200)
    `

    try {
      const maintained = await rollupRows()
      await refreshRollup(sql)
      expect(await rollupRows()).toEqual(maintained)
    } finally {
      await sql`delete from mrr_movement where amount_pence = -4200 and occurred_on = '2025-11-04'`
      await refreshRollup(sql)
    }
  })

  it('recounts active customers when a subscription ends', async () => {
    const [row] = await sql<{id: string; started_at: Date}[]>`
      select id, started_at from subscription where ended_at is null order by started_at limit 1
    `
    const day = row!.started_at.toISOString().slice(0, 10)
    const before = await activeOn(day)

    await sql`update subscription set ended_at = started_at where id = ${row!.id}`
    try {
      expect(await activeOn(day)).toBeLessThan(before)
    } finally {
      await sql`update subscription set ended_at = null where id = ${row!.id}`
    }
    expect(await activeOn(day)).toBe(before)
  })
})

describe.skipIf(skip)('the customer table', () => {
  it('paginates without losing or repeating a row', async () => {
    const perPage = 50
    const seen = new Set<string>()
    let total = 0

    // Sorted by plan, which has five distinct values across four thousand
    // rows — so almost every comparison is a tie, and an unstable sort would
    // fail here and nowhere else.
    for (let page = 1; page <= 8; page += 1) {
      const rows = await run<CustomerRow>(
        customerTable({sort: 'plan', direction: 'asc', page, perPage}),
      )
      total = Number(rows[0]!.total_count)
      for (const row of rows) {
        expect(seen.has(row.id), `${row.name} appeared twice`).toBe(false)
        seen.add(row.id)
      }
    }

    expect(seen.size).toBe(8 * perPage)
    expect(total).toBe(4_000)
  })

  it('reports a total that matches the rows a filter actually returns', async () => {
    const options = {
      sort: 'name',
      direction: 'asc',
      perPage: 50,
      countries: ['GB'],
      statuses: ['active'],
    } as const

    const first = await run<CustomerRow>(customerTable({...options, page: 1}))
    const total = Number(first[0]!.total_count)

    const [{count}] = await sql<{count: number}[]>`
      select count(*)::int as count
      from customer c
      join lateral (
        select status from subscription s
        where s.customer_id = c.id order by s.started_at desc, s.id limit 1
      ) cs on true
      where c.country = 'GB' and cs.status = 'active'
    `
    expect(total).toBe(count)
  })

  it('applies every filter it is given', async () => {
    const rows = await run<CustomerRow>(
      customerTable({
        sort: 'mrr',
        direction: 'desc',
        page: 1,
        perPage: 50,
        plans: ['business', 'enterprise'],
        countries: ['GB', 'DE'],
        channels: ['outbound'],
        signedUpFrom: '2024-01-01',
        mrrMinPence: 100_000,
      }),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(['business', 'enterprise']).toContain(row.plan_slug)
      expect(['GB', 'DE']).toContain(row.country)
      expect(row.acquisition_channel).toBe('outbound')
      expect(row.signed_up_at.toISOString() >= '2024-01-01T00:00:00.000Z').toBe(true)
      expect(Number(row.mrr_pence)).toBeGreaterThanOrEqual(100_000)
    }
  })

  it('sorts by last seen without changing which rows come back on other sorts', async () => {
    const rows = await run<CustomerRow>(
      customerTable({sort: 'last_seen', direction: 'desc', page: 1, perPage: 50}),
    )
    const seen = rows.map((r) => r.last_seen_at?.getTime() ?? 0)
    expect(seen).toEqual([...seen].sort((a, b) => b - a))
    expect(Number(rows[0]!.total_count)).toBe(4_000)
  })
})

describe.skipIf(skip)('cohort retention', () => {
  it('starts every cohort at its own size', async () => {
    const cells = await run<CohortCell>(cohortRetention('2023-02-01', to, 23, to))
    expect(byCohort(cells).size).toBeGreaterThan(20)

    for (const [cohort, row] of byCohort(cells)) {
      const zero = row.find((c) => c.month_offset === 0)!
      // Month 0 is 100% by construction — everybody in a cohort was a
      // customer in the month they signed up. A grid whose first column is
      // not solid has a definition problem, not a data problem.
      expect(zero.retained, `${cohort} month 0`).toBe(zero.cohort_size)
      for (const cell of row) {
        expect(cell.retained, `${cohort} month ${cell.month_offset}`).toBeLessThanOrEqual(
          cell.cohort_size,
        )
      }
    }
  })

  it('falls overall, and rises only where somebody came back', async () => {
    // The grid counts who was paying in month k, so reactivation can push a
    // cell above the one to its left. That is the intended behaviour and it
    // is exactly the shape a bug would also take, so it is not enough to
    // assert "sometimes it rises" — every rise has to be accounted for.
    const cells = await run<CohortCell>(cohortRetention('2023-02-01', to, 23, to))
    const reactivations = await reactivationsByCohort()

    for (const [cohort, row] of byCohort(cells)) {
      const sorted = [...row].sort((a, b) => a.month_offset - b.month_offset)
      let rises = 0
      for (let i = 1; i < sorted.length; i += 1) {
        const delta = sorted[i]!.retained - sorted[i - 1]!.retained
        if (delta > 0) rises += delta
      }
      expect(rises, `${cohort} rose more than it had returners`).toBeLessThanOrEqual(
        reactivations.get(cohort) ?? 0,
      )
      // And the curve still describes churn: given half a year to do it in,
      // it has fallen. The youngest cohorts are excluded rather than given a
      // weaker assertion — a cohort with one observed month has no curve, and
      // asserting anything about its shape would be asserting nothing.
      if (sorted.length >= 6) {
        expect(sorted[sorted.length - 1]!.retained, `${cohort} never fell`).toBeLessThan(
          sorted[0]!.retained,
        )
      }
    }
  })

  it('produces no cell for a month that has not happened yet', async () => {
    const cells = await run<CohortCell>(cohortRetention('2023-02-01', to, 23, to))
    for (const cell of cells) {
      const cellMonth = new Date(`${cell.cohort_month}-01T00:00:00Z`)
      cellMonth.setUTCMonth(cellMonth.getUTCMonth() + cell.month_offset)
      expect(cellMonth.getTime()).toBeLessThanOrEqual(AS_AT.getTime())
    }
  })
})

/* ----------------------------------------------------------------- helpers */

function byCohort(cells: readonly CohortCell[]): Map<string, CohortCell[]> {
  const out = new Map<string, CohortCell[]>()
  for (const cell of cells) {
    out.set(cell.cohort_month, [...(out.get(cell.cohort_month) ?? []), cell])
  }
  return out
}

/** How many customers in each signup cohort have ever come back. */
async function reactivationsByCohort(): Promise<Map<string, number>> {
  const rows = await sql<{cohort_month: string; n: number}[]>`
    select
      to_char(date_trunc('month', c.signed_up_at at time zone 'UTC'), 'YYYY-MM') as cohort_month,
      count(distinct m.customer_id)::int as n
    from customer c
    join mrr_movement m on m.customer_id = c.id and m.kind = 'reactivation'
    group by 1
  `
  return new Map(rows.map((r) => [r.cohort_month, r.n]))
}

type RollupRow = {day: string; mrr_pence: number; active_customers: number}

function rollupRows(): Promise<RollupRow[]> {
  return sql<RollupRow[]>`
    select day::text as day, mrr_pence, active_customers from daily_rollup order by day
  ` as unknown as Promise<RollupRow[]>
}

async function activeOn(day: string): Promise<number> {
  const [row] = await sql<{n: number}[]>`
    select active_customers as n from daily_rollup where day = ${day}::date
  `
  return row!.n
}

/** Dates and bigints come back from the driver in shapes that differ between
 * the two queries; compare the values, not the wrappers. */
function normalise(point: MrrPoint): Record<string, string | number> {
  return {
    day: String(point.day).slice(0, 10),
    active_customers: Number(point.active_customers),
    mrr_pence: String(point.mrr_pence),
    new_pence: String(point.new_pence),
    expansion_pence: String(point.expansion_pence),
    contraction_pence: String(point.contraction_pence),
    churn_pence: String(point.churn_pence),
    reactivation_pence: String(point.reactivation_pence),
  }
}

describe.skipIf(skip)('the export and the table describe the same customers', () => {
  /*
    The README claims the file and the screen cannot disagree about what "the
    current view" is. Until recently that rested on two hand-written copies of
    the same predicate sitting in two files, which is a claim with a shelf
    life: they were byte-identical right up until name search was added to one
    of them. They share `customerWhere` now, and this is what holds it.
  */
  const views: CustomerQueryOptions[] = [
    {sort: 'mrr', direction: 'desc', page: 1, perPage: 50},
    {sort: 'name', direction: 'asc', page: 1, perPage: 50, query: 'works'},
    {sort: 'mrr', direction: 'desc', page: 1, perPage: 50, countries: ['GB'], query: 'quarry'},
    {sort: 'mrr', direction: 'desc', page: 1, perPage: 50, statuses: ['active'], mrrMinPence: 500_00},
    {sort: 'mrr', direction: 'desc', page: 1, perPage: 50, query: 'no-such-company-anywhere'},
  ]

  it.each(views.map((v, i) => [i, v] as const))(
    'view %i matches row for row',
    async (_i, options) => {
      const [rows, exported] = await Promise.all([
        run<CustomerRow>(customerTable(options)),
        run<{slug: string}>(customerExport(options)),
      ])

      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0
      // The table pages; the export does not. The count the page prints is
      // the number of rows the file will contain.
      expect(exported).toHaveLength(total)

      // And the first page is genuinely the first page of that file, in the
      // same order, rather than the same rows shuffled.
      expect(exported.slice(0, rows.length).map((r) => r.slug)).toEqual(rows.map((r) => r.slug))
    },
  )

  it('matches a name literally, so a wildcard is not a filter that matches everything', async () => {
    const all = await run<CustomerRow>(
      customerTable({sort: 'mrr', direction: 'desc', page: 1, perPage: 1}),
    )
    const everyone = Number(all[0]!.total_count)

    const wildcard = await run<CustomerRow>(
      customerTable({sort: 'mrr', direction: 'desc', page: 1, perPage: 1, query: '%'}),
    )
    const matched = wildcard.length > 0 ? Number(wildcard[0]!.total_count) : 0

    expect(everyone).toBeGreaterThan(0)
    expect(matched).toBeLessThan(everyone)
  })
})

describe.skipIf(skip)('the statement foots', () => {
  /*
    The customer page prints a debit total, a credit total and a closing
    balance under a double rule, and claims the third is the second minus the
    first. That claim is the whole reason the section is drawn as a ledger
    rather than as a list, so it is worth more than an assertion in a comment.

    It also checks the running balance, which comes from a window function in
    SQL, against a plain accumulation in JavaScript. Two ways of computing the
    same column, which is this file's habit.
  */
  it('reconciles debits, credits and the closing balance for every busy account', async () => {
    const busiest = await run<{id: string; n: number}>({
      name: 'test-busiest-customers',
      params: [],
      text: `select customer_id as id, count(*)::int as n
             from mrr_movement group by customer_id
             order by n desc limit 25`,
    })
    expect(busiest.length).toBe(25)

    for (const {id} of busiest) {
      const rows = await run<MovementRow>(customerMovements(id))
      expect(rows.length).toBeGreaterThan(0)

      // Oldest first, because a statement accumulates downward.
      const days = rows.map((r) => r.occurred_on)
      expect([...days].sort()).toEqual(days)

      const debits = rows.reduce((n, r) => (r.amount_pence < 0 ? n - r.amount_pence : n), 0)
      const credits = rows.reduce((n, r) => (r.amount_pence > 0 ? n + r.amount_pence : n), 0)
      const closing = Number(rows[rows.length - 1]!.running_pence)

      expect(credits - debits).toBe(closing)

      // And the window function agrees with accumulating by hand, row by row.
      let balance = 0
      for (const row of rows) {
        balance += row.amount_pence
        expect(Number(row.running_pence)).toBe(balance)
      }
    }
  })
})
