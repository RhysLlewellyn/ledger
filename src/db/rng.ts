/**
 * A deterministic pseudo-random source, and the date arithmetic the seed needs
 * to go with it.
 *
 * The dataset has to be the same on every machine and on every run. That is
 * not tidiness: §4 of the README quotes `EXPLAIN ANALYZE` timings against a
 * named row count, and a test asserts a millisecond threshold against the same
 * rows. Both are claims about a specific dataset. If `npm run seed` produced a
 * different one each time, neither would mean anything, and a failing
 * performance test would be indistinguishable from an unlucky one.
 *
 * So: mulberry32, one fixed seed, and nothing anywhere in the seed path reads
 * `Math.random()`, `Date.now()` or the system clock.
 */

export type Rng = () => number

/**
 * mulberry32. Small, fast, and good enough for generating plausible business
 * data — this is not a cryptographic context and does not pretend to be one.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [min, max]. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** Box–Muller, clamped. Used for seat counts and event volumes, both of which
 * are long-tailed in real products and uniform in generated ones. */
export function normal(rng: Rng, mean: number, sd: number): number {
  const u = Math.max(rng(), Number.EPSILON)
  const v = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Poisson by Knuth's method. Fine for the small means used here. */
export function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0
  const limit = Math.exp(-mean)
  let k = 0
  let p = 1
  do {
    k += 1
    p *= rng()
  } while (p > limit)
  return k - 1
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

/** Weighted pick. Weights need not sum to anything in particular. */
export function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let r = rng() * total
  for (const [value, weight] of entries) {
    r -= weight
    if (r <= 0) return value
  }
  return entries[entries.length - 1]![0]
}

/**
 * A v4-shaped UUID drawn from the same stream as everything else.
 *
 * `defaultRandom()` on the column would be simpler and would make the ids
 * differ on every seed, which defeats the point above — two runs would produce
 * the same *shape* of dataset but not the same rows, and a query plan quoted
 * in the README could not be reproduced exactly.
 */
export function uuid(rng: Rng): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) {
      out += '4'
      continue
    }
    if (i === 16) {
      out += hex[8 + Math.floor(rng() * 4)]
      continue
    }
    out += hex[Math.floor(rng() * 16)]
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`
}

/* ------------------------------------------------------------------ dates */

const MS_PER_DAY = 86_400_000

/**
 * Everything in the seed is computed in UTC, including the calendar days.
 * A generator that used local time would produce a different dataset in
 * Auckland than in London — the same seed, different rows — and the first
 * symptom would be a movement landing in the wrong month.
 */
export function utc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/** `YYYY-MM-DD`, always UTC. This is what goes into a `date` column. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Months are counted from a fixed origin so cohort maths is integer maths. */
export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

export function monthStart(index: number): Date {
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1))
}

export function daysInMonth(index: number): number {
  return new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0)).getUTCDate()
}
