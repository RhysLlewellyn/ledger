import {unstable_cache} from 'next/cache'

import type {Query} from '@/metrics/sql.ts'

import {getSql} from './index.ts'

/**
 * Run a query through Next's data cache.
 *
 * The dataset is seeded once and never changes, so a page that queried
 * Postgres on every request was paying for nothing. It was also paying in a
 * currency with a hard limit: on 26 August 2026 crawlers walking the customer
 * table (4,400 requests in a week, 1,600 distinct pages) took the Neon
 * project through its monthly data-transfer allowance and Neon paused it.
 * Every route showed its "database is not answering" fallback until the
 * account was upgraded.
 *
 * The cache key is the statement text plus its parameters, so two filters
 * never share a result, and an hour is the revalidation window. Errors are
 * not cached: a query that throws still reaches the page's fallback, and the
 * next request tries the database again.
 *
 * Results cross a JSON boundary on the way back, so a `timestamptz` column
 * arrives as an ISO string rather than a `Date`. Every formatter in
 * `src/format.ts` accepts either; nothing else reads those columns directly.
 */
const execute = unstable_cache(
  async (text: string, params: unknown[]): Promise<unknown[]> =>
    (await getSql().unsafe(text, params as never[])) as unknown as unknown[],
  ['ledger-query'],
  {revalidate: 3600},
)

export function run<T>(query: Query): Promise<T[]> {
  return execute(query.text, query.params) as Promise<T[]>
}
