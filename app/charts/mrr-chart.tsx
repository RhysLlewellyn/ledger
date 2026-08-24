import {linear, linePath, niceDomain, niceTicks} from '@/charts/scale.ts'
import {count, money, month as monthLabel, movement} from '@/format.ts'
import type {MrrMonth} from '@/metrics/mrr-series.ts'

import {ChartFigure, Plot} from './figure.tsx'

const W = 720
const LINE_H = 200
const BAR_H = 90

/**
 * MRR over the report window, with net movement beneath it.
 *
 * Two plots sharing one x-axis: the balance on top, the change below. That
 * pairing is the point — a line alone shows revenue rising and says nothing
 * about whether it rose because new business arrived or because churn stopped,
 * and the bars answer that in the same glance.
 *
 * It reads in greyscale. The line is position, the bars are length from a
 * shared zero, and the only thing colour does is separate the two directions —
 * which position has already said. Printed in black and white, nothing is lost
 * but the tint.
 */
export function MrrChart({months}: {months: readonly MrrMonth[]}) {
  const values = months.map((m) => Number(m.mrr_pence))
  const nets = months.map(
    (m) =>
      Number(m.new_pence) +
      Number(m.expansion_pence) +
      Number(m.reactivation_pence) +
      Number(m.contraction_pence) +
      Number(m.churn_pence),
  )

  const [yMin, yMax] = niceDomain(0, Math.max(...values), 4)
  const y = linear([yMin, yMax], [LINE_H, 0])
  const x = linear([0, Math.max(1, months.length - 1)], [0, W])

  const netMax = Math.max(...nets.map(Math.abs))
  const [, netTop] = niceDomain(0, netMax, 2)
  const barY = linear([-netTop, netTop], [BAR_H, 0])
  const barW = (W / months.length) * 0.62

  const points = values.map((v, i) => ({x: x(i), y: y(v)}))
  const first = months[0]!
  const last = months[months.length - 1]!

  const growth = (m: MrrMonth, previous: MrrMonth | undefined) =>
    previous ? (Number(m.mrr_pence) - Number(previous.mrr_pence)) / Number(previous.mrr_pence) : 0
  const earlyGrowth = growth(months[1]!, months[0])
  const lateGrowth = growth(last, months[months.length - 2])

  return (
    <ChartFigure
      label={
        `Line chart of monthly recurring revenue across ${months.length} months, rising ` +
        `steadily from ${money(first.mrr_pence)} to ${money(last.mrr_pence)}. Beneath it, ` +
        `bars showing net revenue movement each month, positive in every month. The line ` +
        `bends flatter towards the right as month-on-month growth slows.`
      }
      caption={
        <>
          {/*
            {' to '} rather than `to{' '}` at the end of a line. A text node
            holding nothing but whitespace is dropped when Chrome computes the
            accessibility text, so the second form renders "to £3,439,147" and
            a screen reader reads "to£3,439,147". Keeping the word and its
            spaces in one node is the whole fix.
          */}
          MRR grew from <strong>{money(first.mrr_pence)}</strong>
          {' to '}
          <strong>{money(last.mrr_pence)}</strong>
          {` over ${months.length} months, and net movement was positive in every one of ` +
            `them. Growth is decelerating even so: month on month it fell from ` +
            `${(earlyGrowth * 100).toFixed(1)}% early in the window to ` +
            `${(lateGrowth * 100).toFixed(1)}% at the end, which is the bend in the line ` +
            `rather than anything the totals show.`}
        </>
      }
      tableSummary={`View the ${months.length} monthly figures as a table`}
      tableLabel="Monthly figures table"
      table={<MrrTable months={months} />}
    >
      <Plot width={W} height={LINE_H} className="h-[200px]">
        {niceTicks(yMin, yMax, 4).map((tick) => (
          <line
            key={tick}
            x1={0}
            x2={W}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--color-rule)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={linePath(points)}
          fill="none"
          stroke="var(--color-data-1)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </Plot>

      {/*
        The y labels are HTML, positioned against the same scale the SVG used.
        Text inside a stretched viewBox is text at the wrong size on every
        screen but one.
      */}
      <ul className="relative -mt-[200px] h-[200px] list-none text-xs text-(--color-muted)">
        {niceTicks(yMin, yMax, 4).map((tick) => (
          <li
            key={tick}
            data-numeric
            className="absolute left-0 -translate-y-1/2 bg-(--color-paper) pr-1"
            style={{top: `${(y(tick) / LINE_H) * 100}%`}}
          >
            {money(tick)}
          </li>
        ))}
      </ul>

      <Plot width={W} height={BAR_H} className="mt-2 h-[90px]">
        <line
          x1={0}
          x2={W}
          y1={barY(0)}
          y2={barY(0)}
          stroke="var(--color-ink-2)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {nets.map((net, i) => {
          const top = Math.min(barY(net), barY(0))
          const height = Math.abs(barY(net) - barY(0))
          return (
            <rect
              key={months[i]!.month}
              x={x(i) - barW / 2}
              y={top}
              width={barW}
              // A month that netted nothing still gets a hairline, so the
              // reader can tell "no change" from "no data".
              height={Math.max(height, 0.75)}
              fill={net >= 0 ? 'var(--color-data-1)' : 'var(--color-data-neg)'}
            />
          )
        })}
      </Plot>

      {/*
        Every third month above 640px, every sixth below it.

        The plot is `w-full` and never scrolls, so these labels have to fit
        rather than overflow — and thinning to every third was measured and
        found not to be enough. At 360px the nine remaining labels are 494px of
        content in a 297px box, and because `html` sets `overflow-x: clip` the
        overflow does not even become a scrollbar: the last three months are
        drawn outside the viewport with no way to reach them. Feb, May and Jul
        2026 were simply invisible on a phone, on both charts, and no automated
        check saw it because nothing scrolled.

        Hiding rather than re-rendering keeps one list in the DOM, so the
        table behind the disclosure and a screen reader still get every month.
      */}
      <ol className="mt-1 flex list-none justify-between text-xs text-(--color-muted)">
        {months.map((m, i) =>
          i % 3 === 0 || i === months.length - 1 ? (
            <li
              key={m.month}
              data-numeric
              className={`whitespace-nowrap ${
                i % 6 === 0 || i === months.length - 1 ? '' : 'hidden sm:block'
              }`}
            >
              {monthLabel(m.month)}
            </li>
          ) : null,
        )}
      </ol>
    </ChartFigure>
  )
}

