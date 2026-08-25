import {country as countryName, day, humanise, money} from '@/format.ts'
import type {CustomerQueryOptions} from '@/metrics/customers.ts'
import type {PlanFacet} from '@/metrics/facets.ts'
import {customerHref} from '@/metrics/params.ts'

/**
 * What is currently narrowing the table, written out, with a way to take each
 * one off.
 *
 * The panel below could already tell you this, in the sense that the answer was
 * sitting in twenty-three checkboxes if you scrolled back through them. That is
 * recall rather than recognition, and on a phone it was the better part of two
 * screens away from the count it explains.
 *
 * It also left the page able to contradict itself. The count is computed from
 * the query string; the checkboxes show whatever has been ticked since. Tick
 * three boxes without submitting and "4,000 customers match — no filters
 * applied" sits on screen above three visibly ticked boxes, with nothing to say
 * which of the two is true. These chips are built from `options`, which is the
 * parsed URL and the same object the count came from, so the count and the list
 * of filters cannot disagree by construction.
 *
 * Each one is a link rather than a button, because removing a filter is another
 * view of the same read-only data and every other piece of state on this page is
 * already a URL. It costs no JavaScript, it opens in a new tab on a middle
 * click, and `customerHref` resets the page number for us — dropping a filter
 * widens the result set, and page nine of the narrower one is not where anybody
 * wants to land.
 */
export function AppliedFilters({
  options,
  plans,
}: {
  options: CustomerQueryOptions
  // Country labels come from `country()`, which owns the code-to-name map, so
  // the facet list the panel needs is not needed here.
  plans: readonly PlanFacet[]
}) {
  const planName = new Map(plans.map((p) => [p.slug, p.active ? p.name : `${p.name} · retired`]))

  /*
    One entry per applied clause: what it says, and the same view without it.

    Every href is built from the full options, so taking off one plan leaves the
    other plans, and every other dimension, exactly as they were.
  */
  const chips: {label: string; value: string; href: string}[] = []

  if (options.query) {
    chips.push({
      label: 'Name contains',
      value: options.query,
      href: customerHref(options, {query: undefined}),
    })
  }

  for (const slug of options.plans ?? []) {
    chips.push({
      label: 'Plan',
      value: planName.get(slug) ?? humanise(slug),
      href: customerHref(options, {plans: options.plans!.filter((p) => p !== slug)}),
    })
  }

  for (const status of options.statuses ?? []) {
    chips.push({
      label: 'Status',
      value: humanise(status),
      href: customerHref(options, {statuses: options.statuses!.filter((s) => s !== status)}),
    })
  }

  for (const channel of options.channels ?? []) {
    chips.push({
      label: 'Channel',
      value: humanise(channel),
      href: customerHref(options, {channels: options.channels!.filter((c) => c !== channel)}),
    })
  }

  for (const code of options.countries ?? []) {
    chips.push({
      label: 'Country',
      value: countryName(code),
      href: customerHref(options, {countries: options.countries!.filter((c) => c !== code)}),
    })
  }

  if (options.signedUpFrom) {
    chips.push({
      label: 'Signed up on or after',
      value: day(options.signedUpFrom),
      href: customerHref(options, {signedUpFrom: undefined}),
    })
  }

  if (options.signedUpTo) {
    chips.push({
      label: 'Signed up on or before',
      value: day(options.signedUpTo),
      href: customerHref(options, {signedUpTo: undefined}),
    })
  }

  if (options.mrrMinPence != null) {
    chips.push({
      label: 'Monthly revenue at least',
      value: money(options.mrrMinPence),
      href: customerHref(options, {mrrMinPence: undefined}),
    })
  }

  if (options.mrrMaxPence != null) {
    chips.push({
      label: 'Monthly revenue at most',
      value: money(options.mrrMaxPence),
      href: customerHref(options, {mrrMaxPence: undefined}),
    })
  }

  if (chips.length === 0) return null

  return (
    <ul aria-label="Filters applied" className="mt-3 flex flex-wrap gap-2 text-sm">
      {chips.map((chip) => (
        <li key={chip.label + chip.value}>
          {/*
            A hairline box, not a pill. A rounded chip with a tinted fill is the
            category's shape for this and would be the first rounded corner in
            the build; a rule around a label is what a paper form does, and it is
            already the vocabulary the inputs below use.

            The cross is a character at the weight of the text rather than an
            icon, because the whole mark is one link and a second visual system
            inside it would only be noise.

            The accessible name has to say what the link does rather than what it
            is. Left to the visible text it announces as "Plan Enterprise", which
            reads as a link *to* the Enterprise plan. The label makes it "Remove
            filter, Plan Enterprise" — the action, then its object — and still
            contains the visible text word for word, which is what 2.5.3 asks of
            a label that replaces one.
          */}
          <a
            href={chip.href}
            aria-label={`Remove filter, ${chip.label} ${chip.value}`}
            className="inline-flex min-h-6 items-baseline gap-2 border border-(--color-field) px-2 py-0.5 hover:bg-(--color-paper-2)"
          >
            <span className="text-(--color-ink-2)">
              {chip.label} <span data-numeric>{chip.value}</span>
            </span>
            <span aria-hidden="true" className="text-(--color-muted)">
              ×
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
