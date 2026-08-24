/**
 * The wrapper every chart in this product sits inside.
 *
 * A chart is four things here, and only one of them is the picture.
 *
 * **A `<figcaption>` that states the finding in words.** Not "MRR over time" —
 * that is a title, and a title tells you what you are looking at rather than
 * what it says. "MRR grew from £818,000 to £3.44m over 24 months, with
 * month-on-month growth falling from 11% to 2.5%" is the finding, and it is
 * the thing somebody would repeat in a meeting. Everybody gets it, whether
 * they can see the chart, are skimming past it, or are reading it aloud.
 *
 * **A picture with `role="img"` and an `aria-label`.** The SVG internals are
 * `aria-hidden`, because two hundred `<rect>` elements announced individually
 * are worse than silence. The label summarises the shape.
 *
 * **The numbers, in a real `<table>`.** This is not a fallback. It is a first
 * class view of the same data, it is what a screen reader user will actually
 * navigate, and it is the only way to read an exact value off any chart.
 *
 * **A `<details>` to hold the table**, which is the whole reason the toggle
 * needs no JavaScript. A native disclosure is keyboard-operable, announces its
 * own expanded state, works with the page's JavaScript switched off, and is
 * findable by the browser's own find-in-page. A button with `useState` behind
 * it would be more code doing less.
 */
export function ChartFigure({
  caption,
  label,
  children,
  table,
  tableSummary,
}: {
  /** The finding, in a sentence. Rendered as the visible caption. */
  caption: React.ReactNode
  /** What the shape looks like, for somebody who cannot see it. */
  label: string
  /** The SVG. Its internals should be aria-hidden. */
  children: React.ReactNode
  /** The same data as a real table. */
  table: React.ReactNode
  /** One line naming what the table holds, for the disclosure. */
  tableSummary: string
}) {
  return (
    <figure className="mt-6">
      <div role="img" aria-label={label}>
        {children}
      </div>

      <figcaption className="mt-3 max-w-prose text-sm text-(--color-ink-2)">
        {caption}
      </figcaption>

      {/*
        `group` and `group-open` draw the marker, because the native one is a
        filled triangle that has nothing in common with anything else on this
        page. A plus and a minus is the same affordance in the page's own
        voice, and it is aria-hidden because <summary> already announces its
        own expanded state.
      */}
      <details className="group mt-3 border-t border-(--color-rule) pt-2">
        <summary className="inline-flex cursor-pointer items-baseline gap-2 py-1 text-sm">
          <span aria-hidden="true" data-numeric className="text-(--color-muted)">
            <span className="group-open:hidden">+</span>
            <span className="hidden group-open:inline">−</span>
          </span>
          <span className="underline underline-offset-4">{tableSummary}</span>
        </summary>
        <div className="mt-3 overflow-x-auto">{table}</div>
      </details>
    </figure>
  )
}

/**
 * The plot area.
 *
 * The SVG carries `preserveAspectRatio="none"` and every stroke inside it
 * carries `vector-effect="non-scaling-stroke"`, which together are what make
 * these charts genuinely responsive rather than merely scalable.
 *
 * The usual approach — one square viewBox scaled to fit — scales the text with
 * it, so an 11px axis label becomes 5px on a phone and 24px on a desktop. Here
 * the marks stretch to whatever width there is and the *labels are HTML*,
 * outside the SVG, at a real font size at every width. They are also
 * selectable, they reflow, and they are styled by the same stylesheet as the
 * rest of the page rather than by SVG presentation attributes.
 *
 * `non-scaling-stroke` is the piece that makes it work: without it a
 * horizontally stretched viewBox draws vertical rules thicker than horizontal
 * ones, which looks like a rendering bug because it is one.
 */
export function Plot({
  width,
  height,
  className = '',
  children,
}: {
  width: number
  height: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={`block w-full ${className}`}
    >
      {children}
    </svg>
  )
}
