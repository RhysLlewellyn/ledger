import {count, month as monthLabel, percent} from '@/format.ts'
import type {CohortCell} from '@/metrics/cohorts.ts'

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

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="border-collapse text-xs">
        <caption className="mb-3 max-w-prose text-left text-sm text-(--color-ink-2)">
          Each row is the customers who signed up in one month; each column is how many of
          them were still paying that many months later. Month 0 is always 100% by
          construction. A cell can be <em>higher</em> than the one to its left — that is a
          reactivation, somebody who cancelled and came back, and a grid that could not show
          it would be a grid blind to the movement a subscription business most wants to
          find.
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
                  <span data-numeric>{monthLabel(cohort)}</span>
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
                  const intensity = BASE_INTENSITY + retention * (MAX_INTENSITY - BASE_INTENSITY)
                  return (
                    <td
                      key={offset}
                      data-numeric
                      className="border border-(--color-paper) px-1 py-1 text-center"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(--color-data-1) ${(
                          intensity * 100
                        ).toFixed(0)}%, var(--color-paper))`,
                      }}
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
    </div>
  )
}
