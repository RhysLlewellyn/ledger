import {Params, type Query} from './sql.ts'

/**
 * Retention by signup month.
 *
 * A customer counts as retained in month *k* if they held a subscription that
 * was running at any point during the calendar month *k* months after the one
 * they signed up in. That definition is deliberately about the subscription
 * and not about `customer.churned_at`: somebody who cancelled and came back is
 * retained in the months they were paying and absent in the months they were
 * not, and a grid built from a single `churned_at` column cannot express that
 * — it would either lose the gap or lose the return.
 *
 * Month 0 is therefore always 100% by construction, which is the correct
 * behaviour and worth stating on the page rather than leaving a reader to
 * wonder whether the first column is real.
 *
 * It also means a cell can be *higher* than the one to its left. A customer
 * who cancelled in month three and came back in month six is absent from
 * months three to five and present in month six, so that cohort's curve ticks
 * up. This surprises people, and the temptation is to make the grid monotonic
 * by defining retention as "never left" instead. That would be a grid that
 * cannot see reactivation at all -- and reactivation is the one movement kind
 * a subscription business most wants to be able to find. The page says what a
 * cell means; the test in `queries.test.ts` asserts that every rise is
 * accounted for by a reactivation and not by a bug.
 *
 * The cross join is the cost here, not the row count: every cohort is expanded
 * against every offset before anything is filtered. That is what makes this
 * one of the three heavy queries even though `subscription` has fewer than
 * five thousand rows in it.
 */

export type CohortCell = {
  /** `YYYY-MM` — a label, not an instant. */
  cohort_month: string
  cohort_size: number
  month_offset: number
  retained: number
}

export function cohortRetention(
  fromMonth: string,
  toMonth: string,
  maxOffset: number,
  asAt: string,
): Query {
  const p = new Params()
  const from = p.add(fromMonth)
  const to = p.add(toMonth)
  const offsets = p.add(maxOffset)
  const asAtDay = p.add(asAt)

  return {
    name: 'cohort-retention',
    params: p.values,
    text: `
      with cohort as (
        select
          c.id as customer_id,
          date_trunc('month', c.signed_up_at at time zone 'UTC')::date as cohort_month
        from customer c
        where (c.signed_up_at at time zone 'UTC')::date >= ${from}::date
          and (c.signed_up_at at time zone 'UTC')::date <= ${to}::date
      ),
      sizes as (
        select cohort_month, count(*)::int as cohort_size
        from cohort
        group by cohort_month
      ),
      offsets as (
        select generate_series(0, ${offsets}::int) as month_offset
      ),
      cells as (
        -- Only the cells that can exist. A cohort from three months ago has no
        -- month-nine number, and rendering one as 0% is the single most common
        -- way a retention grid lies.
        select s.cohort_month, s.cohort_size, o.month_offset
        from sizes s
        cross join offsets o
        where (s.cohort_month + (o.month_offset || ' months')::interval)::date <= ${asAtDay}::date
      ),
      retained as (
        select
          x.cohort_month,
          x.month_offset,
          count(distinct co.customer_id)::int as retained
        from cells x
        join cohort co on co.cohort_month = x.cohort_month
        join subscription sub on sub.customer_id = co.customer_id
        where sub.started_at
                < ((x.cohort_month + ((x.month_offset + 1) || ' months')::interval) at time zone 'UTC')
          and (
            sub.ended_at is null
            or sub.ended_at >= ((x.cohort_month + (x.month_offset || ' months')::interval) at time zone 'UTC')
          )
        group by x.cohort_month, x.month_offset
      )
      select
        to_char(x.cohort_month, 'YYYY-MM') as cohort_month,
        x.cohort_size,
        x.month_offset,
        coalesce(r.retained, 0) as retained
      from cells x
      left join retained r
        on r.cohort_month = x.cohort_month
       and r.month_offset = x.month_offset
      order by x.cohort_month, x.month_offset
    `,
  }
}
