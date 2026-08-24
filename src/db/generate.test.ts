import {describe, expect, it} from 'vitest'

import {
  AS_AT,
  generate,
  HISTORY_START,
  PLANS,
  SEED,
  TOTAL_CUSTOMERS,
  WINDOW_START,
  type Dataset,
} from './generate.ts'
import {monthIndex} from './rng.ts'

/**
 * Properties of the dataset, asserted against arrays.
 *
 * No database. These are claims about what the generator produces, and the
 * generator is a pure function, so proving them takes a couple of seconds and
 * no container. The claims that need Postgres — that a query uses an index,
 * that the rollup agrees with a rebuild — live in `src/metrics`.
 *
 * The reason this file exists at all is that the README quotes numbers about
 * this dataset and the performance test asserts thresholds against it. If the
 * generator quietly stopped producing a realistic churn curve, every one of
 * those claims would still pass while meaning nothing.
 */

const data = generate()

describe('determinism', () => {
  it('produces byte-identical output for the same seed', () => {
    const again = generate()
    expect(fingerprint(again)).toEqual(fingerprint(data))
  })

  it('produces different output for a different seed', () => {
    expect(fingerprint(generate(SEED + 1))).not.toEqual(fingerprint(data))
  })
})

describe('volume', () => {
  it('has the customer count the spec asks for', () => {
    expect(data.customers).toHaveLength(TOTAL_CUSTOMERS)
  })

  it('has at least 250,000 events', () => {
    expect(data.events.length).toBeGreaterThanOrEqual(250_000)
  })

  it('has roughly nine thousand movements', () => {
    expect(data.movements.length).toBeGreaterThan(8_000)
    expect(data.movements.length).toBeLessThan(11_000)
  })

  it('puts every event inside the report window', () => {
    // Events before the window are history no screen reads. Generating them
    // would inflate the volume claim without inflating anything the volume
    // claim is about.
    for (const event of data.events) {
      expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(WINDOW_START.getTime())
      expect(event.occurredAt.getTime()).toBeLessThanOrEqual(AS_AT.getTime())
    }
  })
})

describe('referential integrity', () => {
  const customerIds = new Set(data.customers.map((c) => c.id))
  const planIds = new Set(PLANS.map((p) => p.id))

  it('has no orphaned rows', () => {
    for (const row of data.subscriptions) {
      expect(customerIds.has(row.customerId)).toBe(true)
      expect(planIds.has(row.planId)).toBe(true)
    }
    for (const row of data.movements) expect(customerIds.has(row.customerId)).toBe(true)
    for (const row of data.events) expect(customerIds.has(row.customerId)).toBe(true)
  })

  it('never ends a subscription before it starts', () => {
    for (const row of data.subscriptions) {
      if (row.endedAt) expect(row.endedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime())
    }
  })

  it('gives every customer exactly one signup movement', () => {
    const news = new Map<string, number>()
    for (const m of data.movements) {
      if (m.kind === 'new') news.set(m.customerId, (news.get(m.customerId) ?? 0) + 1)
    }
    expect(news.size).toBe(TOTAL_CUSTOMERS)
    for (const count of news.values()) expect(count).toBe(1)
  })

  it('signs every movement the way the schema comment says it does', () => {
    for (const m of data.movements) {
      if (m.kind === 'contraction' || m.kind === 'churn') {
        expect(m.amountPence).toBeLessThan(0)
      } else {
        expect(m.amountPence).toBeGreaterThan(0)
      }
    }
  })

  it('agrees with itself about who has churned', () => {
    // `churned_at` is null exactly when some subscription is still running.
    // A customer who cancelled and came back has an ended subscription and a
    // running one, and is not churned — which is the case a single
    // `churned_at` column gets wrong if it is written from the wrong row.
    const running = new Set(
      data.subscriptions.filter((s) => s.endedAt === null).map((s) => s.customerId),
    )
    for (const c of data.customers) {
      expect(c.churnedAt === null).toBe(running.has(c.id))
    }
  })
})

