import {Params, type Query} from './sql.ts'

/**
 * The filtered, sorted, paginated customer table.
 *
 * The shape of this query is the point of it, so it is worth stating plainly:
 * **filter and paginate first, decorate afterwards.**
 *
 * A page shows fifty rows and each row carries a last-seen timestamp and an
 * event count, which come from a table with a quarter of a million rows in it.
 * The obvious query joins that aggregate in alongside everything else and lets
 * `limit 50` throw away 98.75% of the work at the very end. It is correct, it
 * reads well, and it is the difference between a page that renders in single
 * milliseconds and one that does not.
 *
 * So `matched` does the filtering, sorting and pagination against `customer`,
 * `subscription` and a small aggregate over the movement spine, and the
 * lateral join that touches `event` runs afterwards — fifty times, against an
 * index, rather than once against the whole table.
 *
 * The single exception is sorting by last seen, which cannot be done after the
 * rows are chosen because it is what chooses them. That sort pays for a full
 * aggregate over `event`; every other sort does not. The README says so, and
 * the measurement harness measures both.
 */

export type CustomerRow = {
  id: string
  name: string
  slug: string
  country: string
  acquisition_channel: string
  signed_up_at: Date
  churned_at: Date | null
  plan_name: string
  plan_slug: string
  seats: number
  status: string
  mrr_pence: string
  last_seen_at: Date | null
  event_count: string
  total_count: string
}

export type SortColumn =
  | 'name'
  | 'mrr'
  | 'signed_up'
  | 'seats'
  | 'plan'
  | 'country'
  | 'status'
  | 'channel'
  | 'last_seen'

export type Direction = 'asc' | 'desc'

export type CustomerFilters = {
  /** A substring of the customer's name, case-insensitive. */
  query?: string
  plans?: readonly string[]
  statuses?: readonly string[]
  countries?: readonly string[]
  channels?: readonly string[]
  signedUpFrom?: string
  signedUpTo?: string
  mrrMinPence?: number
  mrrMaxPence?: number
}

export type CustomerQueryOptions = CustomerFilters & {
  sort: SortColumn
  direction: Direction
  page: number
  perPage: number
}

/**
 * A sort column cannot be a bound parameter in Postgres, so it comes from a
 * closed map instead. Nothing from a URL reaches the SQL text; an unrecognised
 * value never gets as far as this file.
 */
const SORT_EXPRESSION: Record<SortColumn, string> = {
  name: 'c.name',
  mrr: 'mrr_pence',
  signed_up: 'c.signed_up_at',
  seats: 'cs.seats',
  plan: 'p.monthly_price_pence',
  country: 'c.country',
  status: 'cs.status',
  channel: 'c.acquisition_channel',
  last_seen: 'last_seen_at',
}

/**
 * The same orders again, against the columns `matched` exposes.
 *
 * Two maps rather than one string rewritten: the outer sort has to repeat the
 * inner one, because a lateral join is not order-preserving and dropping the
 * outer `order by` gives fifty correct rows in an arbitrary sequence. Deriving
 * the second from the first by string substitution was the first version of
 * this, and it was one renamed column away from silently sorting on the wrong
 * thing.
 *
 * The plan column sorts by price, not by name. "Business" before "Starter" is
 * alphabetical and useless; nobody has ever wanted a plan column in
 * dictionary order.
 */
const OUTER_SORT_EXPRESSION: Record<SortColumn, string> = {
  name: 'm.name',
  mrr: 'm.mrr_pence',
  signed_up: 'm.signed_up_at',
  seats: 'm.seats',
  plan: 'm.plan_price_pence',
  country: 'm.country',
  status: 'm.status',
  channel: 'm.acquisition_channel',
  last_seen: 'm.last_seen_at',
}

/**
 * The filter predicate, built once and used by both readers of it.
 *
 * The table and the CSV export ran two hand-written copies of this list. They
 * were byte-identical, which is exactly the problem: the README claims the file
 * and the screen cannot disagree about what "the current view" is, and two
 * copies of a predicate is a promise that they will, on the first filter that
 * only gets added to one of them. Adding name search made that concrete —
 * without this, the export would have quietly ignored the search box.
 *
 * Returns the clauses rather than a string, because the callers alias their
 * tables the same way but assemble the rest of the query differently.
 *
 * **The alias contract**: every clause below names `c` (customer), `p` (plan),
 * `cs` (the current subscription) and `cm` (the customer's summed movements).
 * Any query using this has to join those four under exactly those names.
 */
