import {Params, type Query} from './sql.ts'

/**
 * The values the filters can offer.
 *
 * Read from the data rather than hard-coded, for one reason worth stating: the
 * plan list has to include `legacy-pro`, which is retired and not sold and
 * still has customers on it. A filter built from the marketing price list
 * would offer four plans, and the several hundred customers on the fifth would
 * be unreachable through the interface — present in the totals, absent from
 * every filtered view, and impossible to explain to whoever noticed the
 * numbers not adding up.
 *
 * The same applies to countries: the filter offers the ten that exist in the
 * data, not the 249 in the ISO list.
 *
 * Statuses and channels are Postgres enums, so those genuinely are fixed and
 * live in `params.ts` as constants.
 */

export type PlanFacet = {slug: string; name: string; active: boolean; customers: number}
export type CountryFacet = {country: string; customers: number}

export function planFacets(): Query {
  return {
    name: 'facets-plans',
    params: [],
    text: `
      with current_subscription as (
        select distinct on (customer_id) customer_id, plan_id
        from subscription
        order by customer_id, started_at desc, id
      )
      select
        p.slug,
        p.name,
        p.active,
        count(cs.customer_id)::int as customers
      from plan p
      left join current_subscription cs on cs.plan_id = p.id
      group by p.id, p.slug, p.name, p.active, p.monthly_price_pence
      order by p.monthly_price_pence
    `,
  }
}

export function countryFacets(): Query {
  return {
    name: 'facets-countries',
    params: [],
    text: `
      select country, count(*)::int as customers
      from customer
      group by country
      order by count(*) desc, country
    `,
  }
}

/** The report's own bounds, so a date filter cannot offer a month with no data. */
export function reportBounds(): Query {
  const p = new Params()
  return {
    name: 'facets-bounds',
    params: p.values,
    text: `
      select
        min(day)::text as first_day,
        max(day)::text as last_day
      from daily_rollup
    `,
  }
}
