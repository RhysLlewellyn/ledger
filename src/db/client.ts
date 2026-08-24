import postgres from 'postgres'

/**
 * One connection factory, used by the seed, the measurement harness and the
 * tests.
 *
 * There is no ORM in the request path, and that is deliberate rather than an
 * omission. Drizzle is here for its schema language and its migration
 * generator — `schema.ts` is the description the migrations are diffed
 * against, and `drizzle-kit` writes them. But every query this product runs is
 * an aggregate, a window function or a lateral join written by hand in
 * `src/metrics`, because that is what a dashboard is; there is no row-mapping
 * for a query builder to help with, and the measurement harness has to be able
 * to run the exact statement a page runs and prefix it with `explain`.
 *
 * Wrapping this connection in `drizzle()` also has a side effect worth naming,
 * because it cost an hour: the adapter installs its own type parsers on the
 * postgres-js instance, and `timestamptz` starts coming back as a string
 * rather than a `Date` for *every* query on that connection, including the raw
 * ones. Two libraries disagreeing about what a timestamp is, silently, at the
 * boundary. Not using the adapter at runtime removes the disagreement rather
 * than papering over it.
 *
 * `max` matters more here than it usually would. The measurement harness runs
 * the same query repeatedly and compares milliseconds; two connections would
 * mean two backends with two different views of the buffer cache, and the
 * numbers would stop being comparable to each other.
 */
export function connect(
  url: string = requireDatabaseUrl(),
  options: {max?: number; connectTimeoutSeconds?: number} = {},
) {
  const sql = postgres(url, {
    max: options.max ?? 1,
    connect_timeout: options.connectTimeoutSeconds,
    onnotice: () => {},
  })
  return {sql}
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, then `npm run db:up`.',
    )
  }
  return url
}
