/**
 * One headline figure with its label and an optional note beneath.
 *
 * This existed twice, once on the overview and once on the customer page,
 * differing by a single type-size step and by whether the note carried
 * `data-numeric`. Neither difference was a decision — the two were written
 * weeks apart and drifted — and the result was a note set in mono on one page
 * and in sans on the other for figures that sit in the same role.
 *
 * They are one component now, and the size is a prop rather than a fork,
 * because a customer's current MRR genuinely is a smaller claim than the whole
 * business's recurring revenue and the page should be allowed to say so.
 */
export function Figure({
  label,
  value,
  note,
  size = 'lg',
}: {
  label: string
  value: string
  /** A qualifier under the figure: "+£83,063 on the month", "in July 2026". */
  note?: string
  /** `lg` for a page's headline row, `md` for a subordinate one. */
  size?: 'lg' | 'md'
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-(--color-ink-2) uppercase">{label}</dt>
      <dd data-numeric className={`mt-1 ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
        {value}
      </dd>
      {note && (
        <dd data-numeric className="mt-0.5 text-xs text-(--color-muted)">
          {note}
        </dd>
      )}
    </div>
  )
}
