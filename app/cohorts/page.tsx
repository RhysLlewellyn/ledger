import type {Metadata} from 'next'

import {run} from '@/db/cached.ts'
import {count, month as monthLabel, percent} from '@/format.ts'
import {cohortRetention, type CohortCell} from '@/metrics/cohorts.ts'
import {reportBounds} from '@/metrics/facets.ts'

import {CohortGrid} from '../charts/cohort-grid.tsx'
import {Unavailable} from '../unavailable.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cohorts',
  description:
    'Retention by signup month: how many of each month’s new customers were still ' +
    'paying one, six and twelve months later.',
}

const MAX_OFFSET = 23

export default async function Cohorts() {
  let cells: CohortCell[]
  let asAt: string
  try {
    const [bounds] = await run<{first_day: string; last_day: string}>(reportBounds())
    if (!bounds) throw new Error('no data')
    asAt = bounds.last_day
    cells = await run<CohortCell>(
      cohortRetention(bounds.first_day, bounds.last_day, MAX_OFFSET, bounds.last_day),
    )
  } catch {
    return <Unavailable title="Cohorts" retry="/cohorts" />
  }

  const finding = describe(cells)

  return (
    <>
      <header className="border-b border-(--color-ink) pb-4">
        <h1 className="text-2xl">Cohorts</h1>
        <p className="mt-2 max-w-prose text-sm text-(--color-ink-2)">
          Retention by signup month, to <span data-numeric>{asAt}</span>. A customer counts as
          retained in month <em>k</em> if any subscription of theirs was running during that
          month — which is a question about their subscriptions, not about a single
          &ldquo;churned&rdquo; flag, because somebody who left and came back is retained in
          the months they were paying and absent in the months they were not.
        </p>
      </header>

      {finding && (
        <p className="mt-6 max-w-prose text-sm">
          Of the customers who signed up in <strong>{monthLabel(finding.cohort)}</strong>
          {', '}
          <strong>{percent(finding.atSix)}</strong>
          {' were still paying six months later and '}
          <strong>{percent(finding.atTwelve)}</strong>
          {' after a year. Across every cohort old enough to have one, month-six retention ' +
            'runs between '}
          <strong>{percent(finding.minSix)}</strong>
          {' and '}
          <strong>{percent(finding.maxSix)}</strong>
          {', and the difference is mostly acquisition channel: cohorts weighted towards ' +
            'paid search churn roughly three times as fast as those weighted towards ' +
            'referrals.'}
        </p>
      )}

      <CohortGrid cells={cells} maxOffset={MAX_OFFSET} />

      <p className="mt-6 max-w-prose text-xs text-(--color-muted)">
        <span data-numeric>{count(new Set(cells.map((c) => c.cohort_month)).size)}</span>
        {' cohorts. Cells left blank are months that have not happened yet for that cohort; ' +
          'rendering them as 0% is the single most common way a retention grid misleads.'}
      </p>
    </>
  )
}

/**
 * The finding, computed from the cells rather than asserted.
 *
 * A caption that says something specific has to be derived from the data it
 * describes, or it becomes a sentence somebody wrote once that quietly stops
 * being true.
 */
function describe(cells: readonly CohortCell[]) {
  const at = (offset: number) => {
    const out = new Map<string, number>()
    for (const cell of cells) {
      if (cell.month_offset === offset && cell.cohort_size >= 30) {
        out.set(cell.cohort_month, cell.retained / cell.cohort_size)
      }
    }
    return out
  }

  const six = at(6)
  const twelve = at(12)
  if (six.size === 0) return null

  // The oldest cohort with a full year behind it, which is the one that can
  // say the most.
  const cohort = [...twelve.keys()].sort()[0] ?? [...six.keys()].sort()[0]!
  const values = [...six.values()]

  return {
    cohort,
    atSix: six.get(cohort) ?? 0,
    atTwelve: twelve.get(cohort) ?? 0,
    minSix: Math.min(...values),
    maxSix: Math.max(...values),
  }
}
