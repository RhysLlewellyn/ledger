/**
 * The mechanical half of a keyboard and screen-reader pass.
 *
 * Drives real Chrome over the DevTools protocol, tabs through each page the
 * way a keyboard user would, and reports what the browser exposes at every
 * stop. It does NOT replace listening to the site with a screen reader: this
 * reads the accessibility *tree*, and NVDA is a separate consumer that layers
 * its own behaviour on top. What it is for is making the manual pass short and
 * aimed — answering the yes/no questions mechanically so the twenty minutes of
 * listening goes on the parts that actually need ears.
 *
 * Ledger's version adds the probes this build's claims need. The customer
 * table sorts by link and announces through `aria-sort`, the result count is
 * reached before the filter panel that produced it, and every chart carries
 * its numbers in a real table behind a native disclosure. Each of those is a
 * yes/no a machine can answer, and each of them is a claim the outreach makes.
 *
 * Usage: node tools/a11y-sweep.mjs [baseUrl]
 * Needs Chrome installed and the dev or production server running.
 */
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const require = createRequire(import.meta.url)

const BASE = process.argv[2] ?? 'http://localhost:3003'
const AXE = require.resolve('axe-core/axe.min.js')
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9226
const MAX_TABS = 90

const PAGES = [
  ['overview', '/'],
  ['customers', '/customers'],
  ['customers-filtered', '/customers?country=GB&status=active&sort=name&dir=asc'],
  ['customers-empty', '/customers?mrrMin=9999999'],
  ['customer-detail', '/customers/ardent-analytics-ab'],
  ['cohorts', '/cohorts'],
  ['not-found', '/no-such-page'],
]

const profile = join(tmpdir(), 'a11y-sweep-' + process.pid)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
  '--no-first-run',
  'about:blank',
])

/** Chrome needs a moment before its debugging endpoint answers. */
async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version')
      return (await r.json()).webSocketDebuggerUrl
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  throw new Error('Chrome never opened its debugging port')
}

/** A minimal CDP client. One in-flight map, one id counter, no dependencies. */
function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.reject(new Error(message.error.message))
    else waiting.resolve(message.result)
  })

  return {
    ws,
    ready: new Promise((resolve) => ws.addEventListener('open', resolve)),
    send(method, params = {}, sessionId) {
      id += 1
      const payload = {id, method, params}
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
      return new Promise((resolve, reject) => pending.set(id, {resolve, reject}))
    },
  }
}

const axeSource = readFileSync(AXE, 'utf8')

const root = connect(await endpoint())
await root.ready

const {targetId} = await root.send('Target.createTarget', {url: 'about:blank'})
const {sessionId} = await root.send('Target.attachToTarget', {targetId, flatten: true})
const send = (m, p) => root.send(m, p, sessionId)

await send('Page.enable')
await send('Runtime.enable')
await send('Accessibility.enable')

async function evaluate(expression) {
  const {result, exceptionDetails} = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate failed')
  return result.value
}

async function goto(url) {
  const loaded = new Promise((res) => {
    const h = (e) => {
      const m = JSON.parse(e.data)
      if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) {
        root.ws.removeEventListener('message', h)
        res()
      }
    }
    root.ws.addEventListener('message', h)
  })
  await send('Page.navigate', {url})
  await loaded
  // Fonts and hydration: the focus ring is a computed style, the tab order
  // depends on the DOM being final, and the roving tabindex is React's.
  await new Promise((r) => setTimeout(r, 1800))
}

/** Press a key as a real keyboard would, so :focus-visible actually matches. */
async function press(key, code, vk) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  if (key === 'Enter') {
    await send('Input.dispatchKeyEvent', {
      type: 'char',
      key,
      code,
      text: '\r',
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    })
  }
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  })
  await new Promise((r) => setTimeout(r, 60))
}

/**
 * The accessible name Chrome actually computed for whatever has focus.
 *
 * Not `textContent`, and not `innerText`. Those two disagree with the
 * accessible name exactly where it matters — around visually-hidden spans and
 * block-level children, which is precisely how the slot buttons are built —
 * and a probe that guessed would be reassuring rather than useful. This asks
 * the browser's own accessibility tree, which is the thing a screen reader
 * reads.
 */
async function accessibleName() {
  const {result} = await send('Runtime.evaluate', {expression: 'document.activeElement'})
  if (!result.objectId) return null
  try {
    const {nodes} = await send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    })
    const node = nodes?.[0]
    return {
      name: node?.name?.value ?? null,
      role: node?.role?.value ?? null,
      disabled: node?.properties?.find((p) => p.name === 'disabled')?.value?.value ?? false,
    }
  } finally {
    await send('Runtime.releaseObject', {objectId: result.objectId}).catch(() => {})
  }
}

