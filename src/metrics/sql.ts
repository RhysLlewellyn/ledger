/**
 * A query is a string and a list of parameters.
 *
 * Everything in `src/metrics` is built this way rather than with postgres-js
 * tagged templates, for one reason: the measurement harness has to run
 * *exactly* the statement the page runs, and prefix it with
 * `explain (analyze, buffers)`. A tagged template cannot be inspected or
 * wrapped without rebuilding it, which means the thing measured and the thing
 * shipped would be two pieces of code that are supposed to stay identical.
 * They never do.
 *
 * The parameters are still parameters — nothing here interpolates a value into
 * SQL. Identifiers that vary (the sort column, the direction) come from closed
 * allowlists, because those cannot be parameterised in Postgres and an
 * allowlist is the only safe way to vary them.
 */

export type Query = {
  /** A human name, used by the measurement harness and its output. */
  name: string
  text: string
  params: unknown[]
}

/**
 * Collects parameters and hands back their `$n` placeholders, so a query can
 * be assembled out of order without anybody counting positions by hand.
 * Miscounting `$4` is a bug that type-checks.
 */
export class Params {
  readonly values: unknown[] = []

  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}