function MrrTable({months}: {months: readonly MrrMonth[]}) {
  return (
    <table className="w-full min-w-[36rem] border-collapse text-sm">
      <caption className="sr-only">
        Closing monthly recurring revenue, net movement, active customers, new customers and
        churned customers, for each month of the report window.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-left font-normal">
            Month
          </th>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-right font-normal">
            Closing MRR
          </th>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-right font-normal">
            Net movement
          </th>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-right font-normal">
            Customers
          </th>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 pr-4 text-right font-normal">
            New
          </th>
          <th scope="col" className="border-b border-(--color-rule-2) py-2 text-right font-normal">
            Churned
          </th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => {
          const net =
            Number(m.new_pence) +
            Number(m.expansion_pence) +
            Number(m.reactivation_pence) +
            Number(m.contraction_pence) +
            Number(m.churn_pence)
          return (
            <tr key={m.month} className="border-b border-(--color-rule)">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                <span data-numeric>{monthLabel(m.month)}</span>
              </th>
              <td data-numeric className="py-1.5 pr-4 text-right">
                {money(m.mrr_pence)}
              </td>
              <td data-numeric className="py-1.5 pr-4 text-right">
                {movement(net)}
              </td>
              <td data-numeric className="py-1.5 pr-4 text-right">
                {count(m.active_customers)}
              </td>
              <td data-numeric className="py-1.5 pr-4 text-right">
                {count(m.new_count)}
              </td>
              <td data-numeric className="py-1.5 text-right">
                {count(m.churn_count)}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
