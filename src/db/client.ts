import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.ts'

/**
 * One connection factory, used by the seed, the measurement harness and the
 * tests.
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
  return {sql, db: drizzle(sql, {schema})}
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

export {schema}
