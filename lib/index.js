/**
 * Host half of @hope_phenom/dsh-plugin-notify.
 *
 * Responsibilities:
 *  - keep the plugin's own settings file under `$DSH_HOME/storages/`;
 *  - watch `session/event` and deliver one notification per finished turn;
 *  - probe for a Python interpreter and a PowerShell host;
 *  - serve the Settings page's data route (`/api/dsh/dsh-plugin-notify`).
 *
 * It imports nothing from `@deepseek-ai/*`: a profile-installed bundle cannot
 * resolve those packages at runtime, so the plugin depends only on Node
 * builtins and its own files.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS,
  PLACEHOLDERS,
  composeNotification,
  defaultSettings,
  describeRunFailure,
  normalizeSettings,
  resolveDelivery,
} from './core.js'

export const name = 'dsh-plugin-notify'

/** Absolute path of the package root (this file lives in `<root>/lib`). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Path of the data route the browser half talks to. */
export const NOTIFY_ROUTE = '/api/dsh/dsh-plugin-notify'
/** Bundled notifier scripts, used whenever the settings leave a path blank. */
export const BUNDLED_SCRIPTS = {
  python: join(PACKAGE_ROOT, 'scripts', 'notify.py'),
  powershell: join(PACKAGE_ROOT, 'scripts', 'notify.ps1'),
}
const PROBE_TTL_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024

/** Resolve the harness home the same way the shipped host packages do. */
export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured)
}

/** Where this plugin keeps its settings. */
export function settingsPath(env = process.env) {
  return join(resolveDshHome(env), 'storages', 'dsh-plugin-notify', 'settings.json')
}

/** Detect the locale used for default notification text. */
function systemLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? 'en'
  } catch {
    return 'en'
  }
}

function log(ctx, level, message, error) {
  const target = ctx?.logger?.[level]
  if (typeof target === 'function') {
    if (error === undefined) target.call(ctx.logger, message)
    else target.call(ctx.logger, message, error)
    return
  }
  const sink = level === 'error' || level === 'warn' ? console.warn : console.log
  sink(`[dsh-plugin-notify] ${message}`, error ?? '')
}

/**
 * Read settings from disk, falling back to defaults on anything unreadable.
 * @param {NodeJS.ProcessEnv} env - environment used to resolve `$DSH_HOME`.
 * @returns {{ settings: ReturnType<typeof defaultSettings>, file: string, error: string }}
 */
