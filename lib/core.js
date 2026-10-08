/**
 * Pure logic of the DSH notify plugin: settings shape, template/argv
 * expansion, notification composition, and delivery-channel resolution.
 *
 * Nothing here touches the filesystem, the network, or a DSH context, so the
 * Host half (`lib/index.js`) and the test suite can both drive it directly.
 */

/** Channels a notification can be delivered through. */
export const CHANNELS = ['auto', 'python', 'powershell', 'custom']

/** Placeholders accepted in every command/argument template and text template. */
export const PLACEHOLDERS = [
  '{title}',
  '{message}',
  '{label}',
  '{sessionTitle}',
  '{sessionId}',
  '{parentSessionId}',
  '{turn}',
  '{reason}',
  '{reasonLabel}',
  '{duration}',
  '{durationMs}',
  '{event}',
  '{kind}',
  '{cwd}',
  '{project}',
  '{time}',
]

/**
 * Default argument templates. `{script}` resolves to the configured script, or
 * to the script shipped inside this package when the field is left blank.
 */
export const DEFAULT_PYTHON_ARGS =
  '{script} --title {title} --message {message} --event {event} --kind {kind} --session {sessionId} --turn {turn} --reason {reason} --duration-ms {durationMs}'

export const DEFAULT_POWERSHELL_ARGS =
  '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {script} -Title {title} -Message {message} -Kind {kind} -Event {event}'

