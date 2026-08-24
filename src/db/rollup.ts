import type {Sql} from 'postgres'

/**
 * Rebuilds `daily_rollup` from the spine, in one statement.
 *
 * The rollup is a cache and is treated as one: it is never the source of any
 * number, it can be dropped at any time, and this function puts it back. The
 * seed calls it; so does the test that proves the incrementally-maintained
 * table and the full rebuild agree, which is the only way a cache like this
 * stays trustworthy.
 *
 * Everything is cast through `at time zone 'UTC'` rather than relying on the
 * session's TimeZone. A subscription that started at 23:30 UTC belongs to that
 * day and not to the next one, and which day the server thinks it is should
 * not depend on how the connection was opened.
 */
export async function refreshRollup(sql: Sql): Promise<number> {
  await sql`truncate table daily_rollup`

  const inserted = await sql`
    insert into daily_rollup (day, mrr_pence, active_customers, new_count, churn_count)
    with bounds as (
      select
        coalesce(min(occurred_on), current_date) as first_day,
        coalesce(max(occurred_on), current_date) as last_day
      from mrr_movement
    ),
    days as (
      select generate_series(first_day, last_day, interval '1 day')::date as day
      from bounds
    ),
    movement as (
      select
        occurred_on as day,
        sum(amount_pence) as net,
        count(*) filter (where kind = 'new') as new_count,
        count(*) filter (where kind = 'churn') as churn_count
      from mrr_movement
      group by occurred_on
    ),
    active as (
      select d.day, count(distinct s.customer_id) as active_customers
      from days d
      left join subscription s
        on (s.started_at at time zone 'UTC')::date <= d.day
       and (s.ended_at is null or (s.ended_at at time zone 'UTC')::date > d.day)
      group by d.day
    )
    select
      d.day,
      coalesce(sum(m.net) over (order by d.day), 0)::int as mrr_pence,
      a.active_customers::int,
      coalesce(m.new_count, 0)::int,
      coalesce(m.churn_count, 0)::int
    from days d
    left join movement m on m.day = d.day
    join active a on a.day = d.day
    order by d.day
  `

  return inserted.count ?? 0
}