const tab = () => press('Tab', 'Tab', 9)
const enter = () => press('Enter', 'Enter', 13)
const arrow = (which) =>
  press(
    'Arrow' + which,
    'Arrow' + which,
    {Left: 37, Up: 38, Right: 39, Down: 40}[which],
  )

/**
 * Everything interesting about wherever focus currently is. The name is built
 * the way a screen reader would build it rather than read off textContent,
 * because those two disagree exactly where the bugs are.
 */
const DESCRIBE_FOCUS = String.raw`(() => {
  const el = document.activeElement
  if (!el || el === document.body) return {none: true}
  const cs = getComputedStyle(el)
  const labelledby = el.getAttribute('aria-labelledby')
  // A form control's name usually comes from its <label for>, which nothing
  // above would find -- and reporting a properly labelled field as "silent"
  // sends the manual pass after a bug that is not there.
  const labelFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null
  const name = (
    el.getAttribute('aria-label') ||
    (labelledby && document.getElementById(labelledby)
      ? document.getElementById(labelledby).textContent
      : '') ||
    (labelFor ? labelFor.textContent : '') ||
    el.innerText ||
    el.textContent ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    ''
  ).replace(/\s+/g, ' ').trim()
  /**
   * The target, not the control.
   *
   * WCAG 2.2 2.5.8 is about the area a pointer can hit, and for a checkbox
   * inside its own <label> that area is the label. Measuring the input's own
   * 16px box reported three failures on a page where every one of those rows
   * is a 24px-tall click target -- the tool was wrong, not the page.
   */
  const label = el.closest('label')
  const r = (label && (el.tagName === 'INPUT' || el.tagName === 'SELECT')
    ? label
    : el
  ).getBoundingClientRect()

  return {
    tag: el.tagName.toLowerCase(),
    href: el.getAttribute('href') || null,
    name: name.slice(0, 110),
    ariaHidden: !!el.closest('[aria-hidden="true"]'),
    ariaDisabled: el.getAttribute('aria-disabled') === 'true',
    /** True when the measured box came from a wrapping label. */
    measuredFromLabel: !!(label && (el.tagName === 'INPUT' || el.tagName === 'SELECT')),
    tabIndex: el.tabIndex,
    outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    ring: !(cs.outlineStyle === 'none' || cs.outlineWidth === '0px'),
    size: [Math.round(r.width), Math.round(r.height)],
    id: el.id || null,
  }
})()`

const HEADINGS = String.raw`Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => {
  const cs = getComputedStyle(h)
  return {
    level: Number(h.tagName[1]),
    text: h.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
    visuallyHidden: cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)',
  }
})`

/**
 * The structural claims this build makes, read back off the rendered page.
 *
 * Each of these is something the outreach says and something a machine can
 * check: tables are real tables with captions and scoped headers, exactly one
 * column advertises a sort, the result count is reached before the filter
 * panel rather than after it, and the chart numbers are reachable as a table.
 */
const STRUCTURE = String.raw`(() => {
  const tables = Array.from(document.querySelectorAll('table')).map((t) => ({
    caption: t.caption ? t.caption.textContent.trim().slice(0, 60) : null,
    columnHeaders: t.querySelectorAll('th[scope="col"]').length,
    rowHeaders: t.querySelectorAll('th[scope="row"]').length,
    // A div pretending to be a table is the thing this is looking for.
    divRows: t.querySelectorAll('div[role="row"]').length,
    rows: t.querySelectorAll('tbody tr').length,
  }))

  const sorted = Array.from(document.querySelectorAll('th[aria-sort]')).map((th) => ({
    label: th.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
    value: th.getAttribute('aria-sort'),
  }))

  /*
    Where the result count sits, in document order, relative to the filter
    form.

    This replaced a probe that recorded every aria-live region on the page.
    That probe passed for weeks on a count that was never once announced:
    applying a filter submits a GET form, the document is replaced, and a live
    region on a freshly loaded page has nothing to announce. Checking that the
    attribute is present measures the marking rather than the behaviour.

    Position is the thing that actually decides whether the reader meets the
    answer, because a screen reader reads a new page from the top. So the
    check is now the ordering, which is falsifiable.
  */
  const countEl = Array.from(document.querySelectorAll('main p')).find((el) =>
    /customers? match|No customers match/.test(el.textContent),
  )
  const form = document.querySelector('main form')
  const resultCount = countEl
    ? {
        text: countEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 90),
        beforeFilters: form
          ? !!(countEl.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING)
          : null,
      }
    : null

  const figures = Array.from(document.querySelectorAll('figure')).map((f) => {
    const img = f.querySelector('[role="img"]')
    return {
      caption: f.querySelector('figcaption')
        ? f.querySelector('figcaption').textContent.trim().replace(/\s+/g, ' ').slice(0, 70)
        : null,
      label: img ? (img.getAttribute('aria-label') || '').slice(0, 70) : null,
      // The SVG internals must be hidden: two hundred rects announced one at a
      // time are worse than silence.
      svgHidden: Array.from(f.querySelectorAll('svg')).every(
        (svg) => svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]'),
      ),
      hasTable: !!f.querySelector('details table'),
    }
  })

  return {
    tables,
    sorted,
    resultCount,
    figures,
    // Structure a screen reader navigates by.
    landmarks: {
      main: document.querySelectorAll('main').length,
      nav: document.querySelectorAll('nav').length,
      header: document.querySelectorAll('body > div > header, body > header').length,
      footer: document.querySelectorAll('footer').length,
    },
    // A table wider than the viewport must scroll inside its own container.
    documentScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    lang: document.documentElement.lang,
    title: document.title,
  }
})()`

