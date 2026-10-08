# Notifications · @hope_phenom/dsh-plugin-notify

**English** | [简体中文](README.zh.md)

A standard [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin that posts a **desktop notification whenever a turn ends**.

It is the notification feature of the old DSH tray helper (DshNotifyicon), re-implemented as a standalone plugin. It needs **no tray process** and no `DSH_NOTIFY` stdout protocol: the plugin runs inside the Host, subscribes to `session/event`, and therefore works however DSH was started (tray helper, `dsh web`, desktop app).

## Features

- **Notifies on every `turn/end`**, with optional notifications for subagents/subtasks.
- **Picks a channel automatically**: the bundled Python script when Python is available, and the bundled PowerShell notifier otherwise — no setup required first.
- **Fully customizable**: any executable plus an argument template with placeholders, the equivalent of the tray helper's external command.
- **Its own Settings page**: a dedicated "Notifications" section with channel selection, interpreter/script paths, argument and text templates, a live preview, a test send, and delivery statistics.
- **Quiet by design**: a minimum-duration threshold and a hard timeout on the notifier process.
- **Cross-platform**: Windows system balloon / WinRT toast, macOS `osascript`, Linux `notify-send` (see the platform matrix below).
- **Atomic configuration**: a damaged settings file falls back to defaults with a visible explanation instead of breaking the plugin.

## Install

Prerequisite: DSH (desktop app or `dsh web`) already runs a profile — `desktop` below.

**Option A — from the UI (recommended)**

1. Open the sidebar **Plugins** page → Install → choose the local-directory option and give this repository's absolute path (for example `F:\WorkSpace\dsh-plugin-notify`).
2. When the install finishes, click **Enable now**.
3. A newly installed bundle activates through HMR; restart DSH if the UI does not react.
4. Configure it under **Settings → Notifications**.

**Option B — from the command line**

```powershell
# Quit the DSH desktop app first: it holds a lock on the profile directory.
& "C:\Users\<you>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "F:\WorkSpace\dsh-plugin-notify"
```

> - Always pass an **absolute path**: a relative spec is resolved against your shell's directory, and a bare directory name is treated as an npm package name.
> - The `desktop` profile can only be managed by the desktop app's own `dsh.cmd`, which is the path above.
> - Installing a new bundle applies live; **replacing** an installed package of the same name needs a process restart to load a fresh JS module generation.

Uninstall from the Plugins page, or with `dsh plugin --profile desktop remove @hope_phenom/dsh-plugin-notify`.

## The Settings page

**Settings → Notifications** has four groups:

| Group | Contents |
|---|---|
| When to notify | Master switch; also notify for subagents; minimum turn duration in ms (0 notifies every turn) |
| Delivery channel | Auto / Python / PowerShell / Custom command, plus an **effective route** status line; below it, the interpreter path, script path and argument template for the chosen channel, and a re-detect button |
| Notification text | Title template, body template, the available placeholders, and a text preview |
| Advanced | Notifier timeout, settings-file location, sent/failed counters, and the last delivery result |

Three actions at the bottom: **Send test** (a real notification through the current configuration), **Restore defaults**, **Save**.

### Channel semantics

| Channel | Behavior |
|---|---|
| **Auto** (default) | Uses the bundled `scripts/notify.py` when Python is found; otherwise the bundled `scripts/notify.ps1` |
| **Python** | Forces Python. A blank interpreter auto-detects (`python`, `python3`, `py` in order); a blank script uses the bundled one |
| **PowerShell** | Forces PowerShell. A blank interpreter auto-detects (`pwsh`, `powershell`, then the built-in absolute path) |
| **Custom command** | You supply the executable and the argument template — the tray helper's external command, generalized |

### Placeholders

Usable in argument templates and text templates:

| Placeholder | Meaning |
|---|---|
| `{label}` | Event label (`DSH turn complete` / `DSH 回答完成`, following the system language) |
| `{sessionTitle}` | Session title (`Untitled session` when there is none) |
| `{sessionId}` / `{parentSessionId}` | Session id / parent session id |
| `{turn}` | Turn number |
| `{reason}` / `{reasonLabel}` | Raw end reason / localized label (completed, aborted, error, max tokens, …) |
| `{duration}` / `{durationMs}` | Duration (`12.3 s` / `12300`) |
| `{event}` / `{kind}` | `turn-end` / `root` or `subagent` |
| `{cwd}` / `{project}` | Session working directory / its last path segment |
| `{time}` | Notification timestamp |
| `{title}` / `{message}` | Composed title / body (the body template may use `{title}`) |

Argument templates split on spaces, so quote any section containing spaces. **A lone placeholder is passed as exactly one argument**, which keeps a multi-line body intact in `--message {message}`. Text templates accept real line breaks and a typed `\n`.

The bundled scripts accept `--title`, `--message`, `--event`, `--kind`, `--session`, `--turn`, `--reason` and `--duration-ms`.

### Reusing your own Python script

Point the Python channel at it and adjust the argument template, e.g. for an existing `send_notification.py`:

```
{script} {message} --title {title}
```

That script used `notifypy`; the bundled script prefers `notifypy` too, so behavior matches.

### Bundled notifier fallbacks

`notify.py` tries **notifypy** first (it ships a notifier for Windows, macOS and Linux), then the platform's own tool — **win11toast** on Windows, **osascript** on macOS, **notify-send** on Linux — and finally the sibling **notify.ps1**. Everything beyond the standard library is optional: used when installed, skipped when not.

`notify.ps1` is a **cross-platform dispatcher**: on Windows it dot-sources `notify.windows.ps1` (a `Shell_NotifyIcon` balloon, shown as a normal Windows 10/11 notification and needing no registered AppUserModelID, falling back to a WinRT toast); on macOS it hands over to `osascript`; on Linux to `notify-send`. Only the Windows branch is ever parsed, so no Windows-only API is touched elsewhere.

Both scripts can report the command they *would* run without sending anything, which is how another platform's branch is checked from any machine:

```powershell
python scripts/notify.py --dry-run --platform macOS --title T --message M
python scripts/notify.py --dry-run --backend notify-send --title T --message M
pwsh -File scripts/notify.ps1 -DryRun -Platform Linux -Title T -Message M
```

### Platform support

| Capability | Windows | macOS | Linux |
|---|---|---|---|
| Plugin load / detection / Settings page | ✅ | ✅ | ✅ |
| Python channel | ✅ notifypy or the bundled ps1 | ✅ built-in osascript backend (notifypy preferred when installed) | ✅ built-in notify-send backend (notifypy preferred when installed) |
| PowerShell channel | ✅ bundled balloon/WinRT | ✅ with pwsh installed, forwards to osascript | ✅ with pwsh installed, forwards to notify-send |
| Custom command channel | ✅ | ✅ (commonly `osascript`) | ✅ (commonly `notify-send`) |

Interpreter detection skips Windows' Microsoft Store `python.exe` aliases and macOS's `/usr/bin` system shims, probing the real path instead — so detection itself never opens a Store page or an "install developer tools" dialog.

## Configuration storage

```
%USERPROFILE%\.dsh\storages\dsh-plugin-notify\settings.json
```

`$DSH_HOME` wins when it is set. Writes are atomic (temp file + rename). A corrupt file falls back to defaults and the Settings page reports why.

## Relationship to the tray helper

[DshNotifyicon](https://github.com/Hope-Phenom/dsh-desktop-tray) is **untouched**; the two can coexist:

- The tray helper's notification feature only works when that helper started dsh (it injects `DSH_NOTIFY_ENABLED=1` and parses `DSH_NOTIFY` lines from stdout), and it allows a single external command.
- This plugin lives in the Host, works however DSH was started, and natively supports several channels plus preview, test and statistics. Running both simply produces two notifications — turn one of them off.

## Development

```
dsh-plugin-notify/
├─ package.json          dsh.bundle.patch + dsh.client (platform web)
├─ cordis.patch.yml      inserts one Host row (id: dsh-plugin-notify)
├─ lib/
│  ├─ core.js            pure logic: settings normalization, template/argv expansion, text composition, channel resolution
│  ├─ index.js           Host half: settings file, session/event, process delivery, /api/dsh/dsh-plugin-notify route
│  └─ client.js          browser half: the Settings page (no build step; react comes from the browser module table)
├─ scripts/notify.py     bundled Python notifier (multi-platform)
├─ scripts/notify.ps1    bundled PowerShell notifier (cross-platform entry point)
├─ scripts/notify.windows.ps1  the Windows-only implementation (balloon + WinRT toast)
├─ locale/{en,zh}.json   plugin card title and description
└─ test/ + tools/smoke.mjs
```

```powershell
npm test                       # 22 unit tests (core logic, settings IO, process running, Python detection, both scripts' platform branches)
python tools/check-backends.py # per-platform fallback chain, with missing libraries simulated
npm run smoke                  # end to end: real HTTP route + turn pipeline + a real render of the Settings page
npm run smoke -- --notify      # additionally sends one real notification through each of auto / python / powershell
```

The smoke run needs no DSH installation: it starts a real HTTP server with the plugin's route, drives every action with real `fetch` calls, and renders the Settings page through a minimal hook runtime using a strict locale reader — so a missing string in either language fails the run. The macOS and Linux branches of both notifier scripts are checked with `--dry-run` from any platform, no Mac required.

### Two deliberate design choices

1. **A self-owned `settings.json` plus a self-registered HTTP route, instead of a `Config` schema with volatile fields.** A profile-installed bundle cannot `import '@deepseek-ai/schemastery'` at runtime (those packages live inside the DSH installation's asar, not in the profile's `node_modules`), and free-form configuration such as executable paths does not belong in the profile's `cordis.patch.yml`.
2. **`settings.section` for the page.** That is the official slot for a dedicated Settings page (the skin manager and cost meter both use it), and every style here reuses host tokens, so the page follows the light and dark themes like a native one.

## Known limitations

- Delivery is always an external process (bundled script or custom command); there is no browser notification inside the DSH Web page.
- The configured interpreter and script must exist. The Settings page names a bad path but will not install Python for you.
- A notifier that exceeds the timeout is killed (15 s by default), so failures cannot pile up.
- No "only when the window is unfocused" mode: the Host cannot see front-end focus. Use the minimum-duration threshold instead.
- On macOS the Python channel prefers `notifypy` and falls back to the system `osascript` (icons are not supported). To avoid Python entirely, install `pwsh` and use the PowerShell channel. Linux behaves the same way through `notify-send`.

## License

MIT
