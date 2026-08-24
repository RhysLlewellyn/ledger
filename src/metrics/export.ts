import type {CustomerQueryOptions} from './customers.ts'
import {Params, type Query} from './sql.ts'

/**
 * The current filtered view, every row of it, for CSV.
 *
 * Two differences from the table query, and both follow from "every row"
 * rather than "fifty of them".
 *
 * There is no limit and no offset. An export that gave you the page you were
 * looking at would be a worse version of copying the screen; the point of it
 * is the other 3,950 rows.
 *
 * The last-seen decoration is a grouped aggregate rather than a lateral join.
 * On the table, the lateral runs fifty times against an index and is the right
 * shape. Here it would run four thousand times, and one hash aggregate over
 * the whole event table beats four thousand index probes — the crossover
 * between those two plans is exactly what having a `limit` decides.
 */
export function customerExport(options: CustomerQueryOptions): Query {
  const p = new Params()
  const where: string[] = []

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

  const ORDER: Record<string, string> = {
    name: 'c.name',
    mrr: 'mrr_pence',
    signed_up: 'c.signed_up_at',
    seats: 'cs.seats',
    plan: 'p.monthly_price_pence',
    country: 'c.country',
    status: 'cs.status',
    channel: 'c.acquisition_channel',
    last_seen: 'ev.last_seen_at',
  }
  const dir = options.direction === 'desc' ? 'desc' : 'asc'

  return {
    name: 'customer-export',
    params: p.values,
    text: `
      with customer_mrr as (
        select customer_id, sum(amount_pence)::bigint as mrr_pence
        from mrr_movement
        group by customer_id
      ),
      current_subscription as (
        select distinct on (customer_id)
          customer_id, plan_id, seats, status
        from subscription
        order by customer_id, started_at desc, id
      ),
      activity as (
        select customer_id, max(occurred_at) as last_seen_at, count(*)::bigint as event_count
        from event
        group by customer_id
      )
      select
        c.name,
        c.slug,
        p.name as plan_name,
        cs.status,
        c.country,
        c.acquisition_channel,
        cs.seats,
        coalesce(cm.mrr_pence, 0) as mrr_pence,
        (c.signed_up_at at time zone 'UTC')::date::text as signed_up_on,
        (c.churned_at at time zone 'UTC')::date::text as churned_on,
        to_char(ev.last_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_seen_at,
        coalesce(ev.event_count, 0) as event_count
      from customer c
      join current_subscription cs on cs.customer_id = c.id
      join plan p on p.id = cs.plan_id
      left join customer_mrr cm on cm.customer_id = c.id
      left join activity ev on ev.customer_id = c.id
      ${where.length ? `where ${where.join('\n        and ')}` : ''}
      order by ${ORDER[options.sort] ?? 'mrr_pence'} ${dir} nulls last, c.id asc
    `,
  }
}

export const EXPORT_COLUMNS = [
  'name',
  'slug',
  'plan_name',
  'status',
  'country',
  'acquisition_channel',
  'seats',
  'mrr_pence',
  'signed_up_on',
  'churned_on',
  'last_seen_at',
  'event_count',
] as const

/**
 * One CSV field, quoted per RFC 4180 and defused for spreadsheets.
 *
 * The quoting half is ordinary: wrap anything containing a comma, a quote or a
 * newline, and double the quotes inside it.
 *
 * The other half is the one worth knowing about. A cell whose text begins
 * `=`, `+`, `-` or `@` is treated by Excel, Sheets and LibreOffice as a
 * formula, so a customer called `=HYPERLINK(...)` becomes executable content
 * in whoever opens the file. These names are generated and none of them start
 * with those characters, which is exactly why it would be easy to leave out
 * and exactly why it should not be: the day this points at real customer names
 * is the day it matters, and by then nobody is looking at the CSV writer.
 * A leading apostrophe makes the cell text again and is invisible in the
 * rendered sheet.
 */
export function csvField(value: unknown): string {
  if (value == null) return ''
  const raw = String(value)
  const defused = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvField).join(',')}\r\n`
}