const results = []

for (const [label, path] of PAGES) {
  const url = BASE + path
  await goto(url)
  const page = {label, url}

  page.headings = await evaluate(HEADINGS)
  page.structure = await evaluate(STRUCTURE)

  // Skip link. Tab once to reach it, activate it, then check focus actually
  // moved into <main>. A link that only scrolls is the classic failure.
  await evaluate(
    'window.scrollTo(0,0); if (document.activeElement) document.activeElement.blur();',
  )
  await tab()
  page.firstStop = await evaluate(DESCRIBE_FOCUS)

  if (/skip/i.test(page.firstStop.name ?? '')) {
    await enter()
    await new Promise((r) => setTimeout(r, 400))
    page.skipLinkMovesFocus = await evaluate(
      '(() => { const m = document.getElementById("main"); ' +
        'return !!(m && document.activeElement && ' +
        '(m === document.activeElement || m.contains(document.activeElement))); })()',
    )
  }

  // The full tab order, from the top.
  //
  // Reload rather than blur. Activating the skip link moves the sequential
  // focus navigation starting point into <main>, and blur() does not put it
  // back — so tabbing from here would silently skip the header and the nav,
  // which are the first things a keyboard user meets. Only a fresh document
  // resets it.
  await goto(url)
  const stops = []
  const seen = new Set()
  for (let i = 0; i < MAX_TABS; i++) {
    await tab()
    const stop = await evaluate(DESCRIBE_FOCUS)
    if (stop.none) break
    Object.assign(stop, {ax: await accessibleName()})
    const key = stop.tag + '|' + stop.href + '|' + stop.name
    if (seen.has(key) && stops.length > 3) break
    seen.add(key)
    stops.push(stop)
  }

  page.tabStops = stops.length
  // Silent means silent to the accessibility tree, which is the only reader
  // whose opinion counts.
  page.silentStops = stops.filter((s) => !s.ax?.name)
  page.stopsInsideAriaHidden = stops.filter((s) => s.ariaHidden)
  page.stopsWithNoRing = stops.filter((s) => !s.ring)
  page.targetsUnder24px = stops.filter((s) => s.size[1] > 0 && s.size[1] < 24)
  page.order = stops.map((s) => s.ax?.name || '(no accessible name)')

  // The chart tables open from the keyboard. A <summary> is focusable and
  // Enter toggles it natively, but "natively" is worth proving once rather
  // than assuming across a redesign.
  if (page.structure.figures.length > 0) {
    await goto(url)
    for (let i = 0; i < MAX_TABS; i++) {
      await tab()
      const stop = await evaluate(DESCRIBE_FOCUS)
      if (stop.none) break
      if (stop.tag === 'summary') {
        const before = await evaluate(
          '(() => document.activeElement.closest("details").open)()',
        )
        await enter()
        await new Promise((r) => setTimeout(r, 150))
        const after = await evaluate(
          '(() => document.activeElement.closest("details").open)()',
        )
        page.disclosure = {
          reachedByTab: true,
          togglesOnEnter: before !== after,
          tabStopsBefore: i + 1,
        }
        break
      }
    }
    page.disclosure ??= {reachedByTab: false}
  }

  await evaluate(axeSource + ';0')
  page.axeViolations = await evaluate(
    'axe.run(document, {resultTypes:["violations"]}).then(r => r.violations.map(v => ' +
      '({id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, ' +
      'first: v.nodes[0] && v.nodes[0].target ? v.nodes[0].target.join(" ") : ""})))',
  )

  results.push(page)
  process.stderr.write('  swept ' + label + '\n')
}

console.log(JSON.stringify(results, null, 2))

chrome.kill()
try {
  rmSync(profile, {recursive: true, force: true})
} catch {}
