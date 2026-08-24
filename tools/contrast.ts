/**
 * Every contrast ratio in the palette, checked rather than claimed.
 *
 * `npm run contrast` prints the table and exits non-zero if any pairing the
 * interface actually uses falls below its WCAG 2.2 threshold. The point is
 * that the accessibility claim in this build is not "the colours look about
 * right" — it is a number somebody else can reproduce, and a broken one fails
 * a command rather than waiting for an audit.
 *
 * The pairs listed are the ones the components use. A palette where every
 * colour clears every other colour is a palette with no dark colours in it;
 * what matters is that the combinations that ship are sound.
 */

type Rgb = [number, number, number]

const TOKENS: Record<string, string> = {
  paper: '#FCFCFB',
  'paper-2': '#F2F2F0',
  rule: '#DEDEDA',
  'rule-2': '#B9B9B4',
  ink: '#151A21',
  'ink-2': '#474C55',
  muted: '#6E727B',
  field: '#8B8B86',
  'data-1': '#1F5C8B',
  'data-2': '#9C4A26',
  'data-3': '#3C6B41',
  'data-4': '#6B4E8C',
  'data-neg': '#A33A32',
}

/**
 * foreground, background, minimum, what uses it.
 *
 * A minimum of 0 means "decorative — reported so the number is visible, but
 * not required to clear anything". That distinction is the whole reason this
 * table has a column for it. WCAG 1.4.11 asks 3:1 of *user interface
 * components* and of *graphical objects required to understand the content*;
 * it does not ask it of a hairline between two table rows. Holding a
 * decorative rule to 3:1 would mean a page ruled in mid-grey, which is a
 * worse page and no more accessible.
 *
 * So the lines are split by job rather than by shade. `rule` and `rule-2`
 * separate things and are decorative. `field` outlines inputs and buttons and
 * has to clear 3:1. The zero baseline on the movement chart is a graphical
 * object somebody needs in order to read the chart, so it is drawn in `ink-2`
 * rather than in a rule colour.
 */
const PAIRS: [string, string, number, string][] = [
  ['ink', 'paper', 4.5, 'body text'],
  ['ink', 'paper-2', 4.5, 'text on a filled cell'],
  ['ink-2', 'paper', 4.5, 'secondary prose, table labels'],
  ['muted', 'paper', 4.5, 'axis labels, hints, empty-state text'],
  ['data-1', 'paper', 3, 'the MRR line and the movement bars'],
  ['data-2', 'paper', 3, 'contraction'],
  ['data-3', 'paper', 3, 'expansion'],
  ['data-4', 'paper', 3, 'reactivation'],
  ['data-neg', 'paper', 4.5, 'negative amounts, which are text as well as marks'],
  ['field', 'paper', 3, 'borders of inputs and buttons — a UI component boundary'],
  ['rule', 'paper', 0, 'decorative — hairline between table rows'],
  ['rule-2', 'paper', 0, 'decorative — section rules and table head underline'],
  // The cohort grid shades cells with data-1 mixed into paper. The ramp is
  // capped at 70%, so this is the darkest cell any text sits on.
  ['ink', 'cohort-max', 4.5, 'the darkest cohort cell'],
]

function parse(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i]! * weight + b[i]! * (1 - weight))) as Rgb
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1! + 0.05) / (l2! + 0.05)
}

function colour(name: string): Rgb {
  if (name === 'cohort-max') {
    // color-mix(in srgb, var(--color-data-1) 70%, var(--color-paper))
    return mix(parse(TOKENS['data-1']!), parse(TOKENS.paper!), 0.7)
  }
  return parse(TOKENS[name]!)
}

let failed = false
const rows: string[] = []

for (const [fg, bg, min, use] of PAIRS) {
  const r = ratio(colour(fg), colour(bg))
  const ok = r >= min
  const label = min === 0 ? 'note' : `min ${String(min).padStart(3)}`
  if (!ok) failed = true
  rows.push(
    `${min === 0 ? '  -- ' : ok ? '  ok ' : 'FAIL '}${r.toFixed(2).padStart(6)}:1  (${label})  ` +
      `${fg} on ${bg}`.padEnd(26) +
      `  ${use}`,
  )
}

console.log('\nContrast, WCAG 2.2, sRGB\n')
console.log(rows.join('\n'))
console.log()

if (failed) {
  console.error('At least one pairing the interface uses is below its threshold.\n')
  process.exit(1)
}
