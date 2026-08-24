import {connect} from './client.ts'

/**
 * The application's connection, made once and made late.
 *
 * Late matters. Connecting at module scope means importing a page connects to
 * Postgres, and `next build` imports every page to collect its metadata — so a
 * build with no database in reach fails before it renders anything, including
 * the pages that never touch one. Deploying an empty shell first is the whole
 * point of having the URL exist from the start, and that is impossible if the
 * build needs a database to produce it.
 *
 * Once matters too. Next reloads modules freely in development, and a fresh
 * pool per reload exhausts the connection limit within a few edits. Hanging it
 * off globalThis is the usual, ugly, correct answer.
 *
 * `max: 5` against Neon's pooled endpoint. The pooler is what makes a
 * serverless function safe to point at Postgres at all: without it, every
 * concurrent invocation would open its own backend and the free tier's
 * connection limit would be the first thing to break under any load worth
 * having.
 */
const globalForDb = globalThis as {ledger?: ReturnType<typeof connect>}

export function getSql() {
  return (globalForDb.ledger ??= connect(process.env.DATABASE_URL, {max: 5})).sql
}
