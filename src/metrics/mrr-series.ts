import {Params, type Query} from './sql.ts'

/**
 * The MRR series: one point per day across the report window, with the five
 * movement kinds broken out.
 *
 * Two implementations, and the difference between them is §4 of the README.
 *
 * `fromMovements` is the honest computation. MRR on a day is the sum of every
 * movement ever recorded up to that day, so the query opens with the balance
 * carried into the window and runs a window function forward from there. It is
 * correct by construction and it can never disagree with the spine, because it
 * *is* the spine.
 *
 * `fromRollup` reads the same numbers out of `daily_rollup`, which is
 * maintained on write. It is the one the overview page uses.
 *
 * Both are kept, and a test asserts they return identical rows. A cache whose
 * agreement with its source is never checked is a cache that will eventually
 * be wrong in a way nobody notices until a customer does.
 *
 * The series carries an active-customer count per day as well as the money,
 * because that is what the overview shows, and it is the reason the rollup
 * exists at all. The revenue half is cheap either way -- nine thousand
 * movements is nothing, and the window function does it in single-digit
 * milliseconds. The count is not: a customer is active on a day if any of
 * their subscriptions spans it, so computing it honestly means checking every
 * subscription against every day in the window and counting distinct
 * customers. That is where the rollup earns its place, and §4 of the README
 * puts the number on it.
 */

export type MrrPoint = {
  day: string
  active_customers: number
  mrr_pence: string
  new_pence: string
  expansion_pence: string
  contraction_pence: string
  churn_pence: string
  reactivation_pence: string
}

export function mrrSeriesFromMovements(from: string, to: string): Query {
  const p = new Params()
  const start = p.add(from)
  const end = p.add(to)

  return {
    name: 'mrr-series (from movements)',
    params: p.values,
    text: `
      with opening as (
        -- Everything that happened before the window opens, as one number.
        -- Without it the series starts at zero and the chart describes a
        -- company that was founded on the first day of the report.
        select coalesce(sum(amount_pence), 0)::bigint as pence
        from mrr_movement
        where occurred_on < ${start}::date
      ),
      days as (
        select generate_series(${start}::date, ${end}::date, interval '1 day')::date as day
      ),
      active as (
        -- Every subscription checked against every day. This is the expensive
        -- half of the overview, and the reason the daily_rollup table is not
        -- decoration.
        select d.day, count(distinct s.customer_id)::int as active_customers
        from days d
        left join subscription s
          on (s.started_at at time zone 'UTC')::date <= d.day
         and (s.ended_at is null or (s.ended_at at time zone 'UTC')::date > d.day)
        group by d.day
      ),
      daily as (
        select
          occurred_on as day,
          sum(amount_pence)::bigint as net,
          coalesce(sum(amount_pence) filter (where kind = 'new'), 0)::bigint as new_pence,
          coalesce(sum(amount_pence) filter (where kind = 'expansion'), 0)::bigint as expansion_pence,
          coalesce(sum(amount_pence) filter (where kind = 'contraction'), 0)::bigint as contraction_pence,
          coalesce(sum(amount_pence) filter (where kind = 'churn'), 0)::bigint as churn_pence,
          coalesce(sum(amount_pence) filter (where kind = 'reactivation'), 0)::bigint as reactivation_pence
        from mrr_movement
        where occurred_on between ${start}::date and ${end}::date
        group by occurred_on
      )
      select
        -- Text, not a date. A calendar day in a report is a label; handing it
        -- back as an instant invites something downstream to render it in the
        -- reader's timezone and move it.
        d.day::text as day,
        a.active_customers,
        (o.pence + coalesce(sum(x.net) over (order by d.day), 0))::bigint as mrr_pence,
        coalesce(x.new_pence, 0)::bigint as new_pence,
        coalesce(x.expansion_pence, 0)::bigint as expansion_pence,
        coalesce(x.contraction_pence, 0)::bigint as contraction_pence,
        coalesce(x.churn_pence, 0)::bigint as churn_pence,
        coalesce(x.reactivation_pence, 0)::bigint as reactivation_pence
      from days d
      cross join opening o
      join active a on a.day = d.day
      left join daily x on x.day = d.day
      order by d.day
    `,
  }
}

export function mrrSeriesFromRollup(from: string, to: string): Query {
  const p = new Params()
  const start = p.add(from)
  const end = p.add(to)

  return {
    name: 'mrr-series (from rollup)',
    params: p.values,
    text: `
      select
        r.day::text as day,
        r.active_customers,
        r.mrr_pence::bigint as mrr_pence,
        coalesce(m.new_pence, 0)::bigint as new_pence,
        coalesce(m.expansion_pence, 0)::bigint as expansion_pence,
        coalesce(m.contraction_pence, 0)::bigint as contraction_pence,
        coalesce(m.churn_pence, 0)::bigint as churn_pence,
        coalesce(m.reactivation_pence, 0)::bigint as reactivation_pence
      from daily_rollup r
      left join (
        select
          occurred_on as day,
          coalesce(sum(amount_pence) filter (where kind = 'new'), 0)::bigint as new_pence,
          coalesce(sum(amount_pence) filter (where kind = 'expansion'), 0)::bigint as expansion_pence,
          coalesce(sum(amount_pence) filter (where kind = 'contraction'), 0)::bigint as contraction_pence,
          coalesce(sum(amount_pence) filter (where kind = 'churn'), 0)::bigint as churn_pence,
          coalesce(sum(amount_pence) filter (where kind = 'reactivation'), 0)::bigint as reactivation_pence
        from mrr_movement
        where occurred_on between ${start}::date and ${end}::date
        group by occurred_on
      ) m on m.day = r.day
      where r.day between ${start}::date and ${end}::date
      order by r.day
    `,
  }
}

/**
 * What a naive dashboard does, kept as a measurement baseline and never
 * called by anything that renders.
 *
 * For each of 730 days it re-sums every movement up to that day. It is
 * correct, it is the shape you get from writing the obvious subquery, and it
 * is quadratic in the life of the business. It exists here so the README can
 * put a number on that rather than assert it.
 */
export function mrrSeriesCorrelated(from: string, to: string): Query {
  const p = new Params()
  const start = p.add(from)
  const end = p.add(to)

  return {
    name: 'mrr-series (correlated subquery)',
    params: p.values,
    text: `
      select
        d.day,
        (
          select coalesce(sum(m.amount_pence), 0)::bigint
          from mrr_movement m
          where m.occurred_on <= d.day
        ) as mrr_pence
      from generate_series(${start}::date, ${end}::date, interval '1 day') as d(day)
      order by d.day
    `,
  }
}
