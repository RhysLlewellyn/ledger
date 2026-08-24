import type {CustomerQueryOptions, Direction, SortColumn} from './customers.ts'

/**
 * The URL is the state.
 *
 * Every filter, every sort and every page lives in the address bar, and this
 * file is the only thing that translates between the two. That is the single
 * clearest line between a real dashboard and a demo one: a filtered view can
 * be pasted into Slack and it opens as the same view, the back button moves
 * through the filters somebody actually applied, and a page can be
 * server-rendered because everything it needs to know arrived with the
 * request.
 *
 * Three rules hold throughout.
 *
 * **Nothing here throws.** These values come from a URL, which means they come
 * from anybody. An unrecognised sort column is not a 500 and not a redirect;
 * it is the default sort. The worst a hand-typed URL can do is show the first
 * page of an unfiltered table.
 *
 * **Defaults are absent, not spelled out.** `/customers` and
 * `/customers?page=1&sort=mrr&dir=desc` are the same view, and only the first
 * is worth putting in front of somebody. Serialising defaults would also make
 * every link on the page longer than the content it points at.
 *
 * **Changing a filter returns to page one.** Landing on page twelve of three
 * results is the oldest bug in faceted search, and the fix belongs here rather
 * than in each component that builds a link.
 */

export const SORT_COLUMNS: readonly SortColumn[] = [
  'name',
  'mrr',
  'signed_up',
  'seats',
  'plan',
  'country',
  'status',
  'channel',
  'last_seen',
]

export const STATUSES = ['active', 'cancelled', 'paused'] as const

export const CHANNELS = [
  'organic',
  'paid_search',
  'referral',
  'outbound',
  'partner',
] as const

export const DEFAULTS = {
  sort: 'mrr' as SortColumn,
  direction: 'desc' as Direction,
  page: 1,
  perPage: 50,
}

/** What Next hands a server component: a value can be absent, single or repeated. */
export type RawParams = Record<string, string | string[] | undefined>

export function parseCustomerParams(raw: RawParams): CustomerQueryOptions {
  const sort = one(raw.sort)
  const direction = one(raw.dir)

  return {
    sort: SORT_COLUMNS.includes(sort as SortColumn) ? (sort as SortColumn) : DEFAULTS.sort,
    direction: direction === 'asc' || direction === 'desc' ? direction : DEFAULTS.direction,
    page: positiveInt(one(raw.page)) ?? DEFAULTS.page,
    perPage: DEFAULTS.perPage,
    plans: many(raw.plan),
    statuses: many(raw.status).filter((s) => (STATUSES as readonly string[]).includes(s)),
    countries: many(raw.country).filter((c) => /^[A-Z]{2}$/.test(c)),
    channels: many(raw.channel).filter((c) => (CHANNELS as readonly string[]).includes(c)),
    signedUpFrom: isoDay(one(raw.from)),
    signedUpTo: isoDay(one(raw.to)),
    mrrMinPence: pounds(one(raw.mrrMin)),
    mrrMaxPence: pounds(one(raw.mrrMax)),
  }
}

/**
 * The options back into a query string, with defaults left out.
 *
 * `patch` is what every link on the page is built from: a sort header passes
 * `{sort, direction}`, the pager passes `{page}`, and a filter chip passes the
 * filter it is removing. Because a patch that touches anything other than the
 * page resets the page, none of those callers has to remember to.
 */
export function customerHref(
  options: CustomerQueryOptions,
  patch: Partial<CustomerQueryOptions> = {},
): string {
  const next: CustomerQueryOptions = {...options, ...patch}
  const changedFilterOrSort = Object.keys(patch).some((key) => key !== 'page')
  if (changedFilterOrSort) next.page = 1

  const q = new URLSearchParams()
  if (next.sort !== DEFAULTS.sort) q.set('sort', next.sort)
  if (next.direction !== DEFAULTS.direction) q.set('dir', next.direction)
  if (next.page !== DEFAULTS.page) q.set('page', String(next.page))
  for (const plan of next.plans ?? []) q.append('plan', plan)
  for (const status of next.statuses ?? []) q.append('status', status)
  for (const country of next.countries ?? []) q.append('country', country)
  for (const channel of next.channels ?? []) q.append('channel', channel)
  if (next.signedUpFrom) q.set('from', next.signedUpFrom)
  if (next.signedUpTo) q.set('to', next.signedUpTo)
  if (next.mrrMinPence != null) q.set('mrrMin', String(next.mrrMinPence / 100))
  if (next.mrrMaxPence != null) q.set('mrrMax', String(next.mrrMaxPence / 100))

  const query = q.toString()
  return query ? `?${query}` : ''
}

/** Whether anything is narrowing the table — the empty state needs to know. */
export function activeFilterCount(options: CustomerQueryOptions): number {
  return (
    (options.plans?.length ?? 0) +
    (options.statuses?.length ?? 0) +
    (options.countries?.length ?? 0) +
    (options.channels?.length ?? 0) +
    (options.signedUpFrom ? 1 : 0) +
    (options.signedUpTo ? 1 : 0) +
    (options.mrrMinPence != null ? 1 : 0) +
    (options.mrrMaxPence != null ? 1 : 0)
  )
}

/* ----------------------------------------------------------------- parsing */

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value == null) return []
  // A repeated parameter arrives as an array and a single one as a string,
  // and a checkbox group produces both depending on how many are ticked.
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter((v) => v.length > 0 && v.length <= 40))]
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : undefined
}

/** Only a real calendar day, and only in the one format the inputs produce. */
function isoDay(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : value
}

/**
 * Pounds in the URL, pence in the query.
 *
 * The database stores integer pence and the filter is typed in pounds, so the
 * conversion has to live somewhere. It lives here, once, rather than in the
 * form and again in the query — a factor of a hundred applied in one of two
 * places is a bug that looks like a working filter.
 */
function pounds(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return undefined
  // Clamped rather than discarded. An absurd bound is still a bound somebody
  // typed, and dropping it silently shows *more* rows than they asked for
  // while the URL still says the filter is on -- the count says "one filter"
  // and the address bar says two. Clamping keeps the promise: ask for a
  // minimum of ten million pounds and you get the empty state, which is the
  // true answer.
  return Math.round(Math.min(n, 10_000_000) * 100)
}
