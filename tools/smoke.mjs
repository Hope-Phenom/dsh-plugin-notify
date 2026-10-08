/**
 * End-to-end smoke test for @hope_phenom/dsh-plugin-notify.
 *
 * It exercises the plugin the way DSH will, without installing anything:
 *
 *   A. the Host half's data route, served over a real HTTP server and driven
 *      with real `fetch` calls (snapshot, detect, save, preview, test);
 *   B. the turn/end pipeline, with a stubbed process runner and optionally a
 *      real desktop notification (`--notify`);
 *   C. the browser half, loaded through a fake module loader and rendered with
 *      a minimal hook shim, using a strict locale reader so a missing
 *      dictionary key fails the run.
 *
 * Usage: node tools/smoke.mjs [--notify] [--keep]
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NOTIFY_ROUTE,
  createState,
  deliver,
  detectPowershell,
  detectPython,
  handleSessionEvent,
  makeRoute,
  refreshProbes,
  sampleEvent,
} from '../lib/index.js'

const argv = process.argv.slice(2)
const wantNotify = argv.includes('--notify')
const keepTemp = argv.includes('--keep')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
/** The real fetch, captured before the browser-half shim replaces the global. */
const nativeFetch = fetch

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}`)
    console.log(`       ${error instanceof Error ? error.message : String(error)}`)
  }
}
const section = (title) => console.log(`\n${title}`)
const settle = (ms = 60) => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

/* ------------------------------------------------------------------ *
 * Part A: the Host route, over a real HTTP server
 * ------------------------------------------------------------------ */

const home = mkdtempSync(join(tmpdir(), 'dsh-notify-smoke-'))
const env = { ...process.env, DSH_HOME: home }
const stubCalls = []
const state = createState({
  env,
  locale: 'zh-CN',
  detectPython,
  detectPowershell,
  runProcess: async (executable, processArgv, options) => {
    stubCalls.push({ executable, argv: processArgv, timeoutMs: options?.timeoutMs })
    return { ok: true, exitCode: 0, killed: false, stdout: 'stub', stderr: '', error: '' }
  },
})

const server = createServer((req, res) => { void makeRoute(state, { logger: console }).handler(req, res) })
await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
const base = `http://127.0.0.1:${server.address().port}`
const post = (action, payload) => nativeFetch(base + NOTIFY_ROUTE, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action, ...(payload ?? {}) }),
}).then(response => response.json())
const get = () => nativeFetch(base + NOTIFY_ROUTE).then(response => response.json())

section('A. Host route')
const snapshot = await get()
check('GET returns a complete snapshot', () => {
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.settings.enabled, true)
  assert.equal(snapshot.settings.channel, 'auto')
  assert.equal(snapshot.storage.file, join(home, 'storages', 'dsh-plugin-notify', 'settings.json'))
  assert.ok(Array.isArray(snapshot.placeholders) && snapshot.placeholders.includes('{message}'))
  assert.match(snapshot.scripts.python, /scripts[\\/]notify\.py$/)
  assert.equal(snapshot.scripts.pythonExists, true)
  assert.equal(snapshot.scripts.powershellExists, true)
})
check('Python and PowerShell are detected on this machine', () => {
  assert.equal(typeof snapshot.python.available, 'boolean')
  assert.equal(typeof snapshot.powershell.available, 'boolean')
  if (snapshot.python.available) assert.match(snapshot.python.version, /^\d+\./)
  console.log(`       python:     ${snapshot.python.available ? `${snapshot.python.executable} ${snapshot.python.version}` : 'not found'}`)
  console.log(`       powershell: ${snapshot.powershell.available ? `${snapshot.powershell.executable} ${snapshot.powershell.version}` : 'not found'}`)
})

const saved = await post('save', { settings: { ...snapshot.settings, enabled: false, channel: 'custom', minDurationMs: '250', custom: { command: 'pwsh.exe', args: '-File {script} -Message {message}' } } })
check('POST save normalizes and persists', () => {
  assert.equal(saved.ok, true)
  assert.equal(saved.settings.enabled, false)
  assert.equal(saved.settings.channel, 'custom')
  assert.equal(saved.settings.minDurationMs, 250)
  const onDisk = JSON.parse(readFileSync(join(home, 'storages', 'dsh-plugin-notify', 'settings.json'), 'utf8'))
  assert.equal(onDisk.channel, 'custom')
  assert.equal(onDisk.minDurationMs, 250)
  assert.equal(onDisk.python.args, snapshot.defaults.python.args, 'blank argument templates keep their default')
})

