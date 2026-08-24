import type {SortColumn} from '@/metrics/customers.ts'

/**
 * The nine columns of the customer table, named once.
 *
 * The header row and the table's `<caption>` both have to say what the table
 * is sorted by, and before this existed they said it two different ways: the
 * header rendered a hand-written "MRR" and the caption ran the column key
 * through a generic humaniser, which turned `mrr` into "Mrr". A screen reader
 * read the caption aloud as "sorted by Mrr descending" while the header it
 * described said "MRR". Only one of them can be right, so there is now only
 * one of them.
 *
 * `initial` is the direction a column sorts in the first time it is chosen.
 * Money, counts and dates are more useful largest-first; names are not.
 */
export const COLUMNS: readonly {
  column: SortColumn
  label: string
  numeric?: boolean
  initial?: 'asc' | 'desc'
}[] = [
  {column: 'name', label: 'Customer'},
  {column: 'plan', label: 'Plan'},
  {column: 'status', label: 'Status'},
  {column: 'country', label: 'Country'},
  {column: 'channel', label: 'Channel'},
  {column: 'seats', label: 'Seats', numeric: true, initial: 'desc'},
  {column: 'mrr', label: 'MRR', numeric: true, initial: 'desc'},
  {column: 'signed_up', label: 'Signed up', initial: 'desc'},
  {column: 'last_seen', label: 'Last seen', initial: 'desc'},
]

const BY_COLUMN = new Map(COLUMNS.map((c) => [c.column, c.label]))

/** The label a reader sees for a sort column, for use in prose. */
export function columnLabel(column: SortColumn): string {
  return BY_COLUMN.get(column) ?? column
}
