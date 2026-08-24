/**
 * The README's screenshots, regenerated rather than remembered.
 *
 * A screenshot in a repository goes stale the day after it is taken and there
 * is nothing to tell you it has. This takes them from a running instance, at
 * one fixed viewport and one fixed date, so re-running it after an interface
 * change produces a comparable set rather than a differently-cropped one.
 *
 * Usage: node tools/screenshots.mjs [baseUrl]
 * Writes to docs/. Needs Chrome installed and the server running.
 */
import {spawn} from 'node:child_process'
import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3003'
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9225
const OUT = 'docs'

/**
 * The dataset is generated from a fixed seed and the report has a fixed as-at
 * date, so nothing here needs pinning to make two runs comparable -- which is
 * a small dividend of the seed being deterministic.
 *
 * The mobile shots are 360px because that is the width the charts were
 * required to stay readable at, and a screenshot at 420 would be quietly
 * failing to test the claim.
 */
const SHOTS = [
  ['overview', '/', 1280, 1100],
  ['customers', '/customers', 1280, 1100],
  ['customers-filtered', '/customers?country=GB&status=active&plan=enterprise&sort=mrr', 1280, 900],
  ['customer-detail', '/customers/ardent-analytics-ab', 1280, 1000],
  ['cohorts', '/cohorts', 1280, 1000],
  ['overview-mobile', '/', 360, 900],
  ['customers-mobile', '/customers', 360, 900],
  ['cohorts-mobile', '/cohorts', 360, 700],
]

mkdirSync(OUT, {recursive: true})

const profile = join(tmpdir(), 'shots-' + process.pid)
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--hide-scrollbars',
  '--force-device-scale-factor=2',
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

const root = connect(await endpoint())
await root.ready
const {targetId} = await root.send('Target.createTarget', {url: 'about:blank'})
const {sessionId} = await root.send('Target.attachToTarget', {targetId, flatten: true})
const send = (m, p) => root.send(m, p, sessionId)

await send('Page.enable')

for (const [name, path, width, height] of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: width < 700,
  })

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
  await send('Page.navigate', {url: BASE + path})
  await loaded
  // Web fonts, or the type in the shot is the fallback stack.
  await new Promise((r) => setTimeout(r, 2000))

  const {data} = await send('Page.captureScreenshot', {format: 'png'})
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'))
  process.stderr.write('  wrote ' + join(OUT, name + '.png') + '\n')
}

chrome.kill()
try {
  rmSync(profile, {recursive: true, force: true})
} catch {}