export function customerWhere(options: CustomerFilters, p: Params): string[] {
  const where: string[] = []

  /*
    Case-insensitive substring on the name.

    A leading wildcard cannot use a btree index, and it does not need to:
    measured on the seeded dataset, a sequential scan of four thousand
    customers matching 137 of them runs in 1.2 ms. A pg_trgm GIN index would be
    ceremony at this size — it would buy nothing measurable and would have to be
    maintained on every write. The honest note is that this is the one filter
    that does not scale with the table, and at four hundred thousand customers
    it is the first thing that would need one.

    `strpos`, not `ilike`. The term is a bound parameter either way, so neither
    form is injectable — but a bound parameter concatenated into a LIKE pattern
    is still read as pattern syntax, and a search for "%" matched all four
    thousand customers. A test caught it on the first run. `strpos` has no
    pattern language at all, so every character means itself.
  */
  if (options.query) {
    where.push(`strpos(lower(c.name), lower(${p.add(options.query)})) > 0`)
  }
  if (options.plans?.length) where.push(`p.slug = any(${p.add(options.plans)})`)
  if (options.statuses?.length) where.push(`cs.status::text = any(${p.add(options.statuses)})`)
  if (options.countries?.length) where.push(`c.country = any(${p.add(options.countries)})`)
  if (options.channels?.length) {
    where.push(`c.acquisition_channel::text = any(${p.add(options.channels)})`)
  }
  if (options.signedUpFrom) {
    where.push(`(c.signed_up_at at time zone 'UTC')::date >= ${p.add(options.signedUpFrom)}::date`)
  }
  if (options.signedUpTo) {
    where.push(`(c.signed_up_at at time zone 'UTC')::date <= ${p.add(options.signedUpTo)}::date`)
  }
  if (options.mrrMinPence != null) {
    where.push(`coalesce(cm.mrr_pence, 0) >= ${p.add(options.mrrMinPence)}`)
  }
  if (options.mrrMaxPence != null) {
    where.push(`coalesce(cm.mrr_pence, 0) <= ${p.add(options.mrrMaxPence)}`)
  }

  return where
}

export function customerTable(options: CustomerQueryOptions): Query {
  const p = new Params()
  const where = customerWhere(options, p)


  // Sorting by last seen has to happen before the page is chosen, so that one
  // sort pulls the event aggregate up into `matched`. Every other sort leaves
  // it where it belongs: after the limit.
  const sortsOnEvents = options.sort === 'last_seen'
  const dir = options.direction === 'desc' ? 'desc' : 'asc'
  // `id` breaks every tie. Without it two customers on the same plan, or with
  // the same MRR, can swap places between page 2 and page 3 — and a row is
  // then either seen twice or not at all. The classic unstable-pagination bug,
  // which only appears on the data where it matters.
  const innerOrder = `order by ${SORT_EXPRESSION[options.sort]} ${dir} nulls last, c.id asc`
  const outerOrder = `order by ${OUTER_SORT_EXPRESSION[options.sort]} ${dir} nulls last, m.id asc`

  const limit = p.add(options.perPage)
  const offset = p.add((options.page - 1) * options.perPage)

  const eventAggregate = `
    left join lateral (
      select max(e.occurred_at) as last_seen_at, count(*)::bigint as event_count
      from event e
      where e.customer_id = c.id
    ) ev on true`

  return {
    name: sortsOnEvents ? 'customer-table (sorted by last seen)' : 'customer-table',
    params: p.values,
    text: `
      with customer_mrr as (
        -- The whole spine, aggregated once. Fewer than nine thousand rows, so
        -- this is cheap; doing it per customer in a lateral would not be.
        select customer_id, sum(amount_pence)::bigint as mrr_pence
        from mrr_movement
        group by customer_id
      ),
      current_subscription as (
        -- One row per customer: their latest subscription. A plan change ends
        -- one subscription and starts another on the same day, so "which plan
        -- are they on?" is a question about the most recent row, not the only
        -- row.
        select distinct on (customer_id)
          customer_id, plan_id, seats, status, started_at, ended_at
        from subscription
        order by customer_id, started_at desc, id
      ),
      matched as (
        select
          c.id,
          c.name,
          c.slug,
          c.country,
          c.acquisition_channel,
          c.signed_up_at,
          c.churned_at,
          p.name as plan_name,
          p.slug as plan_slug,
          p.monthly_price_pence as plan_price_pence,
          cs.seats,
          cs.status,
          coalesce(cm.mrr_pence, 0) as mrr_pence,
          ${sortsOnEvents ? 'ev.last_seen_at,\n          coalesce(ev.event_count, 0) as event_count,' : ''}
          count(*) over ()::bigint as total_count
        from customer c
        join current_subscription cs on cs.customer_id = c.id
        join plan p on p.id = cs.plan_id
        left join customer_mrr cm on cm.customer_id = c.id
        ${sortsOnEvents ? eventAggregate : ''}
        ${where.length ? `where ${where.join('\n          and ')}` : ''}
        ${innerOrder}
        limit ${limit}
        offset ${offset}
      )
      select
        m.*${sortsOnEvents ? '' : ',\n        ev.last_seen_at,\n        coalesce(ev.event_count, 0) as event_count'}
      from matched m${
        sortsOnEvents
          ? ''
          : `
      left join lateral (
        select max(e.occurred_at) as last_seen_at, count(*)::bigint as event_count
        from event e
        where e.customer_id = m.id
      ) ev on true`
      }
      ${outerOrder}
    `,
  }
}

/**
 * The event feed on a customer page: the most recent fifty things that
 * happened to one account.
 *
 * This is the sharpest before-and-after in the repository. Unindexed it is a
 * sequential scan of a quarter of a million rows to find fifty; with
 * `event (customer_id, occurred_at desc)` it is an index scan that stops after
 * fifty. Same query, same rows, three orders of magnitude.
 */
export function customerEvents(customerId: string, limit: number): Query {
  const p = new Params()
  const id = p.add(customerId)
  const count = p.add(limit)

  return {
    name: 'customer-events',
    params: p.values,
    text: `
      select e.id, e.occurred_at, e.kind, e.metadata
      from event e
      where e.customer_id = ${id}::uuid
      order by e.occurred_at desc, e.id
      limit ${count}
    `,
  }
}
