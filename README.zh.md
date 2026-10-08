# 通知增强 · @hope_phenom/dsh-plugin-notify

[English](README.md) | **简体中文**

[![Test](https://github.com/Hope-Phenom/dsh-plugin-notify/actions/workflows/test.yml/badge.svg)](https://github.com/Hope-Phenom/dsh-plugin-notify/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个标准的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件：**每轮回答结束时发一条桌面通知**。

> 仓库：[github.com/Hope-Phenom/dsh-plugin-notify](https://github.com/Hope-Phenom/dsh-plugin-notify)

它把原先 DSH 托盘助手（DshNotifyicon）里的「通知增强」抽了出来，作为独立插件实现——**不需要托盘程序**，也**不需要**再往 dsh 的 stdout 里打 `DSH_NOTIFY` 协议行：插件本身就跑在 Host 里，直接订阅 `session/event`，所以它在任何启动方式下都生效（托盘工具、`dsh web`、桌面端都一样）。

## 特性

- **轮次结束即通知**（`turn/end`），子代理/子任务完成可选一并通知
- **自动挑通道**：检测到 Python 就用内置 Python 脚本；没有 Python 就回退到内置 PowerShell 通知器——开箱即用，不需要你先配任何东西
- **跨平台**：Windows 用系统气泡/WinRT Toast，macOS 用 `osascript`，Linux 用 `notify-send`（见下方平台支持）
- **完全可自定义**：任意可执行文件 + 参数模板（占位符），等价于旧托盘工具的「外部命令」
- **自带设置页**：DSH 设置里的独立一项「通知」，含通道选择、解释器/脚本路径、参数模板、文案模板、实时预览、测试通知与投递统计
- **不打扰**：可设最短时长阈值（很短的回合不通知）、通知进程超时保护
- **配置原子写**：损坏的配置文件自动回退默认值并给出提示，不会让插件起不来

## 安装

先决条件：DSH 桌面端或 `dsh web` 已经在用某个 profile（本文以 `desktop` 为例）。

**方式 A：界面安装（推荐）**

1. 打开侧边栏 **插件** 页 → 安装 → 选择「本地目录」，填入本仓库的绝对路径（例如 `F:\WorkSpace\dsh-plugin-notify`）。
2. 安装完成后点 **立即启用**。
3. 新安装的 bundle 会通过 HMR 直接生效；如果界面没反应，重启一次 DSH。
4. 打开 **设置 → 通知** 开始配置。

**方式 B：命令行安装**

```powershell
# 需要先完全退出 DSH 桌面端：profile 目录在运行时被加锁
& "C:\Users\<你>\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "F:\WorkSpace\dsh-plugin-notify"
```

> - 路径一律用**绝对路径**（相对路径按调用目录解析，裸目录名会被当成 npm 包名）。
> - `desktop` profile 只能由桌面端自己的 `dsh.cmd` 管理，因此必须用上面这个路径调用。
> - 安装新 bundle 可以热生效；**替换**已装的同名包必须重启进程才能加载新的 JS 模块代。

卸载：在插件页移除该 bundle，或 `dsh plugin --profile desktop remove @hope_phenom/dsh-plugin-notify`。

## 设置页

**设置 → 通知**，四组：

| 分组 | 内容 |
|---|---|
| 通知时机 | 启用通知总开关；子代理/子任务完成时也通知；最短通知时长（毫秒，0 = 每轮都通知） |
| 通知通道 | 投递方式（自动 / Python / PowerShell / 自定义命令）+ 一条**实际生效**状态条；下面按所选方式显示解释器路径、脚本路径、参数模板，以及「重新检测」 |
| 通知文案 | 标题模板、正文模板、可用占位符清单、预览文案 |
| 其他 | 通知进程超时、设置文件位置、累计发送/失败统计、最近一次投递结果 |

底部三个动作：**测试通知**（真发一条，走的就是当前配置）、**恢复默认**、**保存**。

### 通道语义

| 方式 | 行为 |
|---|---|
| **自动**（默认） | 检测到 Python → 用内置 `scripts/notify.py`；没有 → 用内置 `scripts/notify.ps1` |
| **Python** | 强制走 Python；解释器留空自动检测（依次 `python`、`python3`、`py`），脚本留空用内置脚本 |
| **PowerShell** | 强制走 PowerShell；解释器留空自动检测（依次 `pwsh`、`powershell`、系统自带绝对路径） |
| **自定义命令** | 你自己给可执行文件与参数模板，等价于旧托盘工具的外部命令 |

### 占位符

写在参数模板与文案模板里：

| 占位符 | 含义 |
|---|---|
| `{label}` | 事件标签（如 `DSH 回答完成` / `DSH turn complete`，随系统语言） |
| `{sessionTitle}` | 会话标题（取不到时为 `未命名会话`） |
| `{sessionId}` / `{parentSessionId}` | 会话 id / 父会话 id |
| `{turn}` | 轮次号 |
| `{reason}` / `{reasonLabel}` | 结束原因原值 / 本地化文案（已完成、已中止、出错、达到长度上限……） |
| `{duration}` / `{durationMs}` | 耗时（`12.3 s` / `12300`） |
| `{event}` / `{kind}` | `turn-end` / `root` 或 `subagent` |
| `{cwd}` / `{project}` | 会话工作目录 / 其最后一段目录名 |
| `{time}` | 通知时刻 |
| `{title}` / `{message}` | 组合后的标题 / 正文（正文模板里可用 `{title}`） |

参数模板按空格分词，带空格的整段用引号包住；**单独的占位符会作为一整个参数传入**，所以 `--message {message}` 不会把多行正文拆散。文案模板里可以直接按回车换行，也可以写 `\n`。

内置脚本接受 `--title` / `--message` / `--event` / `--kind` / `--session` / `--turn` / `--reason` / `--duration-ms`。

### 复用你自己的 Python 脚本

把 Python 通道的参数模板改成你脚本的调用方式即可，例如沿用 `E:\QuickStart\send_notification.py`：

```
{script} {message} --title {title}
```

再把「脚本路径」填成那个 `.py` 的绝对路径。旧脚本用的是 `notifypy`，内置脚本同样优先用 `notifypy`，所以行为一致。

### 内置脚本的回退顺序

`notify.py` 先试 **notifypy**（Windows/macOS/Linux 都自带通知器），再按平台试 **win11toast**（Windows）、**osascript**（macOS）、**notify-send**（Linux），最后同目录的 **notify.ps1**。除标准库以外全是可选的：装上就用，没装就跳过。

`notify.ps1` 是**跨平台分发器**：Windows 上点源同目录的 `notify.windows.ps1`（先 `Shell_NotifyIcon` 气泡，Win10/11 显示为系统通知、无需注册 AppUserModelID，失败再退 WinRT Toast）；macOS 上转交 `osascript`；Linux 上转交 `notify-send`。只有 Windows 分支才会被解析，因此这里不会在别的平台上碰到 Windows 专属 API。

两个脚本都能「只报告不发送」地打印将要执行的命令，用来在任意机器上核对别的平台会跑什么：

```powershell
python scripts/notify.py --dry-run --platform macOS --title T --message M
python scripts/notify.py --dry-run --backend notify-send --title T --message M
pwsh -File scripts/notify.ps1 -DryRun -Platform Linux -Title T -Message M
```

### 平台支持

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| 插件加载 / 检测 / 设置页 | ✅ | ✅ | ✅ |
| Python 通道 | ✅ notifypy 或内置 ps1 | ✅ 内置 osascript 后端（装了 notifypy 则优先） | ✅ 内置 notify-send 后端（装了 notifypy 则优先） |
| PowerShell 通道 | ✅ 内置气泡/WinRT | ✅ 装了 pwsh 即可，转交 osascript | ✅ 装了 pwsh 即可，转交 notify-send |
| 自定义命令通道 | ✅ | ✅（常用 `osascript`） | ✅（常用 `notify-send`） |

探测解释器时 Windows 会跳过 Microsoft Store 的 `python.exe` 别名、macOS 会跳过 `/usr/bin` 下的系统 shim 并直接探测真实路径——避免探测动作本身弹商店页面或「安装开发者工具」对话框。

## 配置存储

```
%USERPROFILE%\.dsh\storages\dsh-plugin-notify\settings.json
```

`$DSH_HOME` 存在时以它为准。写入是「临时文件 + 重命名」的原子写；文件损坏时插件回退默认值，并在设置页提示原因。

## 与旧托盘工具的关系

[DshNotifyicon](https://github.com/Hope-Phenom/dsh-desktop-tray) **未做任何改动**，两者可以并存：

- 旧工具的通知增强依赖它启动 dsh 时注入 `DSH_NOTIFY_ENABLED=1`，再由 `dsh-notify-hook` 往 stdout 打协议行；只有「由托盘工具启动 dsh」时才生效，且外部命令只能配一条。
- 本插件跑在 Host 内，任何启动方式都生效，且原生支持多通道、预览、测试与统计。两者同时开启就是两条通知，按需关掉其中一个即可。

## 开发

```
dsh-plugin-notify/
├─ package.json          dsh.bundle.patch + dsh.client（平台 web）
├─ cordis.patch.yml      插入一个 Host 行（id: dsh-plugin-notify）
├─ lib/
│  ├─ core.js            纯逻辑：设置归一化、模板/argv 展开、文案组合、通道解析
│  ├─ index.js           Host 半边：设置文件、session/event、进程投递、/api/dsh/dsh-plugin-notify 路由
│  └─ client.js          浏览器半边：设置页（无构建步骤，react 由浏览器模块表提供）
├─ scripts/notify.py     内置 Python 通知器（多平台）
├─ scripts/notify.ps1    内置 PowerShell 通知器（按平台分发的跨平台入口）
├─ scripts/notify.windows.ps1  Windows 专属实现（气泡 + WinRT Toast）
├─ locale/{en,zh}.json   插件卡片显示名与描述
└─ test/ + tools/smoke.mjs
```

```powershell
npm test                       # 22 个单元测试（核心逻辑、配置读写、进程执行、Python 探测、两个脚本的跨平台分支）
python tools/check-backends.py # 逐平台核对回退链（模拟缺 notifypy / 缺工具的场景）
npm run smoke                  # 端到端：真 HTTP 路由 + 轮次管线 + 把设置页真实渲染一遍
npm run smoke -- --notify      # 额外用 auto / python / powershell 三条通道各真发一条桌面通知
```

冒烟脚本不需要安装进 DSH 就能跑：它起一个真 HTTP server 挂上插件的路由、用真 `fetch` 驱动全部动作、用迷你 hook 运行时把设置页渲染出来（并用严格字典校验，缺任何一条中英文文案都会失败）。两个通知脚本的 macOS/Linux 分支用 `--dry-run` 在任意平台上核对，不必等一台 Mac。

### 两个刻意的设计取舍

1. **不用 `Config` + volatile 设置命名空间，而是自持 `settings.json` + 自注册 HTTP 路由。** 本插件是 profile 安装的 bundle，运行时**无法** `import '@deepseek-ai/schemastery'` 这类包（它们在 DSH 安装目录的 asar 里，不在 profile 的 `node_modules` 里）。自定义命令、端口式路径这类自由文本配置也不适合塞进 profile 的 `cordis.patch.yml`。
2. **自带设置页用 `settings.section`。** 这是官方在设置里开独立页面的槽位（皮肤管理、用量统计插件都用它），样式全部沿用宿主 token，因此深浅色主题下与原生页面一致。

## 已知限制

- 只提供「外部进程」通道（内置脚本或自定义命令），不会在 DSH Web 页面里弹浏览器通知。
- 通知依赖设置页里配置的解释器/脚本真实存在；路径写错时设置页会在状态条上点名，但不会替你安装 Python。
- 通知进程超时会被强杀（默认 15 s），因此不会堆积。
- 不做「仅窗口失焦时通知」：Host 侧拿不到前端焦点状态，需要的话请用最短时长阈值或干脆关掉托盘气泡。
- macOS 上 Python 通道优先用 `notifypy`，没装就自动改用系统自带的 `osascript`（图标不支持）；完全不想装 Python 就装 `pwsh` 走 PowerShell 通道。Linux 同理（`notify-send`）。

## 许可证

MIT