const preview = await post('preview', { settings: { ...saved.settings, titleTemplate: '', messageTemplate: '' } })
check('POST preview composes localized text', () => {
  assert.equal(preview.ok, true)
  assert.equal(preview.title, 'DSH 回答完成')
  assert.match(preview.message, /DSH notify plugin test/)
  assert.match(preview.message, /#1 · 已完成 · 12\.3 s/)
})

const tested = await post('test', { settings: saved.settings })
check('POST test delivers through the configured channel', () => {
  assert.equal(tested.ok, true)
  assert.equal(tested.report.channel, 'custom')
  assert.equal(tested.report.executable, 'pwsh.exe')
  assert.deepEqual(tested.report.argv, ['-File', '{script}', '-Message', tested.report.message])
  assert.equal(tested.snapshot.stats.deliveries, 1)
})

const detected = await post('detect', { pythonExecutable: '' })
check('POST detect forces a fresh probe', () => {
  assert.equal(detected.ok, true)
  assert.ok(detected.python.checkedAt >= snapshot.python.checkedAt)
})

const reset = await post('reset')
check('POST reset restores defaults', () => {
  assert.equal(reset.ok, true)
  assert.deepEqual(reset.settings, snapshot.defaults)
})

const rejected = await nativeFetch(base + NOTIFY_ROUTE, { method: 'PUT' }).then(response => response.json())
check('unsupported method is rejected', () => assert.equal(rejected.error, 'method-not-allowed'))
const crossSite = await nativeFetch(base + NOTIFY_ROUTE, { headers: { 'sec-fetch-site': 'cross-site' } }).then(response => response.json())
check('cross-site requests are rejected', () => assert.equal(crossSite.error, 'cross-site-request-rejected'))
const unknown = await post('nope')
check('unknown action is rejected', () => assert.equal(unknown.error, 'unknown-action'))

/* ------------------------------------------------------------------ *
 * Part B: the turn/end pipeline
 * ------------------------------------------------------------------ */

section('B. Turn/end pipeline')
state.settings = { ...snapshot.settings, channel: 'custom', custom: { command: 'notify.exe', args: '{message}' }, minDurationMs: 0, includeSubagents: false }
state.python = { available: true, executable: 'python', version: '3.12.0' }
state.powershell = { available: true, executable: 'pwsh', version: '7.4.0' }
const ctx = { logger: { info() {}, warn() {}, error() {} } }
const rootSession = { id: 'session-root', header: { origin: undefined, cwd: 'F:\\WorkSpace\\demo' } }
const subSession = { id: 'session-sub', header: { origin: 'subagent', parentSession: 'session-root', cwd: 'F:\\WorkSpace\\demo' } }

stubCalls.length = 0
handleSessionEvent(state, ctx, rootSession, { type: 'turn/start', time: 1_000, data: { turn: 2 } })
handleSessionEvent(state, ctx, rootSession, { type: 'session/title', data: { title: 'Fix the build' } })
handleSessionEvent(state, ctx, rootSession, { type: 'turn/end', time: 3_500, data: { turn: 2, reason: { kind: 'completed' } } })
await settle()
check('a root turn end notifies once with the measured duration', () => {
  assert.equal(stubCalls.length, 1)
  assert.equal(stubCalls[0].executable, 'notify.exe')
  assert.match(stubCalls[0].argv[0], /Fix the build/)
  assert.match(stubCalls[0].argv[0], /2\.5 s/)
})

stubCalls.length = 0
handleSessionEvent(state, ctx, subSession, { type: 'turn/start', time: 10_000, data: { turn: 1 } })
handleSessionEvent(state, ctx, subSession, { type: 'turn/end', time: 10_500, data: { turn: 1, reason: { kind: 'completed' } } })
await settle()
check('subagent turns stay silent by default', () => assert.equal(stubCalls.length, 0))

state.settings = { ...state.settings, includeSubagents: true }
handleSessionEvent(state, ctx, subSession, { type: 'turn/start', time: 20_000, data: { turn: 2 } })
handleSessionEvent(state, ctx, subSession, { type: 'turn/end', time: 21_000, data: { turn: 2, reason: { kind: 'aborted' } } })
await settle()
check('subagent turns notify once enabled', () => {
  assert.equal(stubCalls.length, 1)
  assert.equal(state.lastDelivery.title, 'DSH 子任务完成')
  assert.match(state.lastDelivery.message, /已中止/)
  assert.match(state.lastDelivery.message, /1\.0 s/)
})

stubCalls.length = 0
state.settings = { ...state.settings, enabled: false }
handleSessionEvent(state, ctx, rootSession, { type: 'turn/start', time: 30_000, data: { turn: 3 } })
handleSessionEvent(state, ctx, rootSession, { type: 'turn/end', time: 33_000, data: { turn: 3, reason: { kind: 'completed' } } })
await settle()
check('the master switch silences everything', () => assert.equal(stubCalls.length, 0))

state.settings = { ...state.settings, enabled: true, minDurationMs: 5_000 }
stubCalls.length = 0
handleSessionEvent(state, ctx, rootSession, { type: 'turn/start', time: 40_000, data: { turn: 4 } })
handleSessionEvent(state, ctx, rootSession, { type: 'turn/end', time: 41_000, data: { turn: 4, reason: { kind: 'completed' } } })
await settle()
check('turns shorter than the minimum stay silent', () => assert.equal(stubCalls.length, 0))
state.settings = { ...state.settings, minDurationMs: 0 }

if (wantNotify) {
  section('B2. Real desktop notification (--notify)')
  const live = createState({ env, locale: 'zh-CN' })
  live.settings = { ...snapshot.settings, channel: 'auto' }
  await refreshProbes(live, { force: true })
  const report = await deliver(live, sampleEvent(), live.settings)
  check('the real channel delivers', () => assert.equal(report.ok, true, `error: ${report.error}`))
  console.log(`       channel: ${report.channel}`)
  console.log(`       command: ${report.executable} ${report.argv.join(' ')}`)
  if (report.output) console.log(`       output:  ${report.output}`)
}

/* ------------------------------------------------------------------ *
 * Part C: the browser half, rendered with a hook shim
 * ------------------------------------------------------------------ */

section('C. Browser half')

const clientSource = readFileSync(join(packageRoot, 'lib', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

check('the client factory id matches the package name and uses the Host route', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(clientSource.includes(`id: '${manifest.name}'`))
  assert.ok(clientSource.includes("const ROUTE = '/api/dsh/dsh-plugin-notify'"))
  assert.equal(manifest.name, '@hope_phenom/dsh-plugin-notify')
})

/** Minimal React: element objects plus a single-component hook runtime. */
function createHooks() {
  const store = []
  let cursor = 0
  let dirty = false
  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false),
      }
    },
    useState(initial) {
      const index = cursor++
      if (store[index] === undefined) store[index] = typeof initial === 'function' ? initial() : initial
      return [store[index], (value) => {
        const next = typeof value === 'function' ? value(store[index]) : value
        if (next !== store[index]) {
          store[index] = next
          dirty = true
        }
      }]
    },
    useCallback(fn) {
      const index = cursor++
      if (store[index] === undefined) store[index] = fn
      return store[index]
    },
    useEffect(fn) {
      const index = cursor++
      if (store[index] === undefined) {
        store[index] = true
        fn()
      }
    },
  }
  Object.defineProperty(React, 'dirty', { get: () => dirty })
  React.beginRender = () => { cursor = 0; dirty = false }
  return React
}

