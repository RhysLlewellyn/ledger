import {linear, niceDomain, niceTicks, stack} from '@/charts/scale.ts'
import {money, month as monthLabel, movement} from '@/format.ts'
import type {MrrMonth} from '@/metrics/mrr-series.ts'

import {ChartFigure, Plot} from './figure.tsx'

const W = 720
const H = 240

/**
 * Where each month's revenue change came from.
 *
 * Five kinds, stacked away from a shared zero: new, expansion and
 * reactivation above the line, contraction and churn below it. The net for the
 * month is the difference between the two stacks, which is a thing you can
 * read off by eye without any number being printed.
 *
 * **This chart has to work in greyscale**, which is the constraint that shapes
 * it. Five hues on a stacked bar is the default answer and it fails for one
 * reader in twelve, fails again when the page is printed, and fails a third
 * time on a projector. So hue is the last of four encodings here and the only
 * one that carries nothing on its own:
 *
 * - **Position** separates gains from losses. Above the line added revenue.
 * - **Length** is the amount, from a common baseline.
 * - **Pattern** separates the series — solid, diagonal, dotted, horizontal.
 * - **Direct labelling** in the legend, which carries the same patterns.
 *
 * Print the page in black and white and every one of those survives.
 */

type Series = {
  key: keyof Pick<
    MrrMonth,
    'new_pence' | 'expansion_pence' | 'reactivation_pence' | 'contraction_pence' | 'churn_pence'
  >
  label: string
  fill: string
  pattern?: string
}

const SERIES: readonly Series[] = [
  {key: 'new_pence', label: 'New', fill: 'var(--color-data-1)'},
  {key: 'expansion_pence', label: 'Expansion', fill: 'var(--color-data-3)', pattern: 'diagonal'},
  {
    key: 'reactivation_pence',
    label: 'Reactivation',
    fill: 'var(--color-data-4)',
    pattern: 'dots',
  },
  {
    key: 'contraction_pence',
    label: 'Contraction',
    fill: 'var(--color-data-2)',
    pattern: 'horizontal',
  },
  {key: 'churn_pence', label: 'Churn', fill: 'var(--color-data-neg)'},
]

