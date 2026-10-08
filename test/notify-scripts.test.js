/**
 * Cross-platform checks for the bundled notifier scripts.
 *
 * Both scripts can resolve the command they *would* run for any platform
 * (`--dry-run --platform macOS` / `-DryRun -Platform Linux`), so the
 * macOS/Linux branches are verified from any machine instead of only on the
 * platform itself. Nothing is ever sent by these tests.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { BUNDLED_SCRIPTS, detectPowershell, detectPython, runProcess } from '../lib/index.js'

const python = await detectPython({ timeoutMs: 8000 })
const powershell = await detectPowershell({ timeoutMs: 15_000 })
const skipPython = python.available ? false : 'no Python interpreter on this machine'
const skipPowershell = powershell.available ? false : 'no PowerShell host on this machine'

async function pythonPlan(args) {
  const result = await runProcess(python.executable, [BUNDLED_SCRIPTS.python, ...args], { timeoutMs: 20_000 })
  assert.equal(result.ok, true, `notify.py failed: ${result.error}`)
  return JSON.parse(result.stdout.trim())
}

async function powershellPlan(args) {
  const result = await runProcess(powershell.executable, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', BUNDLED_SCRIPTS.powershell,
    ...args,
  ], { timeoutMs: 30_000 })
  assert.equal(result.ok, true, `notify.ps1 failed: ${result.error}`)
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim())
}

test('the package ships every notifier script', () => {
  assert.equal(existsSync(BUNDLED_SCRIPTS.python), true)
  assert.equal(existsSync(BUNDLED_SCRIPTS.powershell), true)
  const windows = join(BUNDLED_SCRIPTS.powershell, '..', 'notify.windows.ps1')
  assert.equal(existsSync(windows), true, 'the Windows implementation is a separate file')
  assert.equal(readFileSync(BUNDLED_SCRIPTS.powershell, 'utf8').includes('notify.windows.ps1'), true)
  assert.equal(readFileSync(windows, 'utf8').includes('System.Windows.Forms'), true)
})

test('notify.py plans osascript on macOS', { skip: skipPython }, async () => {
  const plan = await pythonPlan(['--dry-run', '--platform', 'macOS', '--title', 'Build done', '--message', 'line one\nline two'])
  assert.equal(plan.platform, 'macOS')
  assert.equal(plan.backend, 'osascript')
  assert.equal(plan.dryRun, true)
  assert.equal(plan.command[0], 'osascript')
  assert.equal(plan.command[1], '-e')
  assert.equal(plan.command[2], 'display notification "line one\nline two" with title "Build done"')
  assert.equal(plan.available, process.platform === 'darwin')
})

test('notify.py plans notify-send on Linux', { skip: skipPython }, async () => {
  const plan = await pythonPlan(['--dry-run', '--platform', 'Linux', '--title', 'Build done', '--message', 'body'])
  assert.equal(plan.backend, 'notify-send')
  assert.equal(plan.command[0], 'notify-send')
  assert.equal(plan.command.includes('--app-name=DSH'), true)
  assert.equal(plan.command[plan.command.length - 1], 'body')
})

test('notify.py plans the PowerShell notifier on Windows', { skip: skipPython }, async () => {
  const plan = await pythonPlan(['--dry-run', '--platform', 'Windows', '--title', 'T', '--message', 'M'])
  assert.equal(plan.backend, 'powershell')
  assert.match(plan.command[0], /(pwsh|powershell)(\.exe)?$/i)
  assert.equal(plan.command.includes('-NoProfile'), true)
  assert.equal(plan.command.some(part => part.endsWith('notify.ps1')), true)
})

test('notify.py honours a forced backend and escapes AppleScript', { skip: skipPython }, async () => {
  const forced = await pythonPlan(['--dry-run', '--backend', 'notify-send', '--title', 'T', '--message', 'M'])
  assert.equal(forced.backend, 'notify-send')

  const escaped = await pythonPlan(['--dry-run', '--platform', 'macOS', '--title', 'say "hi"', '--message', 'C:\\tmp'])
  assert.match(escaped.command[2], /title "say \\"hi\\""/)
  assert.match(escaped.command[2], /C:\\\\tmp/)
})

test('notify.py without --dry-run does not print a plan', { skip: skipPython }, async () => {
  // Forcing an unavailable backend must fail loudly instead of printing JSON.
  const result = await runProcess(python.executable, [
    BUNDLED_SCRIPTS.python, '--backend', 'win11toast', '--title', 'T', '--message', 'M',
  ], { timeoutMs: 20_000 })
  if (process.platform === 'win32') {
    // win11toast may or may not be installed; either way stdout stays empty.
    assert.equal(result.stdout.includes('"dryRun"'), false)
  } else {
    assert.equal(result.ok, false, 'a Windows-only backend must fail off Windows')
    assert.match(result.error, /not available|all notification backends failed/)
  }
})

test('notify.ps1 dispatches to osascript on macOS', { skip: skipPowershell }, async () => {
  const plan = await powershellPlan(['-DryRun', '-Platform', 'macOS', '-Title', 'Build done', '-Message', 'body'])
  assert.equal(plan.Platform, 'macOS')
  assert.equal(plan.Backend, 'osascript')
  assert.equal(plan.InProcess, false)
  assert.equal(plan.Command[0], 'osascript')
  assert.equal(plan.Command[1], '-e')
  assert.match(plan.Command[2], /^display notification "body" with title "Build done"$/)
})

test('notify.ps1 dispatches to notify-send on Linux', { skip: skipPowershell }, async () => {
  const plan = await powershellPlan(['-DryRun', '-Platform', 'Linux', '-Title', 'T', '-Message', 'M'])
  assert.equal(plan.Backend, 'notify-send')
  assert.equal(plan.InProcess, false)
  assert.equal(plan.Command[0], 'notify-send')
})

test('notify.ps1 reports the in-process Windows plan', { skip: skipPowershell }, async () => {
  const plan = await powershellPlan(['-DryRun', '-Platform', 'Windows', '-Title', 'T', '-Message', 'M'])
  assert.equal(plan.Backend, 'winforms')
  assert.equal(plan.InProcess, true)
  assert.equal(plan.Command[0], '<in-process>')
})

test('notify.ps1 escapes AppleScript strings', { skip: skipPowershell }, async () => {
  const plan = await powershellPlan(['-DryRun', '-Platform', 'macOS', '-Title', 'say "hi"', '-Message', 'C:\\tmp'])
  assert.match(plan.Command[2], /title "say \\"hi\\""/)
  assert.match(plan.Command[2], /C:\\\\tmp/)
})

test('the backend fallback chain is correct on every platform', { skip: skipPython }, async () => {
  const checker = join(BUNDLED_SCRIPTS.python, '..', '..', 'tools', 'check-backends.py')
  const result = await runProcess(python.executable, [checker], { timeoutMs: 30_000 })
  assert.equal(result.ok, true, `check-backends.py failed:\n${result.stdout}\n${result.error}`)
  assert.match(result.stdout, /All backend-selection checks passed/)
})
