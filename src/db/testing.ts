/**
 * Whether the tests that need a real database can run.
 *
 * Most of what is asserted in this repository is asserted against Postgres,
 * because most of what this repository claims is about Postgres: that a query
 * uses an index, that a trigger-maintained table agrees with a full rebuild,
 * that a page of fifty rows out of a quarter of a million comes back in single
 * milliseconds. None of those can be mocked — a stubbed query plan asserts
 * that the stub returns what it was told to.
 *
 * The choice is between two bad first impressions. Erroring means somebody who
 * clones this and types `npm test` sees red files and a stack trace about
 * ECONNREFUSED, which reads as a broken repository rather than a missing
 * container. Skipping quietly means a green suite that has not proved the one
 * thing the repository is for.
 *
 * So: skip, but never quietly. The reason is printed, it names what was not
 * proved, and `CI=1` turns the skip off entirely — on a build server an
 * unreachable database is a broken pipeline, not a local convenience.
 */

import {connect} from './client.ts'

export type DatabaseProbe = {ok: true} | {ok: false; reason: string}

/** One cheap round trip, with a short timeout so an unreachable host fails in
 * seconds rather than hanging the suite. */
export async function probeDatabase(): Promise<DatabaseProbe> {
  const url = process.env.DATABASE_URL
  if (!url) {
    return {ok: false, reason: 'DATABASE_URL is not set (copy .env.example to .env)'}
  }

  const {sql} = connect(url, {max: 1, connectTimeoutSeconds: 5})
  try {
    const [row] = await sql<{n: number}[]>`select count(*)::int as n from event`
    if (!row || row.n === 0) {
      return {ok: false, reason: 'the database is reachable but empty — run `npm run seed`'}
    }
    return {ok: true}
  } catch (error) {
    return {ok: false, reason: describe(error)}
  } finally {
    await sql.end({timeout: 1})
  }
}

/**
 * `true` when the database-backed tests in `file` should be skipped, having
 * said so on the way past.
 *
 * The message is deliberately specific about what is going unproven. "3
 * skipped" in a summary is easy to read past; a line naming the query-plan
 * guarantee is not.
 */
export function skipWithoutDatabase(file: string, probe: DatabaseProbe): boolean {
  if (probe.ok) return false

  // On a build server there is no such thing as an optional database.
  if (process.env.CI) return false

  console.warn(
    `\n  ${file}: SKIPPED — no seeded Postgres reachable.\n` +
      `  ${probe.reason}\n` +
      '  These tests prove the query plans and the timings the README quotes.\n' +
      '  Run `npm run db:up && npm run db:migrate && npm run seed` to include\n' +
      '  them. CI never skips them.\n',
  )
  return true
}

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://localhost:1/database-url-is-not-set'
}

/**
 * A connection failure in a sentence.
 *
 * The driver raises an `AggregateError` when it has tried both IPv6 and IPv4
 * and both were refused, and that wrapper's own `message` is the empty string
 * — so the naive `error.message` prints nothing at all, which is exactly the
 * unhelpful skip this file exists to avoid.
 */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map(describe)
    return [...new Set(inner)].join('; ') || 'connection refused'
  }
  if (error instanceof Error) {
    const {code, address, port} = error as Error & {
      code?: string
      address?: string
      port?: number
    }
    const where = address ? ` at ${address}:${port ?? '?'}` : ''
    return error.message || `${code ?? 'connection failed'}${where}`
  }
  return String(error)
}
