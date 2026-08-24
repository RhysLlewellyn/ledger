import {connect} from './client.ts'
import {AS_AT, generate, HISTORY_START, WINDOW_START} from './generate.ts'
import {refreshRollup} from './rollup.ts'

/**
 * Loads the generated dataset into Postgres.
 *
 * Idempotent by truncation rather than by upsert. The generator is
 * deterministic, so "the rows that should be there" is a fixed answer and the
 * cheapest correct way to reach it is to empty the tables and write them
 * again. An upsert would leave behind any row an earlier version of the
 * generator produced and this one no longer does — which is exactly the drift
 * that makes a quoted `EXPLAIN ANALYZE` stop being reproducible.
 *
 * `npm run seed` takes about a minute for a quarter of a million rows.
 */

const CHUNK = 2_000

async function main() {
  const started = process.hrtime.bigint()
  const {sql} = connect()

  console.log('generating…')
  const data = generate()
  console.log(
    `  ${data.customers.length.toLocaleString()} customers · ` +
      `${data.subscriptions.length.toLocaleString()} subscriptions · ` +
      `${data.movements.length.toLocaleString()} movements · ` +
      `${data.events.length.toLocaleString()} events`,
  )

  /**
   * The rollup triggers come off for the bulk load and go back on afterwards.
   *
   * They are row triggers, and the subscription one recomputes an active
   * customer count across every day a subscription spans. That is the right
   * cost for one subscription starting today and an absurd one for four and a
   * half thousand of them arriving at once: the seed would spend hours
   * recomputing a column it is about to rebuild in a single statement anyway.
   * Disabling triggers around a bulk load and reconciling afterwards is what
   * a loader does; the reconciliation is `refreshRollup`, and a test checks
   * that what the triggers maintain and what the rebuild produces are the
   * same table.
   */
  await sql`alter table mrr_movement disable trigger user`
  await sql`alter table subscription disable trigger user`

  console.log('truncating…')
  // One statement, so the foreign keys never see an inconsistent moment.
  await sql`
    truncate table event, mrr_movement, subscription, customer, plan, daily_rollup
    restart identity cascade
  `

  console.log('writing plan…')
  await sql`
    insert into plan ${sql(
      data.plans.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        monthly_price_pence: p.monthlyPricePence,
        active: p.active,
      })),
    )}
  `

  await insertChunked(sql, 'customer', data.customers, (c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    country: c.country,
    signed_up_at: c.signedUpAt.toISOString(),
    churned_at: c.churnedAt?.toISOString() ?? null,
    acquisition_channel: c.acquisitionChannel,
  }))

  await insertChunked(sql, 'subscription', data.subscriptions, (s) => ({
    id: s.id,
    customer_id: s.customerId,
    plan_id: s.planId,
    started_at: s.startedAt.toISOString(),
    ended_at: s.endedAt?.toISOString() ?? null,
    seats: s.seats,
    status: s.status,
  }))

  await insertChunked(sql, 'mrr_movement', data.movements, (m) => ({
    id: m.id,
    customer_id: m.customerId,
    occurred_on: m.occurredOn,
    kind: m.kind,
    amount_pence: m.amountPence,
  }))

  await insertChunked(sql, 'event', data.events, (e) => ({
    id: e.id,
    customer_id: e.customerId,
    occurred_at: e.occurredAt.toISOString(),
    kind: e.kind,
    metadata: JSON.stringify(e.metadata),
  }))

  await sql`alter table mrr_movement enable trigger user`
  await sql`alter table subscription enable trigger user`

  console.log('building daily_rollup…')
  const rollupRows = await refreshRollup(sql)
  console.log(`  ${rollupRows.toLocaleString()} days`)

  /**
   * Without this the planner is working from statistics collected when the
   * tables were empty, which produces sequential scans over a quarter of a
   * million rows and an `EXPLAIN ANALYZE` that measures the absence of an
   * ANALYZE rather than the absence of an index. Autovacuum would get there
   * on its own, eventually, which is not a basis for a measurement.
   */
  console.log('analyzing…')
  await sql`analyze`

  const elapsed = Number(process.hrtime.bigint() - started) / 1e9
  console.log(
    `\ndone in ${elapsed.toFixed(1)}s. ` +
      `Report window ${WINDOW_START.toISOString().slice(0, 10)} → ` +
      `${AS_AT.toISOString().slice(0, 10)}, ` +
      `history from ${HISTORY_START.toISOString().slice(0, 10)}.`,
  )

  await sql.end()
}

async function insertChunked<T>(
  sql: ReturnType<typeof connect>['sql'],
  table: string,
  rows: readonly T[],
  toRow: (row: T) => Record<string, unknown>,
): Promise<void> {
  process.stdout.write(`writing ${table}… `)
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map(toRow)
    // `sql(rows)` builds one multi-row INSERT. The chunk size keeps the
    // parameter count well under Postgres' 65,535 limit per statement — at
    // seven columns, 2,000 rows is 14,000 parameters.
    await sql`insert into ${sql(table)} ${sql(batch as never)}`
  }
  console.log(`${rows.length.toLocaleString()} rows`)
}

await main()
