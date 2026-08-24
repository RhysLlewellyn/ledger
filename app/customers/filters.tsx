import {count, country as countryName, humanise, isoDay} from '@/format.ts'
import type {CustomerQueryOptions} from '@/metrics/customers.ts'
import type {CountryFacet, PlanFacet} from '@/metrics/facets.ts'
import {activeFilterCount, CHANNELS, customerHref, STATUSES} from '@/metrics/params.ts'

/**
 * The filter panel.
 *
 * A plain `<form method="get">`, which is the whole design. Submitting it
 * builds exactly the query string `parseCustomerParams` reads, so the URL a
 * filtered view produces is identical whether it came from this form, from a
 * pasted link, or from the back button. There is no client-side state to get
 * out of step with the address bar, and the panel works with JavaScript
 * switched off.
 *
 * Checkbox groups share a name, so ticking two plans sends `plan=team` and
 * `plan=business` — the repeated-parameter shape the parser already handles.
 *
 * The current sort rides along in hidden fields. Without them, applying a
 * filter would silently throw away the sort the reader had chosen, which is
 * the kind of small betrayal that makes a dashboard feel untrustworthy. The
 * page is deliberately *not* carried: a new filter means a new result set, and
 * page twelve of it is not where anybody wants to land.
 */
export function Filters({
  options,
  plans,
  countries,
  bounds,
}: {
  options: CustomerQueryOptions
  plans: readonly PlanFacet[]
  countries: readonly CountryFacet[]
  bounds: {first_day: string; last_day: string}
}) {
  const applied = activeFilterCount(options)

  return (
    <form
      method="get"
      action="/customers"
      className="border-t border-(--color-rule-2) pt-4 text-sm"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base">Filters</h2>
        {applied > 0 && (
          <a
            href="/customers"
            className="inline-block py-1 underline underline-offset-4"
          >
            Clear {applied === 1 ? 'the filter' : `all ${applied} filters`}
          </a>
        )}
      </div>

      <input type="hidden" name="sort" value={options.sort} />
      <input type="hidden" name="dir" value={options.direction} />

      {/*
        Multi-column rather than a grid. Six fieldsets of wildly different
        heights -- three statuses against ten countries -- laid out on a grid
        size every row to the tallest cell in it, which left a screen and a
        half of empty paper between the short filters and the ones that had
        been pushed below them. Columns pack by content instead, and
        break-inside keeps a fieldset whole.
      */}
      <div className="mt-4 gap-8 sm:columns-2 lg:columns-3 xl:columns-4 [&>*]:mb-8 [&>*]:break-inside-avoid">
        <CheckboxGroup
          legend="Plan"
          name="plan"
          selected={options.plans ?? []}
          items={plans.map((p) => ({
            value: p.slug,
            // The retired plan is labelled rather than hidden. Several hundred
            // customers are still on it and a filter that cannot reach them
            // would leave them in the totals and nowhere else.
            label: p.active ? p.name : `${p.name} · retired`,
            hint: p.customers,
          }))}
        />

        <CheckboxGroup
          legend="Status"
          name="status"
          selected={options.statuses ?? []}
          items={STATUSES.map((s) => ({value: s, label: humanise(s)}))}
        />

        <CheckboxGroup
          legend="Channel"
          name="channel"
          selected={options.channels ?? []}
          items={CHANNELS.map((c) => ({value: c, label: humanise(c)}))}
        />

        <CheckboxGroup
          legend="Country"
          name="country"
          selected={options.countries ?? []}
          items={countries.map((c) => ({
            value: c.country,
            label: countryName(c.country),
            hint: c.customers,
          }))}
        />

        <fieldset className="min-w-0">
          <legend className="mb-2 text-(--color-ink-2)">Signed up between</legend>
          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="from">
              Signed up on or after
            </label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={options.signedUpFrom ?? ''}
              min={isoDay(bounds.first_day)}
              max={isoDay(bounds.last_day)}
              className="border border-(--color-field) bg-(--color-paper) px-2 py-1"
              data-numeric
            />
            <label className="sr-only" htmlFor="to">
              Signed up on or before
            </label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={options.signedUpTo ?? ''}
              min={isoDay(bounds.first_day)}
              max={isoDay(bounds.last_day)}
              className="border border-(--color-field) bg-(--color-paper) px-2 py-1"
              data-numeric
            />
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-(--color-ink-2)">Monthly revenue (£)</legend>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="mrrMin">
              Minimum monthly revenue in pounds
            </label>
            <input
              id="mrrMin"
              type="number"
              name="mrrMin"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="min"
              defaultValue={options.mrrMinPence != null ? options.mrrMinPence / 100 : ''}
              className="w-24 border border-(--color-field) bg-(--color-paper) px-2 py-1"
              data-numeric
            />
            <span aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="mrrMax">
              Maximum monthly revenue in pounds
            </label>
            <input
              id="mrrMax"
              type="number"
              name="mrrMax"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="max"
              defaultValue={options.mrrMaxPence != null ? options.mrrMaxPence / 100 : ''}
              className="w-24 border border-(--color-field) bg-(--color-paper) px-2 py-1"
              data-numeric
            />
          </div>
        </fieldset>
      </div>

      <button
        type="submit"
        className="mt-6 border border-(--color-ink) px-4 py-1.5 hover:bg-(--color-ink) hover:text-(--color-paper)"
      >
        Apply filters
      </button>
    </form>
  )
}

function CheckboxGroup({
  legend,
  name,
  items,
  selected,
}: {
  legend: string
  name: string
  items: readonly {value: string; label: string; hint?: number}[]
  selected: readonly string[]
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-(--color-ink-2)">{legend}</legend>
      <ul className="space-y-1">
        {items.map((item) => {
          const id = `${name}-${item.value}`
          return (
            <li key={item.value}>
              {/*
                The count is described, not named.

                It used to sit inside the <label>, which made it part of the
                checkbox's accessible name, and NVDA announced the row as
                "Starter1355" -- the plan and the number run together, and the
                number never says what it counts. Sighted readers get the
                separation from the layout; nobody else did.

                So the visible figure is hidden from the reader and a full
                sentence is attached with aria-describedby instead. A
                description is announced after the name and after the state,
                which is the right order for a number that qualifies a choice
                rather than identifying it.
              */}
              <label htmlFor={id} className="flex min-h-6 items-center gap-2">
                <input
                  id={id}
                  type="checkbox"
                  name={name}
                  value={item.value}
                  defaultChecked={selected.includes(item.value)}
                  aria-describedby={item.hint != null ? `${id}-count` : undefined}
                  className="size-4 shrink-0 accent-(--color-ink)"
                />
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.hint != null && (
                  <span aria-hidden="true" data-numeric className="text-xs text-(--color-muted)">
                    {count(item.hint)}
                  </span>
                )}
              </label>
              {item.hint != null && (
                <span id={`${id}-count`} className="sr-only">
                  {`${count(item.hint)} ${item.hint === 1 ? 'customer' : 'customers'}`}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

export {customerHref}
