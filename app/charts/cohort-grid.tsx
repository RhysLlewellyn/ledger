import {Scroller} from '../scroller.tsx'

import {count, month as monthLabel, percent} from '@/format.ts'
import type {CohortCell} from '@/metrics/cohorts.ts'

/**
 * The customers table, filtered to one cohort's signup month.
 *
 * A cohort is `YYYY-MM`; the filter takes two days. The last of the month is
 * derived by asking for day zero of the next one, which is how JavaScript
 * spells "the day before the first" without a table of month lengths, and it
 * is done in UTC because these are calendar days rather than instants.
 */
function cohortHref(cohort: string): string {
  const [year, month] = cohort.split('-').map(Number)
  const last = new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10)
  return `/customers?from=${cohort}-01&to=${last}&sort=signed_up&dir=asc`
}

/**
 * Retention by signup month.
 *
 * This chart is a table, and that is the design rather than a compromise.
 * A cohort grid is rows, columns and one number per cell; expressing it as
 * `<table>` markup with a shaded background gets real row and column headers,
 * real navigation for a screen reader, find-in-page, and text selection, all
 * for free. Drawing the same thing in SVG and then providing a table
 * underneath would be building it twice and shipping the worse one first.
 *
 * **Every cell is double-encoded**: the percentage is printed *and* the
 * background is shaded. Shading alone is a lightness ramp, which survives
 * greyscale and colour blindness — but it cannot be read to a precision better
 * than "darker than that one", so the number carries the value and the shade
 * carries the shape.
 *
 * **The ramp is anchored to the values, not to 0–100%.** Month 0 is 100% by
 * construction and nothing observed falls below about 59%, so a ramp stretched
 * across the whole nominal range spent only its middle third and rendered as a
 * near-uniform slab. The comment above used to claim the shade carried the
 * shape while the render carried almost none of it. It is scaled to the
 * observed minimum and maximum now, and a key states both endpoints — without
 * that, a reader would reasonably assume the palest cell meant zero.
 *
 * **Contrast.** The ramp stops at 70% of full strength rather than 100%, and
 * text stays `--color-ink` throughout. At full strength `#1F5C8B` against
 * `--color-ink` is 2.5:1 and fails; the usual fix is to flip the text to white
 * above some threshold, but the band around 75–85% strength fails *both* ways
 * — 4.0:1 against ink and 4.47:1 against white — so there is no threshold that
 * works. Capping the ramp instead keeps every cell at 4.95:1 or better, which
 * is measured rather than assumed, and costs only the top of a range nobody
 * reads a value off anyway.
 */

const MAX_INTENSITY = 0.7
const BASE_INTENSITY = 0.08

