/**
 * What a page shows while Postgres is still answering.
 *
 * Every navigation in this build is a real document load, so the browser keeps
 * the previous page on screen until the new one starts rendering. That is
 * better than a blank screen and it is still not feedback: on a suspended Neon
 * compute the previous page sits there looking frozen for several seconds with
 * nothing but a tab spinner to say otherwise.
 *
 * Next streams. The root layout and this fallback are flushed as soon as the
 * request arrives — measured at 15ms against a cold query below — and the real
 * page replaces them when the query returns. So the reader gets the masthead,
 * the rules and the heading immediately, and watches the figures arrive.
 *
 * The shape is ruled paper: hairlines where the rows will be, in the same
 * `--color-rule` the tables use, at the same row height. No shimmer and no
 * grey blocks. A printed report before the figures are set is not a grey
 * rectangle, it is a ruled page, and this build already owns that vocabulary.
 *
 * `rows` is not decoration either. It is how many ruled lines to lay down, set
 * per route to approximate the height of the page that will replace it, so
 * little moves when it does. It was 16 on all four routes for a while, under a
 * comment claiming it matched the real row count — which is the kind of claim
 * this build argues about in other people's markup, so: the customers table
 * renders its default fifty, the cohort grid a row per month of the window,
 * the statement its dozen or so lines, and the overview is not a table at all,
 * so its number is a height rather than a count and says so here rather than
 * pretending otherwise.
 */
export function Skeleton({
  title,
  lead,
  rows,
}: {
  title: string
  lead: string
  /** How many ruled lines to lay down. Match the real row count. */
  rows: number
}) {
  return (
    <div aria-busy="true">
      <header className="border-b border-(--color-rule-2) pb-4">
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-2 max-w-prose text-sm text-(--color-ink-2)">{lead}</p>
      </header>

      {/*
        Announced once, politely, because a reader who cannot see the rules
        appear has otherwise been handed a page with a heading and nothing
        under it and no reason to think more is coming.
      */}
      <p role="status" className="sr-only">
        Loading the figures.
      </p>

      <div className="mt-6" aria-hidden="true">
        {Array.from({length: rows}, (_, i) => (
          <div key={i} className="h-9 border-b border-(--color-rule)" />
        ))}
      </div>
    </div>
  )
}
