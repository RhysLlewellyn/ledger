/**
 * Cumulative layout shift, measured here rather than quoted from Lighthouse.
 *
 * The README and the sign-off both claim CLS 0 on every route. That number came
 * out of Lighthouse, which is a fine place to get it and a bad place to leave
 * it: nothing in this repo could reproduce the claim, so a reader had to take it
 * on trust. Every other measured claim in this build has a script behind it —
 * `tools/measure.ts` for the queries, `tools/contrast.ts` for the palette,
 * `tools/a11y-sweep.mjs` for the keyboard and the accessibility tree — and this
 * one did not.
 *
 * It also would have caught the defect that produced the claim in the first
 * place. These pages stream: the shell and `loading.tsx` flush immediately and
 * the real page replaces them when Postgres answers. If the fallback is not the
 * height of what replaces it, the footer moves. For most of this build's life it
 * was not — the overview reserved 504px against 1,746px of content — and CLS was
 * nonetheless zero, because on a fast connection the query came back before the
 * fallback ever painted. The shift was always available and the race kept
 * hiding it.
 *
 * So this does not measure the happy path. It throttles the network hard enough
 * that the fallback is guaranteed to paint, which turns an intermittent shift
 * into a deterministic one. A number from here is a worst case, and a zero from
 * here means the fallback genuinely is the right height rather than merely
 * usually being too fast to catch.
 *
 * Reports every shift over the threshold with the element that moved, because
 * "CLS 0.04" is a grade and "the footer moved 1,242px when the skeleton was
 * replaced" is a bug report.
 *
 * Verified by putting the defect back. With the overview's fallback returned to
 * the 14 rows it briefly had, this reports 0.5677 on the desktop pass and names
 * the footer moving -766px, and exits 1. Worth knowing that it caught it on
 * desktop and not on mobile: CLS scores the shift of what is *visible*, the
 * phone viewport is taller relative to the page, and a footer that was below the
 * fold before the swap and below it after has not visibly moved. So the desktop
 * pass is the sensitive one for anything near the bottom of a long page, and
 * running only the mobile viewport would be a weaker check than it looks.
 *
 * Usage: node tools/cls.mjs [baseUrl]
 * Needs Chrome installed and the dev or production server running.
 */
import {spawn} from 'node:child_process'
import {rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3003'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9227

const PAGES = [
  ['overview', '/'],
  ['customers', '/customers'],
  ['customers-filtered', '/customers?country=GB&status=active&sort=name&dir=asc'],
  ['cohorts', '/cohorts'],
  ['customer-detail', '/customers/ardent-analytics-ab'],
]

/**
 * Lighthouse's mobile emulation, because that is where the quoted number comes
 * from and because a phone is the device this build is written for. The desktop
 * pass runs second: a page whose prose wraps less is a shorter page, so a
 * fallback sized for a phone over-reserves on a wide screen, and that shifts
 * too — in the other direction.
 */
const VIEWPORTS = [
  ['mobile', {width: 412, height: 823, deviceScaleFactor: 1, mobile: true}],
  ['desktop', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false}],
]

/**
 * Slow enough that the streamed fallback always paints before the query lands.
 *
 * Roughly Lighthouse's "Slow 4G", which is not a claim about anybody's real
 * connection. It is a way of making the race resolve the same way every run, so
 * that a zero here is a fact about the layout instead of a fact about how fast
 * the database happened to be.
 */
const THROTTLE = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
}

/** Shifts below this are rounding, not movement. */
const NOISE = 0.0001

const profile = join(tmpdir(), 'ledger-cls-' + process.pid)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run',
  'about:blank',
])

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

/** The same minimal CDP client the accessibility sweep uses. */
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

/**
 * Installed before navigation, so it is already listening when the first frame
 * paints. An observer added after load has missed the shift it exists to catch.
 *
 * `hadRecentInput` filters shifts a user asked for by scrolling or typing.
 * Nothing here takes input, so anything left is the page moving on its own.
 * `sources` names the elements that actually moved, which is the difference
 * between a score and something you can go and fix.
 */
const OBSERVER = `
  window.__cls = {total: 0, entries: []}
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue
      window.__cls.total += entry.value
      window.__cls.entries.push({
        value: entry.value,
        at: Math.round(entry.startTime),
        sources: (entry.sources || []).map((s) => {
          const el = s.node
          const name = el && el.tagName
            ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
              (el.className && typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\\s+/)[0] : '')
            : 'unknown'
          const from = s.previousRect || {}
          const to = s.currentRect || {}
          return {el: name, movedY: Math.round((to.y || 0) - (from.y || 0))}
        }),
      })
    }
  }).observe({type: 'layout-shift', buffered: true})
`

const root = connect(await endpoint())
await root.ready

let worst = 0
const failures = []

try {
  for (const [viewportName, metrics] of VIEWPORTS) {
    console.log(`\n${viewportName}  (${metrics.width}x${metrics.height}, throttled)`)

    for (const [name, path] of PAGES) {
      // A fresh tab per page: a reused one carries its predecessor's paint
      // state, and the whole measurement is about the first paint.
      const {targetId} = await root.send('Target.createTarget', {url: 'about:blank'})
      const {sessionId} = await root.send('Target.attachToTarget', {targetId, flatten: true})
      const send = (m, p) => root.send(m, p, sessionId)

      await send('Page.enable')
      await send('Runtime.enable')
      await send('Network.enable')
      await send('Emulation.setDeviceMetricsOverride', metrics)
      await send('Network.emulateNetworkConditions', THROTTLE)
      await send('Page.addScriptToEvaluateOnNewDocument', {source: OBSERVER})

      await send('Page.navigate', {url: BASE + path})
      // Long enough for the throttled document, the streamed replacement, and
      // the fonts to have all arrived and done whatever moving they are doing.
      await new Promise((r) => setTimeout(r, 12000))

      const {result} = await send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__cls)',
        returnByValue: true,
      })
      const cls = JSON.parse(result.value ?? '{"total":0,"entries":[]}')
      const total = cls.total

      if (total > worst) worst = total
      const verdict = total <= NOISE ? 'ok  ' : total < 0.1 ? 'note' : 'FAIL'
      if (total > NOISE) failures.push({viewportName, name, total, entries: cls.entries})

      console.log(`  ${verdict}  ${total.toFixed(4).padStart(8)}  ${name}`)
      for (const entry of cls.entries) {
        if (entry.value <= NOISE) continue
        const moved = entry.sources
          .map((s) => `${s.el} moved ${s.movedY > 0 ? '+' : ''}${s.movedY}px`)
          .join(', ')
        console.log(`            ${entry.value.toFixed(4)} at ${entry.at}ms — ${moved || 'no source'}`)
      }

      await root.send('Target.closeTarget', {targetId})
    }
  }
} finally {
  chrome.kill()
  try {
    rmSync(profile, {recursive: true, force: true})
  } catch {
    // A locked profile directory is not a reason to fail a measurement.
  }
}

console.log(
  `\nWorst CLS across ${PAGES.length} pages x ${VIEWPORTS.length} viewports: ${worst.toFixed(4)}`,
)
console.log('Good is under 0.1. This build claims 0, so anything above noise is a regression.')

// Non-zero exit on any real shift, so this can gate a change the way the test
// suite does rather than being a thing somebody remembers to read.
if (failures.length > 0) {
  console.error(`\n${failures.length} page/viewport combination(s) shifted.`)
  process.exit(1)
}
process.exit(0)