/** Settings as a fresh install ships them. */
export function defaultSettings() {
  return {
    enabled: true,
    includeSubagents: false,
    minDurationMs: 0,
    channel: 'auto',
    timeoutMs: 15000,
    titleTemplate: '',
    messageTemplate: '',
    python: {
      executable: '',
      script: '',
      args: DEFAULT_PYTHON_ARGS,
    },
    powershell: {
      executable: '',
      script: '',
      args: DEFAULT_POWERSHELL_ARGS,
    },
    custom: {
      command: '',
      args: '{message}',
    },
  }
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function flag(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function integer(value, fallback, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(text(value).trim(), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/**
 * Coerce an arbitrary parsed JSON object into the exact settings shape.
 * Unknown keys are dropped and every field falls back to its default, so a
 * hand-edited or half-written settings file can never break the plugin.
 * @param {unknown} raw - value read from the settings file.
 * @returns {ReturnType<typeof defaultSettings>} a complete settings object.
 */
export function normalizeSettings(raw) {
  const base = defaultSettings()
  if (raw === null || typeof raw !== 'object') return base
  const source = /** @type {Record<string, any>} */ (raw)
  const group = (name) => (source[name] !== null && typeof source[name] === 'object' ? source[name] : {})
  const python = group('python')
  const powershell = group('powershell')
  const custom = group('custom')
  const channel = CHANNELS.includes(text(source.channel)) ? text(source.channel) : base.channel
  const pythonArgs = text(python.args)
  const powershellArgs = text(powershell.args)
  return {
    enabled: flag(source.enabled, base.enabled),
    includeSubagents: flag(source.includeSubagents, base.includeSubagents),
    minDurationMs: integer(source.minDurationMs, base.minDurationMs, 0, 86_400_000),
    channel,
    timeoutMs: integer(source.timeoutMs, base.timeoutMs, 500, 600_000),
    titleTemplate: text(source.titleTemplate),
    messageTemplate: text(source.messageTemplate),
    python: {
      executable: text(python.executable),
      script: text(python.script),
      args: pythonArgs.trim() === '' ? base.python.args : pythonArgs,
    },
    powershell: {
      executable: text(powershell.executable),
      script: text(powershell.script),
      args: powershellArgs.trim() === '' ? base.powershell.args : powershellArgs,
    },
    custom: {
      command: text(custom.command),
      args: text(custom.args, base.custom.args),
    },
  }
}

/**
 * Split a command-line template into tokens, honouring double quotes, single
 * quotes and backslash escapes. Quotes are removed from the tokens.
 * @param {string} template - e.g. `--title "hello world" {message}`.
 * @returns {{ value: string, quoted: boolean }[]} tokens in order.
 */
export function tokenizeArgs(template) {
  const tokens = []
  const input = text(template)
  let current = ''
  let quoted = false
  let started = false
  let quote = ''

  const push = () => {
    if (!started) return
    tokens.push({ value: current, quoted })
    current = ''
    quoted = false
    started = false
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quote !== '') {
      if (char === '\\' && index + 1 < input.length) {
        index += 1
        current += input[index]
        continue
      }
      if (char === quote) {
        quote = ''
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      quoted = true
      started = true
      continue
    }
    if (char === '\\' && index + 1 < input.length) {
      index += 1
      current += input[index]
      started = true
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    current += char
    started = true
  }
  push()
  return tokens
}

function substitute(token, values) {
  return token.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match
    const value = values[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * Expand one template into an argv array. A token that is nothing but a
 * placeholder becomes exactly one argument, spaces included, so
 * `--message {message}` survives a multi-line notification body; any other
 * token is substituted in place.
 * @param {string} template - argument template.
 * @param {Record<string, unknown>} values - placeholder values.
 * @returns {string[]} argv entries, empty tokens dropped.
 */
export function expandTemplate(template, values) {
  const out = []
  for (const token of tokenizeArgs(template)) {
    const expanded = substitute(token.value, values)
    if (expanded === '' && token.value !== '') continue
    out.push(expanded)
  }
  return out
}

/** Localized notification labels. */
const LABELS = {
  zh: {
    root: 'DSH 回答完成',
    subagent: 'DSH 子任务完成',
    test: 'DSH 通知测试',
    testBody: '如果你看到这条消息，说明通知通道工作正常。',
    untitled: '未命名会话',
    reasons: {
      completed: '已完成',
      aborted: '已中止',
      blocked: '被阻塞',
      error: '出错',
      'max-tokens': '达到长度上限',
      interrupted: '已打断',
      forked: '已分叉',
    },
  },
  en: {
    root: 'DSH turn complete',
    subagent: 'DSH subtask complete',
    test: 'DSH notification test',
    testBody: 'If you can read this, the notification channel works.',
    untitled: 'Untitled session',
    reasons: {
      completed: 'completed',
      aborted: 'aborted',
      blocked: 'blocked',
      error: 'error',
      'max-tokens': 'max tokens',
      interrupted: 'interrupted',
      forked: 'forked',
    },
  },
}

/**
 * Pick a dictionary. Anything that is not Chinese falls back to English.
 * @param {unknown} locale - e.g. `zh-CN`, `en-US`.
 * @returns {typeof LABELS.zh} the dictionary for that locale.
 */
export function labelsFor(locale) {
  const value = text(locale).toLowerCase()
  return value.startsWith('zh') ? LABELS.zh : LABELS.en
}

/**
 * Human-readable turn-end reason.
 * @param {unknown} reason - `reason.kind` of the turn/end event.
 * @param {unknown} locale - locale used for the label.
 * @returns {string} the localized reason, or the raw kind when unknown.
 */
export function reasonLabel(reason, locale) {
  const kind = text(reason, 'unknown')
  const dictionary = labelsFor(locale)
  return dictionary.reasons[kind] ?? kind
}

/**
 * Format a duration the way the notification shows it.
 * @param {unknown} durationMs - milliseconds.
 * @returns {string} e.g. `840 ms` or `12.3 s`.
 */
export function formatDuration(durationMs) {
  const value = Number(durationMs)
  if (!Number.isFinite(value) || value <= 0) return '0 ms'
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(1)} s`
}

/**
 * Turn end data into the placeholder table every template is expanded with.
 * @param {object} event - normalized turn-end event.
 * @param {unknown} locale - locale used for labels.
 * @param {object} settings - normalized settings (provides text templates).
 * @returns {Record<string, string>} placeholder values, including the composed
 *   `title` and `message`.
 */
export function composeNotification(event, locale, settings) {
  const dictionary = labelsFor(locale)
  const kind = event.kind === 'subagent' ? 'subagent' : 'root'
  const sessionTitle = text(event.sessionTitle).trim() === '' ? dictionary.untitled : text(event.sessionTitle).trim()
  const values = {
    event: text(event.event, 'turn-end'),
    kind,
    label: kind === 'subagent' ? dictionary.subagent : dictionary.root,
    sessionTitle,
    sessionId: text(event.sessionId),
    parentSessionId: text(event.parentSessionId),
    turn: event.turn === undefined || event.turn === null ? '' : String(event.turn),
    reason: text(event.reason, 'unknown'),
    reasonLabel: reasonLabel(event.reason, locale),
    duration: formatDuration(event.durationMs),
    durationMs: event.durationMs === undefined || event.durationMs === null ? '' : String(Math.max(0, Math.round(Number(event.durationMs) || 0))),
    cwd: text(event.cwd),
    project: text(event.cwd).replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '',
    time: text(event.time) === '' ? new Date().toLocaleString(locale?.toString().startsWith('zh') ? 'zh-CN' : 'en-US') : text(event.time),
  }
  const titleTemplate = text(settings?.titleTemplate).trim() === '' ? '{label}' : settings.titleTemplate
  values.title = normalizeText(expandText(titleTemplate, values))
  const messageTemplate = text(settings?.messageTemplate).trim() === ''
    ? '{sessionTitle}\n{turnLine}{reasonLabel} · {duration}'
    : settings.messageTemplate
  const turnLine = values.turn === '' ? '' : `#${values.turn} · `
  const withTurn = { ...values, turnLine }
  values.message = normalizeText(expandText(messageTemplate, withTurn))
  values.turnLine = turnLine
  return values
}

/**
 * Accept the literal `\n` a person can type into a single-line field, the same
 * way the bundled Python notifier does.
 * @param {string} value - expanded template text.
 * @returns {string} the text with escape sequences resolved.
 */
export function normalizeText(value) {
  return text(value).replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
}

/**
 * Expand a text template (not an argv template): placeholders are substituted
 * in place and unknown ones are left alone.
 * @param {string} template - text template.
 * @param {Record<string, unknown>} values - placeholder values.
 * @returns {string} the expanded text.
 */
export function expandText(template, values) {
  return text(template).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match
    const value = values[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/**
 * Decide which executable and argv deliver this notification.
 * @param {object} input - resolution input.
 * @param {object} input.settings - normalized settings.
 * @param {{ available: boolean, executable: string, source: string }} input.python -
 *   result of the Python probe.
 * @param {{ python: string, powershell: string }} input.scripts - bundled script paths.
 * @param {{ executable: string, source: string }} input.powershell - resolved shell.
 * @param {Record<string, string>} input.values - placeholder values.
 * @returns {{ channel: string, executable: string, argv: string[], ok: boolean, reason?: string }}
 *   the delivery plan; `ok: false` carries a machine-readable reason.
 */
export function resolveDelivery(input) {
  const { settings, python, scripts, powershell, values } = input
  const wanted = settings.channel === 'auto'
    ? (python.available && python.executable !== '' ? 'python' : 'powershell')
    : settings.channel

  if (wanted === 'python') {
    const executable = python.executable
    if (executable === '') return { channel: 'python', executable: '', argv: [], ok: false, reason: 'python-unavailable' }
    const script = settings.python.script.trim() === '' ? scripts.python : settings.python.script
    const argv = expandTemplate(settings.python.args, { ...values, script })
    return { channel: 'python', executable, argv, ok: true }
  }

  if (wanted === 'powershell') {
    const executable = settings.powershell.executable.trim() === '' ? powershell.executable : settings.powershell.executable
    if (executable === '') return { channel: 'powershell', executable: '', argv: [], ok: false, reason: 'powershell-unavailable' }
    const script = settings.powershell.script.trim() === '' ? scripts.powershell : settings.powershell.script
    const argv = expandTemplate(settings.powershell.args, { ...values, script })
    return { channel: 'powershell', executable, argv, ok: true }
  }

  const command = settings.custom.command.trim()
  if (command === '') return { channel: 'custom', executable: '', argv: [], ok: false, reason: 'custom-command-empty' }
  const argv = expandTemplate(settings.custom.args, values)
  return { channel: 'custom', executable: command, argv, ok: true }
}

/**
 * Summarize a spawn failure the way the Settings page shows it.
 * @param {{ code?: unknown, killed?: unknown, stderr?: unknown, message?: unknown }} error -
 *   error thrown by the process runner.
 * @returns {string} a short, non-empty explanation.
 */
export function describeRunFailure(error) {
  const stderr = text(error?.stderr).trim()
  if (stderr !== '') return stderr.split(/\r?\n/).slice(0, 4).join('\n')
  if (error?.killed === true) return 'timeout'
  const code = error?.code
  if (code !== undefined && code !== null && code !== '') return `exit ${code}`
  return text(error?.message, 'command failed')
}
