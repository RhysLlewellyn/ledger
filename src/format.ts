/**
 * Formatting, in one place, all of it in `en-GB` and all of it in UTC.
 *
 * The UTC part is not fussiness. The report has a fixed as-at date and its
 * days are calendar days; rendering a timestamp in the reader's timezone would
 * move a churn that happened at 23:30 on the 31st into the following month for
 * anybody east of here, and the number on the page would stop agreeing with
 * the number in the database. Every date on every screen is formatted from the
 * same instant in the same zone.
 *
 * Money arrives as integer pence in a string, because Postgres hands back a
 * bigint as a string and parsing it early is how a total becomes a float.
 */

const MONEY = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
})

const MONEY_EXACT = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const COUNT = new Intl.NumberFormat('en-GB')

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const DAY_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
})

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** Whole pounds. Pence on a dashboard is noise nobody reads. */
export function money(pence: string | number): string {
  return MONEY.format(Number(pence) / 100)
}

/** Pounds and pence, for a single figure on a detail page. */
export function moneyExact(pence: string | number): string {
  return MONEY_EXACT.format(Number(pence) / 100)
}

/** Signed, so a movement reads as a movement rather than as a balance. */
export function movement(pence: string | number): string {
  const n = Number(pence)
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${MONEY.format(Math.abs(n) / 100)}`
}

export function count(n: string | number): string {
  return COUNT.format(Number(n))
}

/**
 * A signed change in a count of things, as opposed to a change in money.
 *
 * These two were briefly the same function, which put a customer count through
 * a currency formatter: a rise of 77 accounts divided itself by a hundred and
 * rendered as "+1". Money and counts are different types wearing the same
 * clothes, and the only reliable defence is not to share the formatter.
 */
export function countDelta(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${COUNT.format(Math.abs(n))}`
}

export function percent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

export function day(value: Date | string): string {
  return DAY.format(asDate(value))
}

export function dayTime(value: Date | string): string {
  return DAY_TIME.format(asDate(value))
}

/** `2025-03` or a date, rendered as `Mar 2025`. */
export function month(value: Date | string): string {
  return MONTH.format(/^\d{4}-\d{2}$/.test(String(value)) ? asDate(`${value}-01`) : asDate(value))
}

/** `YYYY-MM-DD`, for a `datetime` attribute or a form input. */
export function isoDay(value: Date | string): string {
  return asDate(value).toISOString().slice(0, 10)
}

/**
 * A calendar day arrives as `YYYY-MM-DD` and has to be read as UTC midnight.
 * `new Date('2026-07-31')` already does that; `new Date('2026-07-31 00:00')`
 * does not, and the difference is a day either side of midnight.
 */
function asDate(value: Date | string): Date {
  if (value instanceof Date) return value
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value)
}

/** Turns `paid_search` into `Paid search`, once, rather than in six templates. */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const COUNTRY_NAMES = new Intl.DisplayNames(['en-GB'], {type: 'region'})

/** `GB` is what the column stores; "United Kingdom" is what a reader wants. */
export function country(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code
  } catch {
    return code
  }
}
