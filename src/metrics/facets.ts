import {customerWhere, type CustomerFilters} from './customers.ts'
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

export type FacetCount = {dim: 'plan' | 'status' | 'channel' | 'country'; key: string; customers: number}

/**
 * How many customers each filter option would match, given everything else
 * that is currently applied.
 *
 * The counts used to be unconditional, and they went stale the instant a
 * filter was applied: the result line would say "117 customers match all 3
 * filters applied" while the panel two inches below still offered Enterprise
 * 372 and United Kingdom 1,500. Those numbers described a view that was not on
 * screen, and a reader reasonably read them as "372 more Enterprise accounts
 * are available here". On a build that polices exactly this class of
 * dishonesty elsewhere, it was the one place the interface asserted something
 * untrue.
 *
 * Each dimension is counted against the predicate **minus its own filter**,
 * which is the standard faceted-search rule and the only one that stays
 * useful. Counting against the whole predicate instead would show every plan
 * except the ticked one as zero, which is true and answers a question nobody
 * asked; excluding a dimension from its own count answers the question the
 * reader actually has, which is "what would happen if I ticked this too".
 *
 * One round trip. Four scans of four thousand rows, in a single statement,
 * because four separate queries would be four network hops to save nothing.
 */
export function facetCounts(options: CustomerFilters): Query {
  const p = new Params()

  const FROM = `
    from customer c
    left join current_subscription cs on cs.customer_id = c.id
    left join plan p on p.id = cs.plan_id
    left join customer_mrr cm on cm.customer_id = c.id`

  /*
    The aliases above are not free choices. `customerWhere` writes clauses
    naming `c`, `p`, `cs` and `cm`, so any query using it has to join those
    tables under exactly those names.

    This was written with `plan pl` first, and every filter worked except one:
    the plan branch keeps the other dimensions' clauses, so `p.slug` only
    appears when a plan is ticked. The query was fine until somebody filtered
    by plan, and then the page rendered "the database is not answering",
    because the fallback added earlier catches everything a query can throw.
    A catch-all that turns a bug into a polite message is worth having and
    worth being suspicious of.
  */
  const branch = (dim: string, key: string, without: Partial<CustomerFilters>) => {
    const clauses = customerWhere({...options, ...without}, p)
    const where = clauses.length ? `where ${clauses.join(' and ')}` : ''
    return `select '${dim}' as dim, ${key} as key, count(*)::int as customers
            ${FROM} ${where} group by ${key}`
  }

  return {
    name: 'facet-counts',
    params: p.values,
    text: `
      with customer_mrr as (
        select customer_id, sum(amount_pence)::bigint as mrr_pence
        from mrr_movement
        group by customer_id
      ),
      current_subscription as (
        select distinct on (customer_id) customer_id, plan_id, seats, status
        from subscription
        order by customer_id, started_at desc, id
      )
      ${branch('plan', 'p.slug', {plans: undefined})}
      union all
      ${branch('status', 'cs.status::text', {statuses: undefined})}
      union all
      ${branch('channel', 'c.acquisition_channel::text', {channels: undefined})}
      union all
      ${branch('country', 'c.country', {countries: undefined})}
    `,
  }
}
