import {Params, type Query} from './sql.ts'

/**
 * One customer, from four angles: who they are, what they have paid for, what
 * changed their revenue, and what they have been doing.
 *
 * Four queries rather than one join. A customer with three subscriptions,
 * eleven movements and three hundred events joined into a single result set is
 * ninety-nine rows of duplicated customer columns that the application then
 * has to un-multiply. Four round trips against indexed columns are cheaper
 * than that in every sense that matters, and they can be issued together.
 */

export type CustomerDetail = {
  id: string
  name: string
  slug: string
  country: string
  acquisition_channel: string
  signed_up_at: Date
  churned_at: Date | null
  mrr_pence: string
  event_count: string
  last_seen_at: Date | null
  lifetime_pence: string
}

export function customerBySlug(slug: string): Query {
  const p = new Params()
  const value = p.add(slug)

  return {
    name: 'customer-detail',
    params: p.values,
    text: `
      select
        c.id,
        c.name,
        c.slug,
        c.country,
        c.acquisition_channel,
        c.signed_up_at,
        c.churned_at,
        coalesce(m.mrr_pence, 0)::bigint as mrr_pence,
        coalesce(m.lifetime_pence, 0)::bigint as lifetime_pence,
        coalesce(e.event_count, 0)::bigint as event_count,
        e.last_seen_at
      from customer c
      left join lateral (
        select
          sum(amount_pence) as mrr_pence,
          -- Every positive movement they ever made, which is the closest this
          -- schema gets to a lifetime value without inventing a billing run.
          sum(amount_pence) filter (where amount_pence > 0) as lifetime_pence
        from mrr_movement mm
        where mm.customer_id = c.id
      ) m on true
      left join lateral (
        select count(*) as event_count, max(occurred_at) as last_seen_at
        from event ev
        where ev.customer_id = c.id
      ) e on true
      where c.slug = ${value}
    `,
  }
}

export type SubscriptionRow = {
  id: string
  plan_name: string
  plan_slug: string
  monthly_price_pence: number
  seats: number
  status: string
  started_at: Date
  ended_at: Date | null
  mrr_pence: string
}

export function customerSubscriptions(customerId: string): Query {
  const p = new Params()
  const id = p.add(customerId)

  return {
    name: 'customer-subscriptions',
    params: p.values,
    text: `
      select
        s.id,
        p.name as plan_name,
        p.slug as plan_slug,
        p.monthly_price_pence,
        s.seats,
        s.status,
        s.started_at,
        s.ended_at,
        (p.monthly_price_pence * s.seats)::bigint as mrr_pence
      from subscription s
      join plan p on p.id = s.plan_id
      where s.customer_id = ${id}::uuid
      order by s.started_at desc, s.id
    `,
  }
}

export type MovementRow = {
  id: string
  occurred_on: string
  kind: string
  amount_pence: number
  running_pence: string
}

export function customerMovements(customerId: string): Query {
  const p = new Params()
  const id = p.add(customerId)

  return {
    name: 'customer-movements',
    params: p.values,
    text: `
      select
        m.id,
        m.occurred_on::text as occurred_on,
        m.kind,
        m.amount_pence,
        -- The balance after each movement, so the column reconciles to the
        -- headline MRR by inspection rather than by trust.
        sum(m.amount_pence) over (
          order by m.occurred_on, m.id
          rows between unbounded preceding and current row
        )::bigint as running_pence
      from mrr_movement m
      where m.customer_id = ${id}::uuid
      order by m.occurred_on desc, m.id desc
    `,
  }
}

export type EventRow = {
  id: string
  occurred_at: Date
  kind: string
  metadata: Record<string, unknown>
}

/** The feed. `event (customer_id, occurred_at desc)` is what makes it fast. */
export function customerEventFeed(customerId: string, limit: number): Query {
  const p = new Params()
  const id = p.add(customerId)
  const count = p.add(limit)

  return {
    name: 'customer-event-feed',
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