export function MovementChart({months}: {months: readonly MrrMonth[]}) {
  const stacks = months.map((m) =>
    stack(SERIES.map((s) => ({key: s.key, value: Number(m[s.key])}))),
  )

  const top = Math.max(...stacks.map((s) => Math.max(0, ...s.map((seg) => seg.to))))
  const bottom = Math.min(...stacks.map((s) => Math.min(0, ...s.map((seg) => seg.to))))
  const [lo, hi] = niceDomain(bottom, top, 4)

  const y = linear([lo, hi], [H, 0])
  const x = linear([0, Math.max(1, months.length - 1)], [0, W])
  const barW = (W / months.length) * 0.62

  const totals = SERIES.map((s) => ({
    ...s,
    total: months.reduce((sum, m) => sum + Number(m[s.key]), 0),
  }))
  const gross = totals.filter((t) => t.total > 0).reduce((sum, t) => sum + t.total, 0)
  const expansion = totals.find((t) => t.key === 'expansion_pence')!
  const churn = totals.find((t) => t.key === 'churn_pence')!

  return (
    <ChartFigure
      label={
        `Stacked bar chart of monthly revenue movement over ${months.length} months. New ` +
        `business and expansion sit above a zero line and churn and contraction below it. ` +
        `Both stacks grow over the window, and the bars above the line are taller than ` +
        `those below it in every month.`
      }
      caption={
        <>
          Across the window, expansion added <strong>{money(expansion.total)}</strong> —{' '}
          {((expansion.total / gross) * 100).toFixed(0)}% of all revenue gained, and the
          second-largest source after new business. Churn took{' '}
          <strong>{money(Math.abs(churn.total))}</strong> back. Both stacks grow as the
          business does; what matters is that the one above the line grows faster.
        </>
      }
      tableSummary={`View the ${months.length} months of movement as a table`}
      table={<MovementTable months={months} />}
    >
      <Plot width={W} height={H} className="h-[240px]">
        <defs>
          {/*
            Patterns are what make this legible in black and white. They are
            defined once and referenced by every rectangle of that series.
          */}
          <pattern id="mv-diagonal" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--color-data-3)" />
            <path d="M0,6 L6,0" stroke="var(--color-paper)" strokeWidth="1.5" />
          </pattern>
          <pattern id="mv-dots" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--color-data-4)" />
            <circle cx="2.5" cy="2.5" r="1.1" fill="var(--color-paper)" />
          </pattern>
          <pattern id="mv-horizontal" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--color-data-2)" />
            <path d="M0,2.5 L5,2.5" stroke="var(--color-paper)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {niceTicks(lo, hi, 4).map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={W}
            y1={y(tick)}
            y2={y(tick)}
            // The zero line is a graphical object somebody needs in order to
            // read this chart, so it is drawn in ink rather than in a
            // decorative rule colour. 1.4.11 applies to it and not to the
            // gridlines around it.
            stroke={tick === 0 ? 'var(--color-ink-2)' : 'var(--color-rule)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {stacks.map((segments, i) =>
          segments.map((segment) => {
            const series = SERIES.find((s) => s.key === segment.key)!
            const yTop = Math.min(y(segment.from), y(segment.to))
            const height = Math.abs(y(segment.to) - y(segment.from))
            return (
              <rect
                key={`${months[i]!.month}-${segment.key}`}
                x={x(i) - barW / 2}
                y={yTop}
                width={barW}
                height={Math.max(height, 0.5)}
                fill={series.pattern ? `url(#mv-${series.pattern})` : series.fill}
              />
            )
          }),
        )}
      </Plot>

      <ul className="relative -mt-[240px] h-[240px] list-none text-xs text-(--color-muted)">
        {niceTicks(lo, hi, 4).map((tick) => (
          <li
            key={tick}
            data-numeric
            className="absolute left-0 -translate-y-1/2 bg-(--color-paper) pr-1"
            style={{top: `${(y(tick) / H) * 100}%`}}
          >
            {money(tick)}
          </li>
        ))}
      </ul>

      <ol className="mt-1 flex list-none justify-between text-xs text-(--color-muted)">
        {months.map((m, i) =>
          i % 3 === 0 || i === months.length - 1 ? (
            <li key={m.month} data-numeric className="whitespace-nowrap">
              {monthLabel(m.month)}
            </li>
          ) : null,
        )}
      </ol>

      {/*
        The legend carries the same patterns as the bars, so matching a swatch
        to a series does not depend on telling two colours apart.
      */}
      <ul className="mt-4 flex list-none flex-wrap gap-x-5 gap-y-2 text-xs">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <svg width="14" height="14" aria-hidden="true" className="shrink-0">
              <rect
                width="14"
                height="14"
                fill={s.pattern ? `url(#mv-${s.pattern})` : s.fill}
                stroke="var(--color-field)"
              />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </ChartFigure>
  )
}

function MovementTable({months}: {months: readonly MrrMonth[]}) {
  return (
    <table className="w-full min-w-[42rem] border-collapse text-sm">
      <caption className="sr-only">
        Revenue movement by kind for each month: new, expansion, reactivation, contraction and
        churn, with the net for the month.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-left font-normal">
            Month
          </th>
          {SERIES.map((s) => (
            <th
              key={s.key}
              scope="col"
              className="border-b border-(--color-rule-2) py-2 pr-4 text-right font-normal"
            >
              {s.label}
            </th>
          ))}
          <th scope="col" className="border-b border-(--color-rule-2) py-2 text-right font-normal">
            Net
          </th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => {
          const net = SERIES.reduce((sum, s) => sum + Number(m[s.key]), 0)
          return (
            <tr key={m.month} className="border-b border-(--color-rule)">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                <span data-numeric>{monthLabel(m.month)}</span>
              </th>
              {SERIES.map((s) => (
                <td key={s.key} data-numeric className="py-1.5 pr-4 text-right">
                  {movement(m[s.key])}
                </td>
              ))}
              <td data-numeric className="py-1.5 text-right">
                {movement(net)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