export function readSettings(env = process.env) {
  const file = settingsPath(env)
  try {
    if (!existsSync(file)) return { settings: defaultSettings(), file, error: '' }
    return { settings: normalizeSettings(JSON.parse(readFileSync(file, 'utf8'))), file, error: '' }
  } catch (error) {
    return {
      settings: defaultSettings(),
      file,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Write settings atomically (temp file + rename) so a crash can never leave a
 * half-written file behind.
 * @param {unknown} settings - settings to persist; normalized before writing.
 * @param {NodeJS.ProcessEnv} env - environment used to resolve `$DSH_HOME`.
 * @returns {ReturnType<typeof defaultSettings>} the normalized settings written.
 */
export function writeSettings(settings, env = process.env) {
  const normalized = normalizeSettings(settings)
  const file = settingsPath(env)
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true })
  const temporary = `${file}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      /* the temp file is best-effort cleanup */
    }
    throw error
  }
  return normalized
}

/**
 * Run one process and always resolve, so callers can report failures.
 * @param {string} executable - program to run.
 * @param {string[]} argv - arguments.
 * @param {{ timeoutMs?: number, cwd?: string }} options - run options.
 * @returns {Promise<{ ok: boolean, exitCode: number|null, killed: boolean, stdout: string, stderr: string, error: string }>}
 */
export function runProcess(executable, argv, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const isWindowsBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
  const file = isWindowsBatch ? process.env.ComSpec || 'cmd.exe' : executable
  const args = isWindowsBatch ? ['/d', '/s', '/c', executable, ...argv] : argv
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }
    try {
      execFile(
        file,
        args,
        {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          killSignal: 'SIGKILL',
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        },
        (error, stdout, stderr) => {
          const out = String(stdout ?? '')
          const err = String(stderr ?? '')
          if (error === null || error === undefined) {
            finish({ ok: true, exitCode: 0, killed: false, stdout: out, stderr: err, error: '' })
            return
          }
          const killed = /** @type {any} */ (error).killed === true
          finish({
            ok: false,
            exitCode: typeof /** @type {any} */ (error).code === 'number' ? /** @type {any} */ (error).code : null,
            killed,
            stdout: out,
            stderr: err,
            error: describeRunFailure({ .../** @type {any} */ (error), stderr: err }),
          })
        },
      )
    } catch (error) {
      finish({
        ok: false,
        exitCode: null,
        killed: false,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

/** Interpreter candidates probed in order when Python is left on auto. */
const PYTHON_CANDIDATES = ['python', 'python3', 'py']

/**
 * List the paths the OS reports for a bare program name.
 * @param {string} executable - program name, without a path separator.
 * @returns {Promise<string[]>} matches in `PATH` order, empty when absent.
 */
async function resolveOnPath(executable) {
  const [command, argv] = process.platform === 'win32'
    ? ['where.exe', [executable]]
    : ['which', ['-a', executable]]
  const result = await runProcess(command, argv, { timeoutMs: 5000 })
  if (!result.ok) return []
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/**
 * Whether a resolved path is a placeholder rather than a real interpreter.
 *
 * Windows ships `python.exe` aliases that open the Microsoft Store, and macOS
 * ships `/usr/bin/python3` shims that prompt to install the command line
 * tools. Running either is a side effect the user never asked for, so such a
 * path is never probed.
 * @param {string} path - a path reported by the OS.
 * @param {boolean} systemPathsUsable - on macOS, whether the Command Line
 *   Tools are installed, which is what makes `/usr/bin` interpreters real.
 * @returns {boolean} true when the path must not be executed.
 */
function isPlaceholderExecutable(path, systemPathsUsable) {
  if (process.platform === 'win32') return /[\\/]WindowsApps[\\/]/i.test(path)
  if (process.platform === 'darwin' && !systemPathsUsable) return /^\/usr\/bin\//.test(path)
  return false
}

/** Cached answer of {@link hasCommandLineTools}. */
let commandLineTools

/**
 * macOS: are the Command Line Tools installed? `/usr/bin/python3` is a shim
 * that offers to install them, and only when they are missing.
 * @returns {Promise<boolean>} whether `/usr/bin` interpreters can be trusted.
 */
async function hasCommandLineTools() {
  if (commandLineTools !== undefined) return commandLineTools
  const result = await runProcess('xcode-select', ['-p'], { timeoutMs: 5000 })
  commandLineTools = result.ok && result.stdout.trim() !== ''
  return commandLineTools
}

/**
 * Probe one Python executable.
 * @param {string} executable - program name or absolute path.
 * @param {{ timeoutMs?: number, skipPathCheck?: boolean }} [options] - probe options.
 * @returns {Promise<{ available: boolean, executable: string, version: string, error: string }>}
 */
export async function probePythonExecutable(executable, options = {}) {
  const result = await runProcess(executable, ['--version'], { timeoutMs: options.timeoutMs ?? 5000 })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  const version = /Python\s+([0-9][0-9.]*)/i.exec(output)?.[1] ?? ''
  if (!result.ok) {
    return {
      available: false,
      executable: '',
      version: '',
      error: result.error === '' ? 'not-runnable' : result.error,
    }
  }
  return { available: true, executable, version, error: '' }
}

/**
 * Find a usable Python: the configured path first, then `python`, `python3`,
 * `py` from `PATH`.
 *
 * On Windows and macOS a bare name is resolved with `where.exe` / `which -a`
 * first, placeholders are dropped, and the first real path is probed directly —
 * a name whose `PATH` order starts with a Store alias or a system shim would
 * otherwise trigger a Store page or an "install developer tools" dialog.
 * @param {{ executable?: string, timeoutMs?: number }} [request] - optional override.
 * @returns {Promise<object>} probe report, including every candidate tried.
 */
export async function detectPython(request = {}) {
  const configured = typeof request.executable === 'string' ? request.executable.trim() : ''
  const candidates = configured === '' ? PYTHON_CANDIDATES : [configured]
  const tried = []
  const systemPathsUsable = process.platform !== 'darwin' || await hasCommandLineTools()
  for (const candidate of candidates) {
    let executable = candidate
    if (!/[\\/]/.test(candidate) && process.platform !== 'linux') {
      const resolved = await resolveOnPath(candidate)
      const usable = resolved.filter(path => !isPlaceholderExecutable(path, systemPathsUsable))
      if (usable.length === 0) {
        tried.push({
          executable: candidate,
          available: false,
          version: '',
          error: resolved.length === 0 ? 'not-on-path' : 'placeholder-only',
        })
        continue
      }
      executable = usable[0]
    }
    const probe = await probePythonExecutable(executable, request)
    tried.push({
      executable: candidate,
      ...(executable === candidate ? {} : { resolved: executable }),
      available: probe.available,
      version: probe.version,
      error: probe.error,
    })
    if (probe.available) {
      return {
        available: true,
        executable: probe.executable,
        version: probe.version,
        source: configured === '' ? 'path' : 'configured',
        tried,
        error: '',
        checkedAt: Date.now(),
      }
    }
  }
  return {
    available: false,
    executable: '',
    version: '',
    source: 'none',
    tried,
    error: tried[tried.length - 1]?.error ?? 'python-not-found',
    checkedAt: Date.now(),
  }
}

/** Well-known PowerShell locations, used when neither `pwsh` nor `powershell` is on PATH. */
function powershellFallbacks() {
  if (process.platform !== 'win32') return []
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  return [
    join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
  ]
}

/**
 * Find a PowerShell host: `pwsh` first (7+), then Windows PowerShell, then the
 * well-known absolute locations.
 * @param {{ timeoutMs?: number }} [options] - probe options.
 * @returns {Promise<{ available: boolean, executable: string, source: string, version: string, tried: object[], error: string, checkedAt: number }>}
 */
export async function detectPowershell(options = {}) {
  const tried = []
  const candidates = ['pwsh', 'powershell', ...powershellFallbacks().filter(candidate => existsSync(candidate))]
  for (const candidate of candidates) {
    const result = await runProcess(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      timeoutMs: options.timeoutMs ?? 8000,
    })
    const version = result.stdout.trim().split(/\r?\n/)[0] ?? ''
    tried.push({ executable: candidate, available: result.ok, error: result.ok ? '' : result.error })
    if (result.ok) {
      return {
        available: true,
        executable: candidate,
        source: candidate.includes('\\') || candidate.includes('/') ? 'absolute' : 'path',
        version,
        tried,
        error: '',
        checkedAt: Date.now(),
      }
    }
  }
  return {
    available: false,
    executable: '',
    source: 'none',
    version: '',
    tried,
    error: tried[tried.length - 1]?.error ?? 'powershell-not-found',
    checkedAt: Date.now(),
  }
}

/** A sample event used by the Settings page's preview and test actions. */
export function sampleEvent() {
  return {
    event: 'turn-end',
    kind: 'root',
    sessionId: 'session-00000000-0000-0000-0000-000000000000',
    parentSessionId: '',
    sessionTitle: 'DSH notify plugin test',
    turn: 1,
    reason: 'completed',
    durationMs: 12_300,
    cwd: process.cwd(),
    time: new Date().toLocaleString(),
  }
}

/** Environment variables the child process runs with (ambient ones are kept). */
function childEnv() {
  return { ...process.env }
}

/**
 * Create the shared runtime state: settings, probes, and per-session timers.
 * @param {object} [options] - injection seams for tests.
 * @returns {object} mutable plugin state.
 */
export function createState(options = {}) {
  const env = options.env ?? process.env
  const loaded = readSettings(env)
  return {
    env,
    locale: options.locale ?? systemLocale(),
    settings: loaded.settings,
    settingsFile: loaded.file,
    loadError: loaded.error,
    settingsError: '',
    python: null,
    powershell: null,
    probeAt: 0,
    starts: new Map(),
    titles: new Map(),
    sessionTitle: null,
    lastDelivery: null,
    deliveries: 0,
    failures: 0,
    detectPython: options.detectPython ?? detectPython,
    detectPowershell: options.detectPowershell ?? detectPowershell,
    runProcess: options.runProcess ?? runProcess,
  }
}

/**
 * Refresh the interpreter probes, honouring a short cache unless forced.
 * @param {object} state - plugin state.
 * @param {{ force?: boolean, pythonExecutable?: string }} [request] - probe request.
 * @returns {Promise<object>} the state, with `python`/`powershell` filled in.
 */
export async function refreshProbes(state, request = {}) {
  const explicit = typeof request.pythonExecutable === 'string' && request.pythonExecutable.trim() !== ''
  const fresh = state.python !== null && Date.now() - state.probeAt < PROBE_TTL_MS
  if (fresh && request.force !== true && !explicit) return state
  const [python, powershell] = await Promise.all([
    state.detectPython({ executable: request.pythonExecutable ?? '' }),
    state.powershell === null || request.force === true || explicit
      ? state.detectPowershell()
      : Promise.resolve(state.powershell),
  ])
  state.python = python
  state.powershell = powershell
  state.probeAt = Date.now()
  return state
}

/**
 * Deliver one notification with the current settings.
 * @param {object} state - plugin state.
 * @param {object} event - normalized turn-end event.
 * @param {object} settings - settings to use (may be an unsaved draft).
 * @returns {Promise<object>} delivery report.
 */
export async function deliver(state, event, settings) {
  const configuredPython = settings.python.executable.trim()
  if (
    state.python === null
    || state.powershell === null
    || (configuredPython !== '' && state.python.executable !== configuredPython)
  ) {
    await refreshProbes(state, {
      pythonExecutable: configuredPython,
      force: configuredPython !== '' && state.python?.executable !== configuredPython,
    })
  }
  const values = composeNotification(event, state.locale, settings)
  const plan = resolveDelivery({
    settings,
    python: state.python ?? { available: false, executable: '' },
    powershell: state.powershell ?? { available: false, executable: '' },
    scripts: BUNDLED_SCRIPTS,
    values,
  })
  if (!plan.ok) {
    state.failures += 1
    state.lastDelivery = { at: Date.now(), ok: false, channel: plan.channel, reason: plan.reason, title: values.title, message: values.message }
    return { ...state.lastDelivery, executable: '', argv: [], output: '', error: plan.reason }
  }
  const result = await state.runProcess(plan.executable, plan.argv, { timeoutMs: settings.timeoutMs })
  const report = {
    at: Date.now(),
    ok: result.ok,
    channel: plan.channel,
    reason: result.ok ? '' : result.error,
    executable: plan.executable,
    argv: plan.argv,
    title: values.title,
    message: values.message,
    output: `${result.stdout}${result.stderr}`.trim().slice(0, 2000),
    error: result.error,
  }
  if (result.ok) state.deliveries += 1
  else state.failures += 1
  state.lastDelivery = report
  return report
}

/**
 * Handle one session event: remember turn starts and notify on turn ends.
 * @param {object} state - plugin state.
 * @param {object} ctx - plugin context (used for logging).
 * @param {object} session - the session the event belongs to.
 * @param {object} event - the session event.
 * @returns {void}
 */
export function handleSessionEvent(state, ctx, session, event) {
  const sessionId = String(session?.id ?? '')
  if (sessionId === '') return
  if (event?.type === 'session/title') {
    const title = event.data?.title
    if (typeof title === 'string' && title !== '') state.titles.set(sessionId, title)
    return
  }
  if (event?.type === 'turn/start') {
    // Bound the table: a turn that never ends (a killed session) would otherwise
    // leave its start time behind forever.
    if (state.starts.size > 500) state.starts.clear()
    state.starts.set(`${sessionId}:${event.data?.turn}`, Number(event.time) || Date.now())
    return
  }
  if (event?.type !== 'turn/end') return

  const settings = state.settings
  const key = `${sessionId}:${event.data?.turn}`
  const startedAt = state.starts.get(key)
  state.starts.delete(key)
  const endTime = Number(event.time) || Date.now()
  const durationMs = Math.max(0, endTime - (startedAt ?? endTime))

  if (!settings.enabled) return
  const header = session?.header ?? {}
  const isSubagent = header.origin === 'subagent'
  if (isSubagent && !settings.includeSubagents) return
  if (durationMs < settings.minDurationMs) return

  const title = state.sessionTitle?.get?.(session)?.title ?? state.titles.get(sessionId) ?? ''
  const normalizedEvent = {
    event: 'turn-end',
    kind: isSubagent ? 'subagent' : 'root',
    sessionId,
    parentSessionId: header.parentSession === undefined || header.parentSession === null ? '' : String(header.parentSession),
    sessionTitle: title,
    turn: event.data?.turn,
    reason: event.data?.reason?.kind ?? 'unknown',
    durationMs,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    time: new Date().toLocaleString(state.locale?.startsWith?.('zh') ? 'zh-CN' : 'en-US'),
  }
  void deliver(state, normalizedEvent, settings)
    .then((report) => {
      if (report.ok) log(ctx, 'info', `notified turn/end via ${report.channel}`)
      else log(ctx, 'warn', `notification failed (${report.channel}): ${report.error}`)
    })
    .catch((error) => log(ctx, 'warn', 'notification failed', error))
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Reject cross-site callers the way the shipped plugins do. */
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolvePromise({})
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** Everything the Settings page needs to render itself. */
async function snapshot(state, force = false) {
  await refreshProbes(state, force ? { force: true } : {})
  const pythonScript = state.settings.python.script.trim() === '' ? BUNDLED_SCRIPTS.python : state.settings.python.script
  const powershellScript = state.settings.powershell.script.trim() === '' ? BUNDLED_SCRIPTS.powershell : state.settings.powershell.script
  return {
    ok: true,
    platform: process.platform,
    settings: state.settings,
    defaults: defaultSettings(),
    channels: CHANNELS,
    placeholders: PLACEHOLDERS,
    python: state.python,
    powershell: state.powershell,
    scripts: {
      python: BUNDLED_SCRIPTS.python,
      powershell: BUNDLED_SCRIPTS.powershell,
      pythonScript,
      powershellScript,
      pythonExists: existsSync(pythonScript),
      powershellExists: existsSync(powershellScript),
    },
    storage: { file: state.settingsFile, error: state.settingsError || state.loadError },
    stats: { deliveries: state.deliveries, failures: state.failures, last: state.lastDelivery },
    locale: state.locale,
  }
}

/**
 * Build the data route the browser half calls.
 * @param {object} state - plugin state.
 * @param {object} ctx - plugin context, for logging.
 * @returns {{ kind: 'exact', path: string, handler: Function }} the route.
 */
export function makeRoute(state, ctx) {
  return {
    kind: 'exact',
    path: NOTIFY_ROUTE,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }
      try {
        if (req.method === 'GET') {
          json(res, 200, await snapshot(state))
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        const body = await readBody(req)
        const action = typeof body?.action === 'string' ? body.action : ''
        if (action === 'detect') {
          await refreshProbes(state, { force: true, pythonExecutable: body.pythonExecutable })
          json(res, 200, await snapshot(state))
          return
        }
        if (action === 'save') {
          state.settings = writeSettings(body.settings, state.env)
          state.settingsError = ''
          await refreshProbes(state, { force: true })
          json(res, 200, await snapshot(state))
          return
        }
        if (action === 'reset') {
          state.settings = writeSettings(defaultSettings(), state.env)
          state.settingsError = ''
          json(res, 200, await snapshot(state, true))
          return
        }
        if (action === 'test' || action === 'preview') {
          const draft = normalizeSettings(body.settings ?? state.settings)
          await refreshProbes(state, { force: true, pythonExecutable: draft.python.executable })
          const event = { ...sampleEvent(), time: new Date().toLocaleString(state.locale?.startsWith?.('zh') ? 'zh-CN' : 'en-US') }
          if (action === 'preview') {
            const values = composeNotification(event, state.locale, draft)
            json(res, 200, { ok: true, title: values.title, message: values.message, values })
            return
          }
          const report = await deliver(state, event, draft)
          log(ctx, report.ok ? 'info' : 'warn', report.ok ? `test notification sent via ${report.channel}` : `test notification failed: ${report.error}`)
          json(res, 200, { ok: report.ok, report, snapshot: await snapshot(state) })
          return
        }
        json(res, 400, { ok: false, error: 'unknown-action' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(ctx, 'warn', `settings route failed: ${message}`)
        json(res, 400, { ok: false, error: message })
      }
    },
  }
}

/**
 * Plugin body. Every registration is owned by `ctx.effect`/`ctx.on`, so the
 * plugin disposes cleanly when it is disabled or replaced.
 * @param {object} ctx - the Host plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  const state = createState()
  if (state.loadError !== '') log(ctx, 'warn', `settings file unreadable (${state.settingsFile}): ${state.loadError}`)

  // Session-title service when it is composed; the event feed below is the fallback.
  ctx.inject(['sessionTitle'], (child) => {
    state.sessionTitle = child.sessionTitle
    return () => {
      state.sessionTitle = null
    }
  })

  ctx.on('session/event', (session, event) => {
    try {
      handleSessionEvent(state, ctx, session, event)
    } catch (error) {
      log(ctx, 'warn', 'session event handling failed', error)
    }
  })

  // Warm the probes in the background so the first Settings page render is fast.
  void refreshProbes(state, { force: true }).catch(() => {})

  ctx.inject(['webServer'], (child) => {
    child.effect(() => child.webServer.register(makeRoute(state, ctx)), 'dsh-plugin-notify: settings route')
  })
}
