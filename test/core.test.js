/**
 * Unit tests for the pure core plus the file-backed settings store.
 * Run with `npm test`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  BUNDLED_SCRIPTS,
  detectPython,
  readSettings,
  runProcess,
  settingsPath,
  writeSettings,
} from '../lib/index.js'
import {
  composeNotification,
  defaultSettings,
  describeRunFailure,
  expandTemplate,
  formatDuration,
  normalizeSettings,
  reasonLabel,
  resolveDelivery,
  tokenizeArgs,
} from '../lib/core.js'

test('normalizeSettings fills a complete object from garbage', () => {
  const settings = normalizeSettings(null)
  assert.deepEqual(settings, defaultSettings())
  const partial = normalizeSettings({ enabled: false, channel: 'nope', timeoutMs: 10, python: { script: 'C:\\x.py' } })
  assert.equal(partial.enabled, false)
  assert.equal(partial.channel, 'auto', 'an unknown channel falls back to auto')
  assert.equal(partial.timeoutMs, 500, 'timeouts are clamped to the allowed range')
  assert.equal(partial.python.script, 'C:\\x.py')
  assert.equal(partial.python.args, defaultSettings().python.args)
  assert.equal(normalizeSettings({ python: { args: '   ' } }).python.args, defaultSettings().python.args)
})

test('tokenizeArgs honours quotes and escapes', () => {
  assert.deepEqual(tokenizeArgs('a b   c').map(token => token.value), ['a', 'b', 'c'])
  assert.deepEqual(tokenizeArgs('--title "hello world" x').map(token => token.value), ['--title', 'hello world', 'x'])
  assert.deepEqual(tokenizeArgs("-m 'one two'").map(token => token.value), ['-m', 'one two'])
  assert.deepEqual(tokenizeArgs('a\\ b').map(token => token.value), ['a b'])
  assert.deepEqual(tokenizeArgs('""').map(token => token.value), [''])
})

test('expandTemplate keeps a lone placeholder as one argument', () => {
  const values = { message: 'line one\nline two', title: 'DSH', script: 'C:\\p\\notify.py' }
  assert.deepEqual(
    expandTemplate('{script} --title {title} --message {message}', values),
    ['C:\\p\\notify.py', '--title', 'DSH', '--message', 'line one\nline two'],
  )
  assert.deepEqual(expandTemplate('--x "{message}"', values), ['--x', 'line one\nline two'])
  assert.deepEqual(expandTemplate('drop-{missing}', values), ['drop-{missing}'])
})

test('composeNotification produces localized title and body', () => {
  const event = {
    event: 'turn-end',
    kind: 'root',
    sessionId: 's1',
    parentSessionId: '',
    sessionTitle: 'Fix the build',
    turn: 4,
    reason: 'completed',
    durationMs: 12_300,
    cwd: 'F:\\WorkSpace\\demo',
    time: '2026-01-01 10:00',
  }
  const zh = composeNotification(event, 'zh-CN', normalizeSettings({}))
  assert.equal(zh.title, 'DSH 回答完成')
  assert.equal(zh.message, 'Fix the build\n#4 · 已完成 · 12.3 s')
  assert.equal(zh.project, 'demo')
  assert.equal(zh.reasonLabel, '已完成')

  const en = composeNotification(event, 'en-US', normalizeSettings({}))
  assert.equal(en.title, 'DSH turn complete')
  assert.equal(en.message, 'Fix the build\n#4 · completed · 12.3 s')

  const noTurn = composeNotification({ ...event, turn: undefined }, 'en-US', normalizeSettings({}))
  assert.equal(noTurn.message, 'Fix the build\ncompleted · 12.3 s', 'the turn prefix disappears without a turn number')

  const escaped = composeNotification(event, 'en-US', normalizeSettings({ messageTemplate: 'a\\nb' }))
  assert.equal(escaped.message, 'a\nb', 'a typed \\n becomes a real line break')

  const custom = composeNotification(event, 'en-US', normalizeSettings({
    titleTemplate: '{label} — {project}',
    messageTemplate: '{title} / {durationMs}ms / {kind}',
  }))
  assert.equal(custom.title, 'DSH turn complete — demo')
  assert.equal(custom.message, 'DSH turn complete — demo / 12300ms / root', '{title} is the composed title')

  const raw = composeNotification(event, 'en-US', normalizeSettings({ messageTemplate: '{sessionTitle} · {cwd}' }))
  assert.equal(raw.message, 'Fix the build · F:\\WorkSpace\\demo')
})

test('composeNotification falls back for an untitled session', () => {
  const values = composeNotification({ sessionTitle: '', turn: 1, reason: 'error' }, 'zh', normalizeSettings({}))
  assert.equal(values.title, 'DSH 回答完成')
  assert.equal(values.sessionTitle, '未命名会话')
  assert.equal(values.message, '未命名会话\n#1 · 出错 · 0 ms')
  assert.equal(values.reasonLabel, '出错')
})

test('formatDuration and reasonLabel stay readable', () => {
  assert.equal(formatDuration(0), '0 ms')
  assert.equal(formatDuration(840), '840 ms')
  assert.equal(formatDuration(1500), '1.5 s')
  assert.equal(reasonLabel('max-tokens', 'zh'), '达到长度上限')
  assert.equal(reasonLabel('something-new', 'en'), 'something-new')
})

test('resolveDelivery picks the auto route and reports broken ones', () => {
  const values = { message: 'hi', title: 'DSH', sessionId: 's1', turn: '1', reason: 'completed', durationMs: '5', event: 'turn-end', kind: 'root' }
  const scripts = { python: 'C:\\p\\notify.py', powershell: 'C:\\p\\notify.ps1' }
  const available = { available: true, executable: 'python' }
  const missing = { available: false, executable: '' }

  const auto = resolveDelivery({ settings: normalizeSettings({}), python: available, powershell: { available: true, executable: 'pwsh' }, scripts, values })
  assert.equal(auto.channel, 'python')
  assert.equal(auto.executable, 'python')
  assert.equal(auto.argv[0], 'C:\\p\\notify.py')

  const fallback = resolveDelivery({ settings: normalizeSettings({}), python: missing, powershell: { available: true, executable: 'pwsh' }, scripts, values })
  assert.equal(fallback.channel, 'powershell')
  assert.equal(fallback.executable, 'pwsh')

  const forced = resolveDelivery({ settings: normalizeSettings({ channel: 'python' }), python: missing, powershell: { available: true, executable: 'pwsh' }, scripts, values })
  assert.equal(forced.ok, false)
  assert.equal(forced.reason, 'python-unavailable')

  const customEmpty = resolveDelivery({ settings: normalizeSettings({ channel: 'custom' }), python: missing, powershell: missing, scripts, values })
  assert.equal(customEmpty.reason, 'custom-command-empty')

  const custom = resolveDelivery({
    settings: normalizeSettings({ channel: 'custom', custom: { command: 'pwsh.exe', args: '-File {script} -Message {message}' } }),
    python: missing,
    powershell: missing,
    scripts,
    values,
  })
  assert.deepEqual(custom.argv, ['-File', '{script}', '-Message', 'hi'])

  const overridden = resolveDelivery({
    settings: normalizeSettings({ channel: 'python', python: { script: 'D:\\mine\\send.py', args: '{script} {message} --title {title}' } }),
    python: { available: true, executable: 'py' },
    powershell: missing,
    scripts,
    values,
  })
  assert.deepEqual(overridden.argv, ['D:\\mine\\send.py', 'hi', '--title', 'DSH'])
})

test('describeRunFailure prefers stderr', () => {
  assert.equal(describeRunFailure({ stderr: 'boom\nsecond\n', code: 1 }), 'boom\nsecond')
  assert.equal(describeRunFailure({ killed: true }), 'timeout')
  assert.equal(describeRunFailure({ code: 2 }), 'exit 2')
  assert.equal(describeRunFailure({ message: 'ENOENT' }), 'ENOENT')
})

test('settings round-trip through $DSH_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-notify-test-'))
  try {
    const env = { DSH_HOME: home }
    assert.equal(settingsPath(env), join(home, 'storages', 'dsh-plugin-notify', 'settings.json'))
    assert.equal(readSettings(env).settings.enabled, true, 'a missing file yields defaults')

    writeSettings({ enabled: false, channel: 'powershell', timeoutMs: 99 }, env)
    const read = readSettings(env)
    assert.equal(read.settings.enabled, false)
    assert.equal(read.settings.channel, 'powershell')
    assert.equal(read.settings.timeoutMs, 500)
    assert.equal(read.error, '')

    const onDisk = JSON.parse(readFileSync(settingsPath(env), 'utf8'))
    assert.equal(onDisk.enabled, false)
    assert.equal(onDisk.python.args, defaultSettings().python.args)

    writeFileSync(settingsPath(env), '{ not json', 'utf8')
    const broken = readSettings(env)
    assert.notEqual(broken.error, '', 'a corrupt file is reported and defaults are used')
    assert.equal(broken.settings.enabled, true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('runProcess reports success and failure without throwing', async () => {
  const ok = await runProcess(process.execPath, ['--version'], { timeoutMs: 15_000 })
  assert.equal(ok.ok, true)
  assert.match(`${ok.stdout}${ok.stderr}`, /^v\d+\./)

  const missing = await runProcess('definitely-not-a-real-program-42', [], { timeoutMs: 5000 })
  assert.equal(missing.ok, false)
  assert.notEqual(missing.error, '')

  const timeout = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 400 })
  assert.equal(timeout.ok, false)
  assert.equal(timeout.killed, true)
})

test('python detection finds the interpreter this machine has', async () => {
  const report = await detectPython({ timeoutMs: 8000 })
  // Any Windows/macOS/Linux developer machine running this suite has one of
  // python/python3/py, but the plugin must also survive a machine without it.
  assert.equal(typeof report.available, 'boolean')
  assert.ok(Array.isArray(report.tried) && report.tried.length >= 1)
  if (report.available) assert.match(report.version, /^\d+\./)
})

test('bundled scripts exist where the manifest says they do', () => {
  assert.match(BUNDLED_SCRIPTS.python, /notify\.py$/)
  assert.match(BUNDLED_SCRIPTS.powershell, /notify\.ps1$/)
  assert.equal(readFileSync(BUNDLED_SCRIPTS.python, 'utf8').includes('notifypy'), true)
})