export function CohortGrid({
  cells,
  maxOffset,
}: {
  cells: readonly CohortCell[]
  maxOffset: number
}) {
  const byCohort = new Map<string, Map<number, CohortCell>>()
  for (const cell of cells) {
    const row = byCohort.get(cell.cohort_month) ?? new Map<number, CohortCell>()
    row.set(cell.month_offset, cell)
    byCohort.set(cell.cohort_month, row)
  }

  const cohorts = [...byCohort.keys()].sort().reverse()
  const offsets = Array.from({length: maxOffset + 1}, (_, i) => i)

  /*
    The observed range, which is what the shading is scaled across.

    The guard matters: a dataset where every cohort retained the same share
    would make `hi - lo` zero and turn the ramp into a division by nothing.
    Below a range of five percentage points there is no shape worth showing
    either, so it falls back to the nominal scale and the grid goes flat
    honestly rather than manufacturing contrast out of rounding.
  */
  const rates = cells
    .filter((c) => c.cohort_size > 0)
    .map((c) => c.retained / c.cohort_size)
  const observedLo = rates.length > 0 ? Math.min(...rates) : 0
  const observedHi = rates.length > 0 ? Math.max(...rates) : 1
  const spread = observedHi - observedLo >= 0.05
  const lo = spread ? observedLo : 0
  const hi = spread ? observedHi : 1

  const shade = (retention: number) => {
    const t = hi === lo ? 1 : (retention - lo) / (hi - lo)
    const intensity = BASE_INTENSITY + Math.min(Math.max(t, 0), 1) * (MAX_INTENSITY - BASE_INTENSITY)
    return `color-mix(in srgb, var(--color-data-1) ${(intensity * 100).toFixed(0)}%, var(--color-paper))`
  }

  return (
    <div className="mt-6">
      {/*
        The explanation sits outside the scroller, not in a <caption> inside
        it. A caption is part of the table, so it inherited the table's
        `min-width` and the scroller's clipping: at 360px this paragraph was
        trapped in the data scroller and cut off mid-sentence at "…who signed
        up in one m", and the only way to finish reading it was to scroll a
        retention grid sideways. It is prose; it should wrap like prose.

        The table keeps a name of its own in a short sr-only caption, and
        `aria-describedby` on the region ties the two back together so nothing
        is lost for a screen reader by moving it.
      */}
      <p id="cohort-note" className="mb-3 max-w-prose text-sm text-(--color-ink-2)">
        Each row is the customers who signed up in one month; each column is how many of them
        were still paying that many months later. Month 0 is always 100% by construction. A
        cell can be <em>higher</em> than the one to its left — that is a reactivation,
        somebody who cancelled and came back, and a grid that could not show it would be a
        grid blind to the movement a subscription business most wants to find.
      </p>
      {/*
        The key.

        A ramp scaled to its data is only honest if the data's endpoints are
        stated, and this one had no key at all — the single piece of
        information encoded visually had no text equivalent anywhere. It sits
        above the scroller so it is readable at 360px without scrolling a
        retention grid sideways to find it.

        The swatches are aria-hidden. Every cell prints its own percentage, so
        the shade is redundant by design and the endpoints either side of the
        strip are the part worth reading aloud.
      */}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-(--color-muted)">
        <span data-numeric>{percent(lo)}</span>
        <span aria-hidden="true" className="flex">
          {Array.from({length: 6}, (_, i) => (
            <span
              key={i}
              className="block h-3 w-6 border border-(--color-paper)"
              style={{backgroundColor: shade(lo + ((hi - lo) * i) / 5)}}
            />
          ))}
        </span>
        <span data-numeric>{percent(hi)}</span>
        <span>of a cohort still paying{spread ? '' : ' (too little spread to shade)'}</span>
      </p>

      <Scroller label="Cohort retention grid" describedBy="cohort-note">
      <table className="border-collapse text-xs">
        <caption className="sr-only">
          Retention by signup month. Each row is a cohort, each column the share of it still
          paying that many months later.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-(--color-paper) py-2 pr-3 text-left font-normal">
              Cohort
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-normal">
              Size
            </th>
            {offsets.map((offset) => (
              <th
                key={offset}
                scope="col"
                data-numeric
                className="min-w-[2.6rem] py-2 text-center font-normal text-(--color-muted)"
              >
                {offset}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => {
            const row = byCohort.get(cohort)!
            const size = row.get(0)?.cohort_size ?? 0
            return (
              <tr key={cohort}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-(--color-paper) py-1 pr-3 text-left font-normal whitespace-nowrap"
                >
                  {/*
                    The cohort is a link to the customers who are in it.

                    This grid can say that the July 2025 cohort was still 80%
                    paying a year later and then leave you with no way to see
                    who those people are, on a build whose first claim is that
                    the URL is the state. A cohort is a signup month, the table
                    filters on signup date, so the view already exists and this
                    is the address of it.
                  */}
                  <a
                    href={cohortHref(cohort)}
                    data-numeric
                    className="underline underline-offset-4"
                  >
                    {monthLabel(cohort)}
                  </a>
                </th>
                <td data-numeric className="py-1 pr-3 text-right text-(--color-muted)">
                  {count(size)}
                </td>
                {offsets.map((offset) => {
                  const cell = row.get(offset)
                  if (!cell) {
                    // A month that has not happened yet for this cohort. Left
                    // blank rather than rendered as 0%, which is the single
                    // most common way a retention grid lies.
                    return <td key={offset} className="py-1" />
                  }
                  const retention = cell.cohort_size === 0 ? 0 : cell.retained / cell.cohort_size
                  return (
                    <td
                      key={offset}
                      data-numeric
                      className="border border-(--color-paper) px-1 py-1 text-center"
                      style={{backgroundColor: shade(retention)}}
                    >
                      {percent(retention)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      </Scroller>
    </div>
  )
}
