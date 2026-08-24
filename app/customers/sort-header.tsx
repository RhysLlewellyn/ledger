import Link from 'next/link'

import type {CustomerQueryOptions, SortColumn} from '@/metrics/customers.ts'
import {customerHref} from '@/metrics/params.ts'

/**
 * One sortable column heading.
 *
 * It is a `<th scope="col">` carrying `aria-sort`, wrapping a real link. Three
 * things follow from that and each is deliberate.
 *
 * `aria-sort` is how a screen reader announces the sort — "column header,
 * ascending" — and it belongs on the header cell rather than on the control
 * inside it. Only the column currently sorted gets a value; putting
 * `aria-sort="none"` on the other eight is valid and makes the table announce
 * eight negations nobody asked for.
 *
 * The control is a link and not a button because sorting this table *is*
 * navigation: it changes the URL, it goes in the history, and the back button
 * has to undo it. A button posting a form would need JavaScript to do the same
 * job worse.
 *
 * The arrow is `aria-hidden`. It repeats what `aria-sort` already says, and a
 * screen reader announcing "down arrow" after "descending" is the same fact
 * twice.
 */
export function SortHeader({
  column,
  label,
  options,
  numeric = false,
  /** The direction this column starts in when it is not the current sort. */
  initial = 'asc',
}: {
  column: SortColumn
  label: string
  options: CustomerQueryOptions
  numeric?: boolean
  initial?: 'asc' | 'desc'
}) {
  const isSorted = options.sort === column
  const direction = isSorted ? options.direction : initial
  const nextDirection = isSorted ? (direction === 'asc' ? 'desc' : 'asc') : initial

  return (
    <th
      scope="col"
      aria-sort={isSorted ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
      // The same right padding the body cells carry. Without it a
      // right-aligned header runs straight into the next column's label and
      // "MRR ▼" and "Signed up" read as one heading.
      className={`border-b border-(--color-rule-2) py-2 pr-4 whitespace-nowrap font-normal ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      <Link
        href={`/customers${customerHref(options, {sort: column, direction: nextDirection})}`}
        // A column heading is a target, and the text alone is 18px tall.
        className="inline-flex min-h-6 items-center gap-1 underline-offset-4 hover:underline"
      >
        {label}
        <span aria-hidden="true" className="text-(--color-muted)">
          {isSorted ? (direction === 'asc' ? '▲' : '▼') : '•'}
        </span>
      </Link>
    </th>
  )
}