function walk(node, visit) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ text: String(node) })
    return
  }
  visit(node)
  // The shim has no reconciler, so function components are evaluated here.
  if (typeof node.type === 'function') {
    walk(node.type({ ...node.props, children: node.children }), visit)
    return
  }
  for (const child of node.children ?? []) walk(child, visit)
}

function collectText(node) {
  const parts = []
  walk(node, (entry) => { if (entry.text !== undefined) parts.push(entry.text) })
  return parts.join(' ')
}

function findByClass(node, className) {
  let found = null
  walk(node, (entry) => {
    const value = entry.props?.className
    if (found === null && typeof value === 'string' && value.split(' ').includes(className)) found = entry
  })
  return found
}

const React = createHooks()
let lang = 'zh'
const dictionaries = {}
let registration = null
let component = null

global.window = {
  confirm: () => true,
  __ModuleLoader__: {
    load(entry) {
      const exported = entry.factory((specifier) => {
        assert.equal(specifier, 'react', 'the client half may only require react')
        return React
      })
      assert.equal(typeof exported.apply, 'function')
      assert.deepEqual(exported.inject, ['slots', 'locale'], 'only platform services are required')
      exported.apply({
        effect: (fn) => { fn() },
        locale: {
          register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
          bind: (ns) => (key, params) => {
            const dict = dictionaries[ns]?.[lang]
            assert.ok(dict, `no dictionary registered for ${ns}`)
            const value = dict[key]
            assert.ok(value !== undefined, `missing ${lang} string for "${key}"`)
            if (params === undefined) return value
            return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => (name in params ? String(params[name]) : match))
          },
        },
        slots: {
          register: (options, registeredComponent) => ({ options, component: registeredComponent }),
          inject: (slot, register) => {
            assert.equal(slot, 'settings.section')
            registration = register()
          },
        },
      })
      assert.equal(entry.id, manifest.name, 'the loader id must be the package name')
    },
  },
}
global.fetch = (url, init) => nativeFetch(base + url, init)