describe('the shape of the business', () => {
  it('has a churn hazard that decays with tenure', () => {
    // The first months after signup are the dangerous ones; the risk falls
    // away from there. A flat monthly probability gives a clean exponential
    // curve that no subscription business has ever had, and a cohort grid
    // built on one has nothing in it to read.
    const early = hazardAtTenure(data, 1, 3)
    const late = hazardAtTenure(data, 18, 24)
    expect(early).toBeGreaterThan(late * 1.5)
  })

  it('has cohorts that differ from each other', () => {
    const curves = retentionByCohort(data, 6)
    const values = [...curves.values()].filter((v) => v > 0)
    const spread = Math.max(...values) - Math.min(...values)
    expect(spread).toBeGreaterThan(0.08)
  })

  it('has seasonal acquisition rather than a flat line', () => {
    const byCalendarMonth = new Array<number>(12).fill(0)
    for (const c of data.customers) byCalendarMonth[c.signedUpAt.getUTCMonth()]! += 1
    const busiest = Math.max(...byCalendarMonth)
    const quietest = Math.min(...byCalendarMonth)
    expect(busiest).toBeGreaterThan(quietest * 1.4)
  })

  it('makes expansion the second-largest positive movement', () => {
    const total = (kind: string) =>
      data.movements.filter((m) => m.kind === kind).reduce((sum, m) => sum + m.amountPence, 0)
    expect(total('expansion')).toBeGreaterThan(total('reactivation'))
    expect(total('new')).toBeGreaterThan(total('expansion'))
  })

  it('grows: MRR at the end of the window exceeds MRR at the start', () => {
    const at = (day: Date) =>
      data.movements
        .filter((m) => m.occurredOn <= day.toISOString().slice(0, 10))
        .reduce((sum, m) => sum + m.amountPence, 0)
    expect(at(AS_AT)).toBeGreaterThan(at(WINDOW_START) * 2)
  })

  it('starts the window from a going concern rather than from zero', () => {
    const before = data.movements.filter(
      (m) => m.occurredOn < WINDOW_START.toISOString().slice(0, 10),
    )
    expect(before.length).toBeGreaterThan(500)
    expect(HISTORY_START.getTime()).toBeLessThan(WINDOW_START.getTime())
  })
})

/* ----------------------------------------------------------------- helpers */

function fingerprint(dataset: Dataset): string {
  return JSON.stringify({
    customers: dataset.customers.length,
    movements: dataset.movements.length,
    events: dataset.events.length,
    firstCustomer: dataset.customers[0],
    lastMovement: dataset.movements[dataset.movements.length - 1],
    lastEvent: dataset.events[dataset.events.length - 1],
  })
}

/**
 * The share of customers still active at the start of a tenure band who churn
 * during it — a hazard rather than a headcount, so the bands are comparable.
 */
function hazardAtTenure(dataset: Dataset, fromMonth: number, toMonth: number): number {
  let atRisk = 0
  let churned = 0
  for (const customer of dataset.customers) {
    const start = monthIndex(customer.signedUpAt)
    const observed = monthIndex(AS_AT) - start
    if (observed < fromMonth) continue
    const end = customer.churnedAt ? monthIndex(customer.churnedAt) - start : Infinity
    if (end < fromMonth) continue
    atRisk += 1
    if (end >= fromMonth && end <= toMonth) churned += 1
  }
  return atRisk === 0 ? 0 : churned / atRisk
}

/** Retention at `offset` months, per signup month, for cohorts old enough. */
function retentionByCohort(dataset: Dataset, offset: number): Map<number, number> {
  const size = new Map<number, number>()
  const retained = new Map<number, number>()
  const lastMonth = monthIndex(AS_AT)

  for (const customer of dataset.customers) {
    const cohort = monthIndex(customer.signedUpAt)
    if (lastMonth - cohort < offset) continue
    size.set(cohort, (size.get(cohort) ?? 0) + 1)
    const churned = customer.churnedAt ? monthIndex(customer.churnedAt) - cohort : Infinity
    if (churned >= offset) retained.set(cohort, (retained.get(cohort) ?? 0) + 1)
  }

  const out = new Map<number, number>()
  for (const [cohort, n] of size) {
    if (n < 30) continue
    out.set(cohort, (retained.get(cohort) ?? 0) / n)
  }
  return out
}
