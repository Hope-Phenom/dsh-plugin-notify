/**
 * Browser half of @hope_phenom/dsh-plugin-notify.
 *
 * One Settings section (`settings.section`) that owns the plugin's whole
 * configuration: notification timing, the delivery channel (Python /
 * PowerShell / custom command), the text templates, and a live preview plus a
 * test send. All state lives on the Host and is read through
 * `/api/dsh/dsh-plugin-notify`, so the page never duplicates plugin logic.
 *
 * Written as a plain module-loader factory: no build step, React comes from
 * the browser module table, and nothing from `@deepseek-ai/*` is required
 * beyond the platform seeds.
 */
window.__ModuleLoader__.load({
  id: '@hope_phenom/dsh-plugin-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this page. */
    const NS = 'dsh-plugin-notify'
    /** Data route served by the Host half. */
    const ROUTE = '/api/dsh/dsh-plugin-notify'

    const zh = {
      nav: '通知',
      title: '通知',
      description: 'DSH 每轮回答结束时发送桌面通知；通道、脚本与文案都在这里配置。',
      groupBehavior: '通知时机',
      enabled: '启用通知',
      enabledHint: '关闭后不再发送任何通知。',
      subagents: '子代理/子任务完成时也通知',
      subagentsHint: '子代理各自结束一轮时同样通知，默认只通知主会话。',
      minDuration: '最短通知时长（毫秒）',
      minDurationHint: '短于该时长的回合不通知；0 表示每轮都通知。',
      groupChannel: '通知通道',
      channelLabel: '投递方式',
      channelHint: '自动：检测到 Python 就用内置 Python 脚本，否则回退到内置 PowerShell 脚本。',
      channelAuto: '自动',
      channelPython: 'Python',
      channelPowerShell: 'PowerShell',
      channelCustom: '自定义命令',
      routeLabel: '实际生效',
      routeAuto: '自动判定为 {resolved}',
      routePython: '内置 Python 脚本',
      routePowerShell: '内置 PowerShell 脚本',
      routeCustom: '自定义命令',
      routeBroken: '当前配置无法投递',
      reasonPythonUnavailable: '未检测到可用的 Python，请填写解释器路径或改用其他通道。',
      reasonPowerShellUnavailable: '未检测到 PowerShell。',
      reasonCustomEmpty: '自定义命令为空。',
      pythonOk: '{executable} · Python {version}',
      pythonOkNoVersion: '{executable}',
      pythonMissing: '未检测到可用的 Python',
      powershellOk: '{executable} · {version}',
      powershellOkNoVersion: '{executable}',
      powershellMissing: '未检测到 PowerShell',
      executable: '解释器路径',
      executableHint: '留空自动检测（依次尝试 python、python3、py）。',
      script: '脚本路径',
      scriptHint: '留空使用插件内置脚本：{default}',
      scriptMissing: '该路径当前不存在，请确认脚本已放到这里。',
      argsTemplate: '参数模板',
      argsHint: '按空格分词，带空格的整段用引号包住；单独的占位符（如 {message}）会作为一整个参数传入。',
      pythonExecutable: 'Python 解释器',
      powershellExecutable: 'PowerShell 解释器',
      powershellExecutableHint: '留空自动检测（依次尝试 pwsh、powershell 及系统自带路径）。',
      command: '可执行文件',
      commandHint: '例如 pwsh.exe、python、C:\\Tools\\notify.exe',
      customArgs: '参数模板',
      customArgsHint: '例如：-File C:\\Tools\\notify.ps1 -Message {message}',
      detect: '重新检测',
      detecting: '检测中…',
      detectOk: '检测完成：{python}；{powershell}',
      detectFailed: '检测失败：{error}',
      groupText: '通知文案',
      titleTemplate: '标题模板',
      messageTemplate: '正文模板',
      templateHint: '留空使用默认文案（跟随系统语言）：{default}',
      placeholders: '可用占位符',
      preview: '预览文案',
      previewing: '生成中…',
      previewTitle: '标题',
      previewMessage: '正文',
      groupAdvanced: '其他',
      timeout: '通知进程超时（毫秒）',
      timeoutHint: '超过该时长就强杀通知进程，避免堆积。',
      storage: '设置文件',
      storageError: '设置文件读取异常：{error}',
      test: '测试通知',
      testing: '发送中…',
      save: '保存',
      saving: '保存中…',
      reset: '恢复默认',
      resetConfirm: '恢复默认设置？当前配置会被覆盖。',
      saved: '已保存。',
      dirty: '有未保存的修改',
      saveFailed: '保存失败：{error}',
      testOk: '测试通知已通过「{channel}」发送。',
      testFailed: '测试通知失败：{error}',
      loading: '正在读取设置…',
      loadFailed: '无法读取设置：{error}',
      unavailable: 'Host 半边当前未运行，通知插件暂时无法配置。',
      stats: '累计发送 {deliveries} 条 · 失败 {failures} 条',
      lastDelivery: '最近一次：{channel} · {state}',
      stateOk: '成功',
      stateFailed: '失败',
    }

    const en = {
      nav: 'Notifications',
      title: 'Notifications',
      description: 'Send a desktop notification when a DSH turn ends. Configure the channel, scripts and text here.',
      groupBehavior: 'When to notify',
      enabled: 'Enable notifications',
      enabledHint: 'Turning this off silences every notification.',
      subagents: 'Also notify for subagents',
      subagentsHint: 'Notify when a subagent finishes its own turn; by default only the main session does.',
      minDuration: 'Minimum turn duration (ms)',
      minDurationHint: 'Turns shorter than this stay silent; 0 notifies every turn.',
      groupChannel: 'Delivery channel',
      channelLabel: 'Delivery route',
      channelHint: 'Auto uses the bundled Python script when Python is available, and the bundled PowerShell script otherwise.',
      channelAuto: 'Auto',
      channelPython: 'Python',
      channelPowerShell: 'PowerShell',
      channelCustom: 'Custom command',
      routeLabel: 'Effective route',
      routeAuto: 'auto resolved to {resolved}',
      routePython: 'Bundled Python script',
      routePowerShell: 'Bundled PowerShell script',
      routeCustom: 'Custom command',
      routeBroken: 'This configuration cannot deliver',
      reasonPythonUnavailable: 'No usable Python was found. Set an interpreter path or switch channel.',
      reasonPowerShellUnavailable: 'No PowerShell was found.',
      reasonCustomEmpty: 'The custom command is empty.',
      pythonOk: '{executable} · Python {version}',
      pythonOkNoVersion: '{executable}',
      pythonMissing: 'No usable Python found',
      powershellOk: '{executable} · {version}',
      powershellOkNoVersion: '{executable}',
      powershellMissing: 'No PowerShell found',
      executable: 'Interpreter path',
      executableHint: 'Leave blank to auto-detect (tries python, python3, py in order).',
      script: 'Script path',
      scriptHint: 'Leave blank to use the script shipped with the plugin: {default}',
      scriptMissing: 'That path does not exist yet; make sure the script is there.',
      argsTemplate: 'Argument template',
      argsHint: 'Split on spaces; quote a section that contains spaces. A lone placeholder such as {message} is passed as one whole argument.',
      pythonExecutable: 'Python interpreter',
      powershellExecutable: 'PowerShell interpreter',
      powershellExecutableHint: 'Leave blank to auto-detect (tries pwsh, powershell, then the built-in path).',
      command: 'Executable',
      commandHint: 'For example pwsh.exe, python, C:\\Tools\\notify.exe',
      customArgs: 'Argument template',
      customArgsHint: 'For example -File C:\\Tools\\notify.ps1 -Message {message}',
      detect: 'Re-detect',
      detecting: 'Detecting…',
      detectOk: 'Detection finished: {python}; {powershell}',
      detectFailed: 'Detection failed: {error}',
      groupText: 'Notification text',
      titleTemplate: 'Title template',
      messageTemplate: 'Body template',
      templateHint: 'Leave blank to use the default text (follows the system language): {default}',
      placeholders: 'Available placeholders',
      preview: 'Preview text',
      previewing: 'Building…',
      previewTitle: 'Title',
      previewMessage: 'Body',
      groupAdvanced: 'Advanced',
      timeout: 'Notifier timeout (ms)',
      timeoutHint: 'The notification process is killed after this long, so failures cannot pile up.',
      storage: 'Settings file',
      storageError: 'The settings file could not be read: {error}',
      test: 'Send test',
      testing: 'Sending…',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Restore defaults',
      resetConfirm: 'Restore the default settings? The current configuration will be overwritten.',
      saved: 'Saved.',
      dirty: 'Unsaved changes',
      saveFailed: 'Could not save: {error}',
      testOk: 'The test notification was sent through “{channel}”.',
      testFailed: 'The test notification failed: {error}',
      loading: 'Reading settings…',
      loadFailed: 'Could not read the settings: {error}',
      unavailable: 'The Host half is not running, so this plugin cannot be configured right now.',
      stats: '{deliveries} sent · {failures} failed',
      lastDelivery: 'Last delivery: {channel} · {state}',
      stateOk: 'ok',
      stateFailed: 'failed',
    }

    const CSS = `
.np-page{display:flex;flex-direction:column;gap:22px;max-width:680px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.np-head{display:flex;flex-direction:column;gap:4px}
.np-title{margin:0;font-size:16px;font-weight:500;line-height:1.4}
.np-desc{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.np-group{display:flex;flex-direction:column;border-top:0.5px solid var(--dsw-alias-border-l2);padding-top:14px}
.np-group-title{margin:0 0 4px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.np-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.np-field + .np-field{border-top:0.5px solid var(--dsw-alias-border-l2)}
.np-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.np-hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.np-input,.np-textarea{width:100%;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}
.np-input{height:34px;padding:0 12px}
.np-textarea{min-height:64px;padding:8px 12px;resize:vertical}
.np-input:focus-visible,.np-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.np-input:disabled,.np-textarea:disabled{color:var(--dsw-alias-label-tertiary)}
.np-inline{display:flex;align-items:center;gap:8px}
.np-inline .np-input{flex:1;min-width:0}
.np-row{display:flex;align-items:center;gap:12px;padding:12px 0}
.np-row + .np-row{border-top:0.5px solid var(--dsw-alias-border-l2)}
.np-row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.np-switch{position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.np-switch.is-on{background:var(--dsw-alias-brand-primary)}
.np-switch:disabled{cursor:default;opacity:.5}
.np-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.np-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
.np-switch:not(.is-on) .np-thumb{background:var(--dsw-alias-switch-thumb)}
.np-switch.is-on .np-thumb{transform:translateX(16px)}
.np-seg{display:inline-flex;gap:2px;padding:2px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}
.np-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.5;padding:4px 12px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.np-seg button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.np-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500}
.np-seg button:disabled{cursor:default;opacity:.5}
.np-route{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}
.np-route-head{display:flex;align-items:center;gap:8px}
.np-route-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.np-route-name{font-size:13px;font-weight:500}
.np-route-name.is-broken{color:var(--dsw-alias-state-error-primary)}
.np-route-path{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.np-route-path.is-missing{color:var(--dsw-alias-state-error-primary)}
.np-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}
.np-dot.is-broken{background:var(--dsw-alias-state-error-primary)}
.np-preview{border-left:2px solid var(--dsw-alias-border-l3);padding:2px 0 2px 10px;margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.np-actions{display:flex;align-items:center;gap:8px;padding-top:14px;border-top:0.5px solid var(--dsw-alias-border-l2)}
.np-spacer{flex:1;min-width:0}
.np-btn{height:32px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md);font:inherit;font-size:13px;line-height:1.5;cursor:pointer;color:var(--dsw-alias-label-primary);background:transparent}
.np-btn:disabled{cursor:default;opacity:.4}
.np-btn.primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.np-btn.outline{border:0.5px solid var(--dsw-alias-border-l3)}
.np-btn.outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.np-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.np-note{margin:0;font-size:12px;line-height:1.6}
.np-note.ok{color:var(--dsw-alias-label-tertiary)}
.np-note.bad{color:var(--dsw-alias-state-error-primary)}
`

    /** Format a dictionary string with `{name}` placeholders. */
    function format(text, params) {
      if (typeof text !== 'string') return ''
      if (params === undefined) return text
      return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
      ))
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        id: props.id,
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        className: `np-switch${props.checked ? ' is-on' : ''}`,
        disabled: props.disabled === true,
        onClick: () => props.onChange(!props.checked),
      }, h('span', { className: 'np-thumb' }))
    }

    function Row(props) {
      return h('div', { className: 'np-row' },
        h('div', { className: 'np-row-text' },
          h('label', { className: 'np-label', htmlFor: props.id }, props.label),
          props.hint ? h('p', { className: 'np-hint' }, props.hint) : null),
        props.children)
    }

    function Field(props) {
      return h('div', { className: 'np-field' },
        props.plain === true
          ? h('span', { className: 'np-label' }, props.label)
          : h('label', { className: 'np-label', htmlFor: props.id }, props.label),
        props.children,
        props.hint ? h('p', { className: 'np-hint' }, props.hint) : null,
        props.note ?? null)
    }

    function TextInput(props) {
      return h('input', {
        id: props.id,
        className: 'np-input',
        type: 'text',
        value: props.value,
        placeholder: props.placeholder,
        spellCheck: false,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function TextArea(props) {
      return h('textarea', {
        id: props.id,
        className: 'np-textarea',
        rows: props.rows ?? 2,
        value: props.value,
        placeholder: props.placeholder,
        spellCheck: false,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function Segmented(props) {
      return h('div', { className: 'np-seg', role: 'group', 'aria-label': props.label },
        props.options.map(option => h('button', {
          key: option.value,
          type: 'button',
          'aria-pressed': props.value === option.value ? 'true' : 'false',
          disabled: props.disabled === true,
          onClick: () => props.onChange(option.value),
        }, option.label)))
    }

    function NotifySection(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState({ kind: 'idle', text: '' })
      const [busy, setBusy] = React.useState('')
      const [preview, setPreview] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')

      const applySnapshot = React.useCallback((next) => {
        setSnapshot(next)
        setDraft(current => (current === null ? next.settings : current))
      }, [])

      const call = React.useCallback(async (action, payload) => {
        const response = await fetch(ROUTE, {
          method: action === 'get' ? 'GET' : 'POST',
          credentials: 'same-origin',
          headers: action === 'get' ? undefined : { 'content-type': 'application/json' },
          body: action === 'get' ? undefined : JSON.stringify({ action, ...(payload ?? {}) }),
        })
        const data = await response.json().catch(() => null)
        if (data === null) throw new Error(`HTTP ${response.status}`)
        if (data.ok !== true) throw new Error(typeof data.error === 'string' && data.error !== '' ? data.error : `HTTP ${response.status}`)
        return data
      }, [])

      React.useEffect(() => {
        let alive = true
        call('get')
          .then(data => { if (alive) applySnapshot(data) })
          .catch(error => { if (alive) setLoadError(error.message) })
        return () => { alive = false }
      }, [applySnapshot, call])

      if (loadError !== '') {
        return h('div', { className: 'np-page' }, h('style', null, CSS),
          h('div', { className: 'np-head' }, h('h2', { className: 'np-title' }, t('title'))),
          h('p', { className: 'np-note bad' }, format(t('loadFailed'), { error: loadError })))
      }
      if (snapshot === null || draft === null) {
        return h('div', { className: 'np-page' }, h('style', null, CSS),
          h('p', { className: 'np-hint' }, t('loading')))
      }

      const python = snapshot.python ?? { available: false }
      const powershell = snapshot.powershell ?? { available: false }
      const disabled = busy !== ''
      const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.settings)

      const patch = (path, value) => {
        setDraft((current) => {
          const next = { ...current }
          if (path.length === 1) next[path[0]] = value
          else next[path[0]] = { ...current[path[0]], [path[1]]: value }
          return next
        })
        setStatus({ kind: 'idle', text: '' })
      }
      const setTop = (key, value) => patch([key], value)
      const setGroup = (group, key, value) => patch([group, key], value)

      // The channel the Host would actually use for this draft, and why not.
      const effective = draft.channel === 'auto'
        ? (python.available ? 'python' : 'powershell')
        : draft.channel
      const brokenReason = effective === 'python' && !python.available
        ? t('reasonPythonUnavailable')
        : effective === 'powershell' && !powershell.available
          ? t('reasonPowerShellUnavailable')
          : effective === 'custom' && draft.custom.command.trim() === ''
            ? t('reasonCustomEmpty')
            : ''
      const routeName = brokenReason !== ''
        ? t('routeBroken')
        : effective === 'python' ? t('routePython') : effective === 'powershell' ? t('routePowerShell') : t('routeCustom')
      const configuredScript = effective === 'python'
        ? (draft.python.script.trim() === '' ? snapshot.scripts.python : draft.python.script)
        : effective === 'powershell'
          ? (draft.powershell.script.trim() === '' ? snapshot.scripts.powershell : draft.powershell.script)
          : draft.custom.command
      // Reported for the saved configuration, so a bad path is called out right
      // after saving it instead of silently failing at the next turn end.
      const scriptExists = effective === 'python'
        ? snapshot.scripts.pythonExists !== false
        : effective === 'powershell'
          ? snapshot.scripts.powershellExists !== false
          : true

      const pythonStatus = python.available
        ? format(python.version === '' ? t('pythonOkNoVersion') : t('pythonOk'), { executable: python.executable, version: python.version })
        : t('pythonMissing')
      const powershellStatus = powershell.available
        ? format(powershell.version === '' ? t('powershellOkNoVersion') : t('powershellOk'), { executable: powershell.executable, version: powershell.version })
        : t('powershellMissing')

      /** Turn a Host failure code into a sentence the page can show. */
      const explain = (code) => {
        if (code === 'python-unavailable') return t('reasonPythonUnavailable')
        if (code === 'powershell-unavailable') return t('reasonPowerShellUnavailable')
        if (code === 'custom-command-empty') return t('reasonCustomEmpty')
        return code
      }

      const run = async (name, task) => {
        setBusy(name)
        setStatus({ kind: 'idle', text: '' })
        try {
          await task()
        } catch (error) {
          setStatus({ kind: 'bad', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy('')
        }
      }

      const detect = () => run('detect', async () => {
        const data = await call('detect', { pythonExecutable: draft.python.executable })
        setSnapshot(data)
        const nextPython = data.python?.available
          ? format(data.python.version === '' ? t('pythonOkNoVersion') : t('pythonOk'), { executable: data.python.executable, version: data.python.version })
          : t('pythonMissing')
        const nextPowershell = data.powershell?.available
          ? format(data.powershell.version === '' ? t('powershellOkNoVersion') : t('powershellOk'), { executable: data.powershell.executable, version: data.powershell.version })
          : t('powershellMissing')
        setStatus({ kind: 'ok', text: format(t('detectOk'), { python: nextPython, powershell: nextPowershell }) })
      })

      const save = () => run('save', async () => {
        const data = await call('save', { settings: draft })
        applySnapshot(data)
        setDraft(data.settings)
        setStatus({ kind: 'ok', text: t('saved') })
      })

      const reset = () => {
        if (typeof window.confirm === 'function' && !window.confirm(t('resetConfirm'))) return
        void run('reset', async () => {
          const data = await call('reset')
          applySnapshot(data)
          setDraft(data.settings)
          setStatus({ kind: 'ok', text: t('saved') })
        })
      }

      const test = () => run('test', async () => {
        const data = await call('test', { settings: draft })
        setSnapshot(data.snapshot)
        setPreview({ title: data.report.title, message: data.report.message })
        setStatus(data.ok
          ? { kind: 'ok', text: format(t('testOk'), { channel: data.report.channel }) }
          : { kind: 'bad', text: format(t('testFailed'), { error: explain(data.report.error) }) })
      })

      const showPreview = () => run('preview', async () => {
        const data = await call('preview', { settings: draft })
        setPreview({ title: data.title, message: data.message })
      })

      const defaultPythonArgs = snapshot.defaults?.python?.args ?? ''
      const defaultPowershellArgs = snapshot.defaults?.powershell?.args ?? ''

      const channelPanel = effective === 'python'
        ? h('div', null,
          h(Field, { id: 'np-python-exe', label: t('pythonExecutable'), hint: t('executableHint') },
            h('div', { className: 'np-inline' },
              h(TextInput, { id: 'np-python-exe', value: draft.python.executable, placeholder: python.available ? python.executable : 'python', disabled, onChange: value => setGroup('python', 'executable', value) }),
              h('button', { type: 'button', className: 'np-btn outline', disabled, onClick: detect }, busy === 'detect' ? t('detecting') : t('detect')))),
          h(Field, { id: 'np-python-script', label: t('script'), hint: format(t('scriptHint'), { default: snapshot.scripts.python }) },
            h(TextInput, { id: 'np-python-script', value: draft.python.script, placeholder: snapshot.scripts.python, disabled, onChange: value => setGroup('python', 'script', value) })),
          h(Field, { id: 'np-python-args', label: t('argsTemplate'), hint: t('argsHint') },
            h(TextArea, { id: 'np-python-args', value: draft.python.args, placeholder: defaultPythonArgs, rows: 3, disabled, onChange: value => setGroup('python', 'args', value) })))
        : effective === 'powershell'
          ? h('div', null,
            h(Field, { id: 'np-ps-exe', label: t('powershellExecutable'), hint: t('powershellExecutableHint') },
              h('div', { className: 'np-inline' },
                h(TextInput, { id: 'np-ps-exe', value: draft.powershell.executable, placeholder: powershell.available ? powershell.executable : 'pwsh', disabled, onChange: value => setGroup('powershell', 'executable', value) }),
                h('button', { type: 'button', className: 'np-btn outline', disabled, onClick: detect }, busy === 'detect' ? t('detecting') : t('detect')))),
            h(Field, { id: 'np-ps-script', label: t('script'), hint: format(t('scriptHint'), { default: snapshot.scripts.powershell }) },
              h(TextInput, { id: 'np-ps-script', value: draft.powershell.script, placeholder: snapshot.scripts.powershell, disabled, onChange: value => setGroup('powershell', 'script', value) })),
            h(Field, { id: 'np-ps-args', label: t('argsTemplate'), hint: t('argsHint') },
              h(TextArea, { id: 'np-ps-args', value: draft.powershell.args, placeholder: defaultPowershellArgs, rows: 3, disabled, onChange: value => setGroup('powershell', 'args', value) })))
          : h('div', null,
            h(Field, { id: 'np-custom-command', label: t('command'), hint: t('commandHint') },
              h(TextInput, { id: 'np-custom-command', value: draft.custom.command, placeholder: 'pwsh.exe', disabled, onChange: value => setGroup('custom', 'command', value) })),
            h(Field, { id: 'np-custom-args', label: t('customArgs'), hint: t('customArgsHint') },
              h(TextArea, { id: 'np-custom-args', value: draft.custom.args, rows: 2, disabled, onChange: value => setGroup('custom', 'args', value) })))

      return h('div', { className: 'np-page' },
        h('style', null, CSS),
        h('div', { className: 'np-head' },
          h('h2', { className: 'np-title' }, t('title')),
          h('p', { className: 'np-desc' }, t('description'))),

        h('div', { className: 'np-group' },
          h('p', { className: 'np-group-title' }, t('groupBehavior')),
          h(Row, { id: 'np-enabled', label: t('enabled'), hint: t('enabledHint') },
            h(Switch, { id: 'np-enabled', label: t('enabled'), checked: draft.enabled, disabled, onChange: value => setTop('enabled', value) })),
          h(Row, { id: 'np-subagents', label: t('subagents'), hint: t('subagentsHint') },
            h(Switch, { id: 'np-subagents', label: t('subagents'), checked: draft.includeSubagents, disabled, onChange: value => setTop('includeSubagents', value) })),
          h(Field, { id: 'np-min-duration', label: t('minDuration'), hint: t('minDurationHint') },
            h(TextInput, { id: 'np-min-duration', value: String(draft.minDurationMs), disabled, onChange: value => setTop('minDurationMs', value) }))),

        h('div', { className: 'np-group' },
          h('p', { className: 'np-group-title' }, t('groupChannel')),
          h(Field, { id: 'np-channel', label: t('channelLabel'), hint: t('channelHint'), plain: true },
            h(Segmented, {
              label: t('groupChannel'),
              value: draft.channel,
              disabled,
              onChange: value => setTop('channel', value),
              options: [
                { value: 'auto', label: t('channelAuto') },
                { value: 'python', label: t('channelPython') },
                { value: 'powershell', label: t('channelPowerShell') },
                { value: 'custom', label: t('channelCustom') },
              ],
            })),
          h('div', { className: 'np-route' },
            h('div', { className: 'np-route-head' },
              h('span', { className: `np-dot${brokenReason !== '' ? ' is-broken' : ''}` }),
              h('span', { className: 'np-route-label' }, t('routeLabel')),
              h('span', { className: `np-route-name${brokenReason !== '' ? ' is-broken' : ''}` }, routeName)),
            brokenReason !== ''
              ? h('p', { className: 'np-note bad' }, brokenReason)
              : h('p', { className: `np-route-path${scriptExists ? '' : ' is-missing'}` },
                scriptExists ? configuredScript : `${configuredScript} — ${t('scriptMissing')}`),
            h('p', { className: 'np-route-path' }, `${t('channelPython')}: ${pythonStatus}`),
            h('p', { className: 'np-route-path' }, `${t('channelPowerShell')}: ${powershellStatus}`)),
          channelPanel),

        h('div', { className: 'np-group' },
          h('p', { className: 'np-group-title' }, t('groupText')),
          h(Field, { id: 'np-title-template', label: t('titleTemplate'), hint: format(t('templateHint'), { default: '{label}' }) },
            h(TextInput, { id: 'np-title-template', value: draft.titleTemplate, placeholder: '{label}', disabled, onChange: value => setTop('titleTemplate', value) })),
          h(Field, { id: 'np-message-template', label: t('messageTemplate'), hint: format(t('templateHint'), { default: '{sessionTitle}\\n{turnLine}{reasonLabel} · {duration}' }) },
            h(TextArea, { id: 'np-message-template', value: draft.messageTemplate, placeholder: '{sessionTitle}\\n{turnLine}{reasonLabel} · {duration}', rows: 3, disabled, onChange: value => setTop('messageTemplate', value) }),
            h('div', { className: 'np-inline' },
              h('button', { type: 'button', className: 'np-btn ghost', disabled, onClick: showPreview }, busy === 'preview' ? t('previewing') : t('preview')))),
          h('p', { className: 'np-hint' }, `${t('placeholders')}: ${(snapshot.placeholders ?? []).join(' ')}`),
          preview !== null
            ? h('div', { className: 'np-field' },
              h('span', { className: 'np-label' }, t('previewTitle')),
              h('p', { className: 'np-preview' }, preview.title),
              h('span', { className: 'np-label' }, t('previewMessage')),
              h('p', { className: 'np-preview' }, preview.message))
            : null),

        h('div', { className: 'np-group' },
          h('p', { className: 'np-group-title' }, t('groupAdvanced')),
          h(Field, { id: 'np-timeout', label: t('timeout'), hint: t('timeoutHint') },
            h(TextInput, { id: 'np-timeout', value: String(draft.timeoutMs), disabled, onChange: value => setTop('timeoutMs', value) })),
          h('p', { className: 'np-hint' }, `${t('storage')}: ${snapshot.storage?.file ?? ''}`),
          snapshot.storage?.error
            ? h('p', { className: 'np-note bad' }, format(t('storageError'), { error: snapshot.storage.error }))
            : null,
          h('p', { className: 'np-hint' }, format(t('stats'), { deliveries: snapshot.stats?.deliveries ?? 0, failures: snapshot.stats?.failures ?? 0 })),
          snapshot.stats?.last
            ? h('p', { className: 'np-hint' }, format(t('lastDelivery'), {
              channel: snapshot.stats.last.channel ?? '',
              state: snapshot.stats.last.ok ? t('stateOk') : `${t('stateFailed')}${snapshot.stats.last.error ? ` (${explain(snapshot.stats.last.error)})` : ''}`,
            }))
            : null),

        h('div', { className: 'np-actions' },
          h('button', { type: 'button', className: 'np-btn outline', disabled, onClick: test }, busy === 'test' ? t('testing') : t('test')),
          h('button', { type: 'button', className: 'np-btn ghost', disabled, onClick: reset }, t('reset')),
          h('span', { className: 'np-spacer' }),
          status.text !== '' || dirty
            ? h('span', { className: `np-note ${status.kind === 'bad' ? 'bad' : 'ok'}` }, status.text !== '' ? status.text : t('dirty'))
            : null,
          h('button', { type: 'button', className: 'np-btn primary', disabled: disabled || !dirty, onClick: save },
            busy === 'save' ? t('saving') : t('save'))),
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-notify: dictionaries')
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-plugin-notify',
        order: 40,
        label: () => t('nav'),
        locale: NS,
      }, NotifySection))
    }

    return { inject, apply }
  },
})
