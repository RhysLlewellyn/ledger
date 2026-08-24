/**
 * The arithmetic behind the charts, with no SVG in it.
 *
 * Everything here is a pure function over numbers, which is the only reason
 * hand-rolling three charts is a sane thing to do: the part that is easy to
 * get quietly wrong — where a tick lands, what the axis maximum rounds to,
 * whether a zero-height bar disappears — is asserted in `scale.test.ts` in
 * milliseconds, and the components are left holding nothing but layout.
 */

export type Scale = (value: number) => number

/** A linear map from a data range onto a pixel range. */
export function linear(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): Scale {
  // A domain of zero width is not a degenerate case to guard against later —
  // it is a flat month, and it has to render as a flat line rather than as a
  // division by zero.
  if (d1 === d0) return () => (r0 + r1) / 2
  const m = (r1 - r0) / (d1 - d0)
  return (value) => r0 + (value - d0) * m
}

/**
 * Round numbers covering the data, at roughly the requested count.
 *
 * The rule is the usual one — steps of 1, 2, 2.5 or 5 times a power of ten —
 * because those are the intervals people can do arithmetic on at a glance. An
 * axis labelled 0, 847, 1694 is technically an axis and nobody has ever read
 * a value off one.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  if (min > max) [min, max] = [max, min]

  const step = niceStep((max - min) / Math.max(1, count))
  const first = Math.ceil(min / step) * step
  const ticks: number[] = []
  // Multiply rather than accumulate: adding 0.1 to itself thirty times is how
  // an axis ends up labelled 2.9999999999999996.
  for (let i = 0; first + i * step <= max + step * 1e-9; i += 1) {
    ticks.push(round(first + i * step))
  }
  return ticks
}

/** The rounded axis bounds a set of ticks implies. */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (min === max) return min === 0 ? [0, 1] : [Math.min(0, min), Math.max(0, max)]
  const step = niceStep((max - min) / Math.max(1, count))
  return [round(Math.floor(min / step) * step), round(Math.ceil(max / step) * step)]
}

function niceStep(rough: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rough) || 1))
  const normalised = Math.abs(rough) / magnitude
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10
  return step * magnitude
}

/** Kills the float dust that `0.1 * 3` leaves behind. */
function round(value: number): number {
  return Number(value.toPrecision(12))
}

/**
 * An SVG path through a series, in the chart's own coordinate space.
 *
 * A polyline of 24 points, not a smoothed curve. Interpolation invents values
 * between the months that were measured, and on a revenue chart those invented
 * values are the ones somebody reads off and repeats.
 */
export function linePath(
  points: readonly {x: number; y: number}[],
): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`).join(' ')
}

/** Coordinates at more than three decimals are bytes nobody can see. */
export function fmt(n: number): string {
  return Number(n.toFixed(3)).toString()
}

/**
 * A stacked bar's segments, as offsets from a shared baseline.
 *
 * Positive and negative stack away from zero in opposite directions, which is
 * what makes a movement chart readable: everything above the line added
 * revenue and everything below it took revenue away, and the net is the gap.
 * Segments of zero are dropped rather than rendered as invisible rectangles —
 * an empty `<rect>` still lands in the DOM, still gets a title, and is still
 * something a reader can hover and be told nothing by.
 */
export function stack(
  values: readonly {key: string; value: number}[],
): {key: string; value: number; from: number; to: number}[] {
  let up = 0
  let down = 0
  const out: {key: string; value: number; from: number; to: number}[] = []
  for (const {key, value} of values) {
    if (value === 0) continue
    if (value > 0) {
      out.push({key, value, from: up, to: up + value})
      up += value
    } else {
      out.push({key, value, from: down, to: down + value})
      down += value
    }
  }
  return out
}
