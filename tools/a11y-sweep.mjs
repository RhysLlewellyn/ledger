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
const MAX_TABS = 200

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

/** Resize the emulated viewport. Overrides are lost on navigation, so this is
 *  re-applied rather than set once. */
async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await new Promise((r) => setTimeout(r, 400))
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
    // Page coordinates, for the 2.5.8 spacing exception. Viewport-relative
    // would compare two targets that were never on screen together.
    centre: [Math.round(r.left + scrollX + r.width / 2), Math.round(r.top + scrollY + r.height / 2)],
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
    /*
      Content that overflows the viewport and has nowhere to scroll.

      This replaced "documentElement.scrollWidth > innerWidth", which was a
      check that could not fail. "globals.css" sets "html { overflow-x: clip }",
      and clip pins scrollWidth to clientWidth by definition -- so the probe
      reported "no sideways scroll" on all seven pages for as long as it
      existed, including on a page where three months of both chart axes were
      being drawn outside the viewport with no way to reach them.

      The real question is not whether the document scrolls. It is whether
      anything is unreachable: wider than the viewport, and with no ancestor
      that scrolls. That is what this walks the tree for.
    */
    unreachableOverflow: (() => {
      const scrolls = (el) => {
        const cs = getComputedStyle(el)
        return (
          (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
          el.scrollWidth > el.clientWidth + 1
        )
      }
      const out = []
      for (const el of document.querySelectorAll('main *')) {
        const box = el.getBoundingClientRect()
        if (box.width === 0 || box.right <= window.innerWidth + 1) continue
        // Only leaves, so a wide table does not report every cell inside it.
        if (el.querySelector('*')) continue
        let scroller = null
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (scrolls(p)) {
            scroller = p
            break
          }
        }
        if (!scroller) {
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 40),
            right: Math.round(box.right),
            viewport: window.innerWidth,
          })
        }
      }
      return out.slice(0, 12)
    })(),
    /*
      Scrollable regions a keyboard cannot reach.

      A div with "overflow-x: auto" scrolls with a mouse and not with a
      keyboard, because Chrome only gives arrow keys to a scroller that can
      take focus. Five of the six in this build were unreachable and axe was
      silent, because axe's own rule only fires at a width where the region
      actually overflows -- and this sweep only ever ran at 1280.
    */
    unfocusableScrollers: Array.from(document.querySelectorAll('main *'))
      .filter((el) => {
        const cs = getComputedStyle(el)
        if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') return false
        if (el.scrollWidth <= el.clientWidth + 1) return false
        if (el.tabIndex >= 0) return false
        return !el.querySelector('a[href], button, input, select, textarea, [tabindex]')
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label'),
        overflowBy: el.scrollWidth - el.clientWidth,
      })),
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

  /*
    The same structural probes again at 360.

    Every defect this sweep missed was a defect that only exists at a phone
    width: a chart axis drawn outside the viewport, six scrollable regions a
    keyboard could not reach, a caption clipped inside a data scroller. Running
    only at 1280 is why a clean sheet meant less than it looked like it did.
  */
  await evaluate(axeSource + ';0')
  await setViewport(360, 780)
  page.narrow = await evaluate(STRUCTURE)
  page.narrowAxe = await evaluate(
    'axe.run(document, {resultTypes:["violations"]}).then(r => r.violations.map(v => ' +
      '({id: v.id, impact: v.impact, nodes: v.nodes.length})))',
  )
  await setViewport(1280, 900)
  await goto(url)

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
  /*
    Walk until focus cycles back to the first stop.

    The previous version stopped at the first *repeated* key, which sounds
    equivalent and is not. `<input type="date">` has three internal segments —
    day, month, year — and tabbing between them leaves `document.activeElement`
    on the same input, so the same key comes back three times in a row. That
    looked like a cycle, so the walk stopped dead at the signup-date field.

    It had therefore never reached the customer table: not one of the fifty row
    links, not a sort header, not the pager. Thirty of an eventual eighty-odd
    stops were being measured and reported as the whole tab order, which is
    worse than not measuring it, because it reads as coverage.
  */
  let firstKey = null
  let previousKey = null
  let repeats = 0
  for (let i = 0; i < MAX_TABS; i++) {
    await tab()
    const stop = await evaluate(DESCRIBE_FOCUS)
    if (stop.none) break
    Object.assign(stop, {ax: await accessibleName()})
    const key = stop.tag + '|' + stop.href + '|' + stop.name

    // Same element again: a composite field moving between its own segments.
    // Not a new stop and not a cycle, but it cannot go on forever either.
    if (key === previousKey) {
      repeats += 1
      if (repeats > 6) break
      continue
    }
    repeats = 0
    previousKey = key

    // A real cycle: focus has come back round to where it started.
    if (firstKey === null) firstKey = key
    else if (key === firstKey && stops.length > 3) break

    stops.push(stop)
  }

  page.tabStops = stops.length
  // Silent means silent to the accessibility tree, which is the only reader
  // whose opinion counts.
  page.silentStops = stops.filter((s) => !s.ax?.name)
  page.stopsInsideAriaHidden = stops.filter((s) => s.ariaHidden)
  page.stopsWithNoRing = stops.filter((s) => !s.ring)
  /*
    WCAG 2.5.8 with its spacing exception applied, rather than a bare
    height < 24 test.

    2.5.8 does not require every target to be 24x24. An undersized target
    passes if a 24px circle centred on it does not reach another target's
    circle -- which is to say, if nothing else is close enough to mis-tap.

    Without that, this reported the fifty customer-name links on every run: 18px
    tall, one per table row, thirty-five pixels apart. They are not a failure
    and never were, and fifty standing false positives is how a real one gets
    lost. The row height is what makes them safe, so the check now measures the
    row height.
  */
  const undersized = stops.filter((s) => s.size[1] > 0 && (s.size[1] < 24 || s.size[0] < 24))
  const centres = stops.filter((s) => s.centre).map((s) => s.centre)
  page.targetsUnder24px = undersized.filter((s) => {
    if (!s.centre) return true
    const near = centres.filter((c) => {
      const dx = c[0] - s.centre[0]
      const dy = c[1] - s.centre[1]
      const d = Math.hypot(dx, dy)
      return d > 0 && d < 24
    })
    return near.length > 0
  })
  // Kept separately so the number is still visible rather than silently
  // absorbed: these are under 24px and pass only on spacing.
  page.targetsUnder24pxPassingOnSpacing = undersized.length - page.targetsUnder24px.length
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