const loadClient = new Function('window', clientSource) // eslint-disable-line no-new-func
loadClient(global.window)

check('the client half loads and registers its Settings section', () => {
  assert.ok(registration, 'the section was registered')
  assert.equal(registration.options.name, 'settings.section')
  assert.equal(registration.options.id, 'dsh-plugin-notify')
  assert.equal(typeof registration.options.label, 'function')
  assert.equal(typeof registration.component, 'function')
  assert.ok(dictionaries['dsh-plugin-notify'], 'dictionaries were registered')
  component = registration.component
})

/** Strict locale reader: an unknown key fails the run. */
const t = (key, params) => {
  const dict = dictionaries['dsh-plugin-notify']?.[lang]
  assert.ok(dict, `no dictionary for ${lang}`)
  const value = dict[key]
  assert.ok(value !== undefined, `missing ${lang} string for "${key}"`)
  if (params === undefined) return value
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

/** Render, let effects/fetch settle, and re-render while state changes. */
async function renderSettled(props) {
  React.beginRender()
  let current = component(props)
  for (let pass = 0; pass < 8; pass += 1) {
    await settle(90)
    if (process.env.SMOKE_DEBUG === '1') console.log(`       [debug] pass ${pass} dirty=${React.dirty}`)
    if (!React.dirty) break
    React.beginRender()
    current = component(props)
  }
  return current
}

// A known configuration, so the rendered page is checked against fixed values.
await post('save', {
  settings: {
    ...snapshot.defaults,
    enabled: false,
    includeSubagents: true,
    channel: 'custom',
    custom: { command: 'pwsh.exe', args: '-File {script} -Message {message}' },
  },
})

const tree = await renderSettled({ t, close: () => {} })
const text = collectText(tree)
lang = 'en'
const englishText = collectText(await renderSettled({ t, close: () => {} }))
lang = 'zh'

check('the page renders its loaded Chinese state', () => {
  assert.match(text, /通知时机/)
  assert.match(text, /通知通道/)
  assert.match(text, /实际生效/)
  assert.match(text, /可用占位符/)
  assert.match(text, /启用通知/)
  assert.match(text, /子代理\/子任务完成时也通知/)
  assert.ok(findByClass(tree, 'np-switch'), 'the master switch is rendered')
  assert.ok(findByClass(tree, 'np-input'), 'text inputs are rendered')
  assert.ok(findByClass(tree, 'np-seg'), 'the channel selector is rendered')
})
check('the route panel reflects the saved configuration', () => {
  assert.match(text, /pwsh\.exe/, 'the saved custom command is shown')
  assert.match(text, /自定义命令/)
})
check('the switches reflect the saved values', () => {
  const switches = []
  walk(tree, (entry) => { if (entry.props?.role === 'switch') switches.push(entry) })
  assert.equal(switches.length, 2, 'enable + subagent switches')
  assert.equal(switches[0].props['aria-checked'], 'false', 'notifications are disabled in the saved settings')
  assert.equal(switches[1].props['aria-checked'], 'true', 'subagent notifications are enabled in the saved settings')
})
check('a second language renders every string', () => {
  const en = dictionaries['dsh-plugin-notify'].en
  const zh = dictionaries['dsh-plugin-notify'].zh
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'both dictionaries carry identical keys')
  assert.match(englishText, /Delivery channel/)
  assert.match(englishText, /Effective route/)
  assert.match(englishText, /Available placeholders/)
})
check('the save button starts disabled before any edit', () => {
  const saveButton = findByClass(tree, 'primary')
  assert.ok(saveButton, 'a primary button is rendered')
  assert.equal(saveButton.props.disabled, true, 'no unsaved changes at first render')
})
check('the section label follows the language', () => {
  assert.equal(registration.options.label(), '通知')
  lang = 'en'
  assert.equal(registration.options.label(), 'Notifications')
  lang = 'zh'
})

/* ------------------------------------------------------------------ *
 * Cleanup
 * ------------------------------------------------------------------ */

await new Promise(resolvePromise => server.close(resolvePromise))
if (keepTemp) console.log(`\ntemp home kept at ${home}`)
else rmSync(home, { recursive: true, force: true })

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
