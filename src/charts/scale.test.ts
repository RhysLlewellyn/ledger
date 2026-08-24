import {describe, expect, it} from 'vitest'

import {linear, linePath, niceDomain, niceTicks, stack} from './scale.ts'

/**
 * The chart arithmetic, which is the half of hand-rolling a chart that is
 * actually easy to get wrong. None of this needs a DOM or a database.
 */

describe('linear', () => {
  it('maps a domain onto a range', () => {
    const scale = linear([0, 100], [0, 200])
    expect(scale(0)).toBe(0)
    expect(scale(50)).toBe(100)
    expect(scale(100)).toBe(200)
  })

  it('inverts for SVG, where y grows downwards', () => {
    const scale = linear([0, 10], [240, 0])
    expect(scale(0)).toBe(240)
    expect(scale(10)).toBe(0)
  })

  it('renders a flat domain flat rather than dividing by zero', () => {
    // A month where nothing moved is a real month, not a bad input.
    const scale = linear([500, 500], [240, 0])
    expect(Number.isFinite(scale(500))).toBe(true)
    expect(scale(500)).toBe(120)
  })
})

describe('niceTicks', () => {
  it('produces round numbers a reader can do arithmetic on', () => {
    expect(niceTicks(0, 1000, 5)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(niceTicks(0, 3_439_147, 4)).toEqual([0, 1_000_000, 2_000_000, 3_000_000])
  })

  it('never emits float dust', () => {
    // An axis labelled 2.9999999999999996 is the classic symptom of
    // accumulating a step instead of multiplying it.
    for (const tick of niceTicks(0, 3, 10)) {
      expect(String(tick)).not.toMatch(/\d{10}/)
    }
  })

  it('covers a range that does not start at zero', () => {
    const ticks = niceTicks(820_000, 3_440_000, 5)
    expect(ticks[0]).toBeGreaterThanOrEqual(820_000)
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(3_440_000)
    expect(ticks.length).toBeGreaterThan(2)
  })

  it('handles a single value and a reversed range without throwing', () => {
    expect(niceTicks(5, 5)).toEqual([5])
    expect(niceTicks(100, 0, 5)).toEqual(niceTicks(0, 100, 5))
  })

  it('returns nothing for values that are not numbers', () => {
    expect(niceTicks(NaN, 10)).toEqual([])
    expect(niceTicks(0, Infinity)).toEqual([])
  })
})

describe('niceDomain', () => {
  it('rounds the axis outwards so the data fits inside it', () => {
    const [min, max] = niceDomain(820_000, 3_439_147, 5)
    expect(min).toBeLessThanOrEqual(820_000)
    expect(max).toBeGreaterThanOrEqual(3_439_147)
  })

  it('keeps zero in view when the data crosses it', () => {
    const [min, max] = niceDomain(-4_200, 9_800, 4)
    expect(min).toBeLessThan(0)
    expect(max).toBeGreaterThan(0)
  })
})

describe('linePath', () => {
  it('draws straight segments between measured points', () => {
    // A polyline, not a spline. Interpolation invents values between the
    // months that were measured, and those are the ones somebody reads off.
    expect(linePath([{x: 0, y: 10}, {x: 5, y: 0}])).toBe('M0,10 L5,0')
  })

  it('is empty for no points', () => {
    expect(linePath([])).toBe('')
  })

  it('trims coordinates nobody can see', () => {
    expect(linePath([{x: 1.123456789, y: 2}])).toBe('M1.123,2')
  })
})

describe('stack', () => {
  it('stacks positives up and negatives down from a shared baseline', () => {
    const segments = stack([
      {key: 'new', value: 100},
      {key: 'expansion', value: 50},
      {key: 'churn', value: -30},
      {key: 'contraction', value: -20},
    ])

    expect(segments).toEqual([
      {key: 'new', value: 100, from: 0, to: 100},
      {key: 'expansion', value: 50, from: 100, to: 150},
      {key: 'churn', value: -30, from: 0, to: -30},
      {key: 'contraction', value: -20, from: -30, to: -50},
    ])
  })

  it('drops zero-height segments rather than rendering invisible rectangles', () => {
    const segments = stack([
      {key: 'new', value: 10},
      {key: 'reactivation', value: 0},
    ])
    expect(segments.map((s) => s.key)).toEqual(['new'])
  })

  it('leaves the net movement as the gap between the two stacks', () => {
    const values = [
      {key: 'new', value: 100},
      {key: 'churn', value: -40},
    ]
    const segments = stack(values)
    const top = Math.max(...segments.map((s) => s.to))
    const bottom = Math.min(...segments.map((s) => s.to))
    expect(top + bottom).toBe(60)
  })
})
