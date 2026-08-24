/**
 * A horizontally scrolling container that a keyboard can actually reach.
 *
 * A `div` with `overflow-x: auto` is scrollable with a mouse or a finger and
 * not with a keyboard, because Chrome only gives arrow keys to a scroller that
 * can take focus. Nothing warns you: the content is in the DOM, the semantics
 * are perfect, the page passes axe, and a keyboard user simply cannot see the
 * right-hand half of the table.
 *
 * This build had six of them and five were unreachable. The sixth — the
 * customer table — escaped only because every row happens to contain a link,
 * so Tab lands inside the scroller and drags it along. That is luck, not
 * design, and it is why this is one component rather than six `tabIndex`
 * attributes.
 *
 * `role="region"` with a name is the documented pairing for the focusable
 * scroller: without it Tab stops on something that announces nothing. It costs
 * a tab stop at widths where the table already fits, which is a real if small
 * price, and the alternative is content that cannot be reached at all at 360px.
 *
 * The tables are still `min-w-[Nrem]`, so this scrolls rather than letting nine
 * columns crush into a phone. Only the document must never scroll sideways.
 */
export function Scroller({
  label,
  describedBy,
  className = '',
  children,
}: {
  /** Names the region. "Customers table", not "scrollable region". */
  label: string
  /** Optional id of prose that explains the table, for `aria-describedby`. */
  describedBy?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={0}
      className={`overflow-x-auto ${className}`}
    >
      {children}
    </div>
  )
}
