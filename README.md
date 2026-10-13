# kimi-sound-hook

**多 agent 工具通用的 hook 音效系统 + 可视化管理器**：给 Kimi Code、Claude Code、Codex、Gemini CLI、Cursor、Continue 等 AI 编程工具的生命周期事件（任务完成、提交输入、会话开始/结束、权限审批、向你提问……）配上提示音，并用一个零依赖的本地 Web 界面挑选、试听、管理音效。

## 特性

- 🧰 **多 agent 工具支持**：一套音效配置同时接入 6 个工具——Kimi Code、Claude Code、Codex CLI、Gemini CLI、Cursor、Continue；安装器自动检测本机已装哪些并全部注册
- 🔔 **12 个通用事件**：任务完成、提交输入、会话开始/结束、权限审批、提问/回答、任务失败、工具出错、中断、子代理启停；各工具原生事件由播放器自动归一化
- 🖱 **可视化管理器**：零依赖本地 Web UI（默认端口 23177），点选音效、浏览器内试听、真实链路试听、单音/随机/关闭三种模式
- 📦 **内置原创音效**：`sounds/starter/` 6 个程序合成的 WAV（MIT），开箱即用
- 🧩 **专辑机制**：`sounds/<专辑名>/` 目录即专辑，放 WAV 进去就能在管理器里挑
- 💾 **安全保存**：安装/卸载与管理器保存都会先备份带时间戳的 `.bak`
- 🪟 **Windows 优先**：播放走 PowerShell `SoundPlayer`，安装/卸载/启动都是双击可用的 bat
- 🍃 **零依赖**：全部 Node.js 标准库，不需要 `npm install`

## 效果图

![音效管理器](docs/screenshot.png)

## 环境要求

- **Windows**（播放机制是 PowerShell `System.Media.SoundPlayer`，其他操作系统未适配）
- **Node.js >= 18**（安装器/卸载器/管理器均为纯 Node，无需 npm install）
- [ffmpeg](https://ffmpeg.org/download.html)（可选，仅 `tools/download-pack.mjs` 需要）

## 支持的工具

| 工具 | `--tool` 标识 | 配置文件 | 格式 |
| --- | --- | --- | --- |
| Kimi Code | `kimi` | `~/.kimi-code/config.toml`（可用 `KIMI_CODE_HOME` 覆盖） | TOML `[[hooks]]` |
| Claude Code | `claude` | `~/.claude/settings.json` | JSON |
| Codex CLI | `codex` | `~/.codex/hooks.json`（可用 `CODEX_HOME` 覆盖） | JSON |
| Gemini CLI | `gemini` | `~/.gemini/settings.json` | JSON |
| Cursor | `cursor` | `~/.cursor/hooks.json` | JSON |
| Continue | `continue` | `~/.continue/settings.json` | JSON |

所有工具注册的 hook 命令统一为 `node "<play-sound.mjs 绝对路径>" --tool <标识>`；payload 一律从 stdin 以 JSON 读入，播放器按各工具的事件名自动归一化到统一的 12 个事件。

各工具注意事项：

- **Kimi Code**：安装后重启或新开一个会话生效。
- **Claude Code**：可在 Claude Code 中用 `/hooks` 菜单查看 hook 注册状态。
- **Codex CLI**：首次注册后需在 Codex TUI 中执行 `/hooks`，审查并信任这些 hook 后才会生效。
- **Gemini CLI**：需要 **v0.26.0 及以上**版本才有 hooks 支持。
- **Cursor**：配置文件保存即热重载，无需重启；Cursor 没有独立的权限请求事件，`permission_request` 音效在 Cursor 下不会触发。
- **Continue**：开箱即用。

更详细的配置位置、注册方式与限制见 [docs/supported-tools.md](docs/supported-tools.md)。

### 能力覆盖矩阵

同一套 `sounds.json` 事件名在各工具下的触发情况：

| 工具 | 任务完成 | 会话开始 | 会话结束 | 提交输入 | 权限请求 | 提问 | 工具出错 | 中断 | 子代理启停 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Kimi Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Claude Code | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex CLI | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Gemini CLI | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Cursor | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Continue | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

说明：

- **Codex** 没有工具执行出错与向用户提问的 hook 事件。
- **Cursor** 没有权限请求、提问与子代理事件；其 `stop` 事件的 `status` 字段可区分结局——`error` 映射为任务失败（`agent_end_failure`），`aborted` 映射为中断（`interrupt`）。
- **Gemini CLI** 没有提问与子代理事件。
- 标 ❌ 的事件在该工具下不会触发，但不影响其余事件的使用；管理器中仍可为它们配置音效，只是该工具永远不会播放。

## 快速开始

三种安装方式任选其一。安装器会**自动检测本机已安装哪些 agent 工具，并把音效 hooks 全部注册进去**（写配置前自动备份，重复运行安全，只动自己注册的条目）。

### 方式 A：一键安装（推荐给普通用户）

Windows 下右键开始菜单，打开「Windows PowerShell」（或 Windows Terminal），粘贴下面一行并回车：

```powershell
powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/Yang-ChenRui/kimi-sound-hook/main/install-remote.ps1)"
```

> 提示：部分安全软件会拦截 `irm ... | iex` 这种管道写法（报「拒绝访问 / Permission denied」）。上面的 `iex (irm ...)` 写法可以正常通过；若仍被拦截，改用下方「方式 B」手动下载即可。

这一行命令会自动完成：

1. 检查 Node.js >= 18（缺失或过旧时给出安装指引并停止）；
2. 从 GitHub 下载仓库压缩包，解压到 `%USERPROFILE%\kimi-sound-hook`；
3. 运行安装器 `install.mjs`：检测本机已装的 agent 工具，把 hooks 注册进它们各自的配置文件；
4. 打印下一步指引。

**升级**：再次运行同一行命令即可。目录已存在时，脚本会先把你的 `sounds.json` 和 `sounds/` 备份出来，装好新版后再原样放回——自定义专辑与音效选择全部保留；旧目录会改名为 `kimi-sound-hook.old-<时间戳>` 留作兜底。

装完后**双击 `%USERPROFILE%\kimi-sound-hook\音效管理.bat`** 打开可视化管理器换音效，然后新开一个 agent 会话即可听到提示音。

### 方式 B：手动安装（git 用户）

```bash
git clone https://github.com/Yang-ChenRui/kimi-sound-hook.git
cd kimi-sound-hook
```

然后**双击 `install.bat`**（或在命令行运行 `node install.mjs`）。安装器会：

1. 检测本机已安装的 agent 工具（按上表找各工具的配置文件）；
2. 把每个工具的原配置备份为 `<配置文件>.<时间戳>.bak`；
3. 向每个检测到的工具注册音效 hooks，命令统一为 `node "<play-sound.mjs 绝对路径>" --tool <标识>`。

常用参数：

```bash
node install.mjs            # 自动检测并注册全部已装工具
node install.mjs --list     # 列出全部支持的工具及本机检测/注册状态
node install.mjs --tool claude,cursor   # 只注册指定的工具（可逗号分隔多个）
```

装完按上表「各工具注意事项」操作（如 Codex 需 `/hooks` 信任），然后双击 `音效管理.bat` 打开管理器挑选音效。

### 方式 C：让 AI Agent 帮你安装

把下面这段提示词直接粘贴给 Kimi Code / Claude Code / Codex 等 AI 编程助手，让它替你完成安装：

```text
请帮我安装 kimi-sound-hook（多 agent 工具通用的音效 hook + 可视化管理器）：

1. 检查本机 node 版本 >= 18，没有就提示我安装 Node.js（https://nodejs.org）并停止。
2. 把仓库克隆到一个合适的目录：git clone https://github.com/Yang-ChenRui/kimi-sound-hook.git
   （若目录已存在则改为 git pull；本机没有 git 就下载
   https://github.com/Yang-ChenRui/kimi-sound-hook/archive/refs/heads/main.zip 并解压）。
3. 在仓库目录运行 `node install.mjs --list` 查看支持的工具与检测状态，然后运行
   `node install.mjs` 完成 hook 注册（它会自动检测本机已装的 agent 工具并全部注册，
   写配置前自动备份，重复运行安全；也可以用 --tool 指定只装某几个）。
4. 运行 `node manager/server.mjs` 启动音效管理器，并打开 http://127.0.0.1:23177
   让我挑音效（或者告诉我双击仓库里的「音效管理.bat」）。
5. 最后提醒我做收尾：Codex 需要先在 TUI 里执行 /hooks 审查并信任 hook；
   其他工具新开一个会话即可。hooks 会在会话开始、任务完成、请求审批等事件时播放音效。

仓库 README: https://github.com/Yang-ChenRui/kimi-sound-hook
```

### 使用

**双击 `音效管理.bat`**（非中文环境用 `sound-manager.bat`），浏览器会打开管理器界面：

- 每个事件一张卡片：「单个 / 随机 / 关闭」三种模式；
- 「＋ 添加音效」从音效库专辑中挑选；
- 「▶」在浏览器里试听单个音效；「🔊 试听此事件」走真实 hook 播放链路（电脑上实际出声）；
- 点「保存」写回 `sounds.json`（自动备份原文件）。

`sounds.json` 只有一份，所有工具共用——配一次，处处生效。

## 工作原理

```
各 agent 工具的生命周期事件
        │  （由适配层按各工具的配置格式注册 hook：TOML 或 JSON）
        ▼
node play-sound.mjs --tool <工具标识>
        │  （hook payload 从 stdin 读入，按工具归一化为 12 个通用事件名）
        ▼
读同目录 sounds.json，挑出该事件配置的 WAV
        │
        ▼
PowerShell SoundPlayer.PlaySync()   ← 独立最小化窗口播放，异步不阻塞 CLI
```

各工具的配置文件位置与格式（TOML `[[hooks]]`、各种 JSON 结构）互不相同，由安装器的适配层统一处理；`sounds.json` 的 12 个事件名不变。

`play-sound.mjs` 与 `sounds.json` 位于同一目录，音效路径全部相对该目录解析，因此仓库克隆到任何位置都能工作。

## 添加自己的音效

1. 在 `sounds/` 下新建目录（如 `sounds/MyPack/`），放入 `.wav` 文件；
2. 打开管理器 → 「＋ 添加音效」→ 选择对应专辑即可。

素材网站推荐（注意各自许可）：

- [効果音ラボ](https://soundeffect-lab.info/) —— 免费可用，但**禁止再分发**，仅供本机个人使用；
- [Mixkit](https://mixkit.co/free-sound-effects/) —— Mixkit License，免费可商用；
- [Pixabay](https://pixabay.com/sound-effects/) —— Pixabay Content License，免费可商用。

非 WAV 格式请先转码：`ffmpeg -i input.mp3 -ar 44100 -ac 2 -c:a pcm_s16le output.wav`

## 动漫音效包（可选）

喜欢动漫风格的提示音，可以运行仓库自带的下载脚本（需要 ffmpeg）：

```bash
node tools/download-pack.mjs
```

脚本会从効果音ラボ下载 16 个动漫语音/音效并转码为 WAV，保存到 `sounds/Anime/`，之后在管理器中选择 Anime 专辑即可使用。这些素材仅供个人使用、禁止再分发，请遵守効果音ラボ的使用条款。

## 卸载

**双击 `uninstall.bat`**（或 `node uninstall.mjs`）：自动检测并从各工具的配置中删除本项目注册的 hook 条目（先自动备份），配置里的其余内容原样保留。与安装器一样支持 `--list` 查看状态、`--tool claude,cursor` 指定只卸载某几个工具。仓库目录与音效文件需手动删除。

## 配置备份机制

- **安装/卸载时**：每个被修改的工具配置文件先复制为 `<配置文件>.YYYYMMDD-HHMMSS.bak` 再改动；
- **管理器保存时**：原 `sounds.json` 先复制为 `sounds.json.YYYYMMDD-HHMMSS.bak` 再覆盖。

出问题把对应 `.bak` 改回原名即可。

## 路线图

- **Goose、Windsurf**：payload 字段名与现有工具不同，适配器计划中；
- **OpenCode、Amp**：需要一个胶水插件桥接其扩展机制，计划中；
- **Aider**：没有 hooks 机制，无法支持。

## 同类项目

- [peon-ping](https://github.com/PeonPing/peon-ping) —— 面向 Claude Code/Codex/IDE 的游戏角色语音通知，跨平台、音效包生态丰富；
- [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) —— 盯着 AI coding agent 的像素桌面宠物，音效只是其提醒手段之一；
- [echook](https://github.com/ChanMeng666/echook) —— Claude Code/Cursor/Codex 的音频通知，26 个 hook、TTS、webhook；
- [claude-code-hooks-sound-system](https://github.com/PCPrincipal67/claude-code-hooks-sound-system)、[bugu](https://github.com/LearnPrompt/bugu) —— Claude Code 生态的 hook 音效方案。

本项目的差异：**多 agent 工具支持**（一套音效配置同时接入 6 个工具，自动检测全装）、**自带零依赖可视化管理 UI**（选音效/试听/保存全自动备份）、**Windows 优先**（bat 一键安装/卸载，双击即用）。

## License

- 代码（`play-sound.mjs`、`manager/`、`install.mjs` 等）：[MIT](LICENSE)；
- `sounds/starter/` 内置音效：程序合成的原创音效，同样以 MIT 发布；
- 用户自行下载的素材（如 `sounds/Anime/`）：归各自作者/站点所有，请遵守其许可条款。

---

### English summary

**kimi-sound-hook** adds sound effects to the lifecycle events of six AI coding agents — [Kimi Code](https://github.com/MoonshotAI/kimi-code), Claude Code, Codex CLI, Gemini CLI, Cursor and Continue — via each tool's native hooks system. One shared `sounds.json` maps 12 normalized events (task done, user input, session start/end, permission requests, questions, errors, interrupts, subagent start/stop) to WAV files; per-tool config formats (TOML `[[hooks]]` for Kimi Code, JSON for the rest) and event names are handled by an adapter layer, and every hook invokes the same player as `node "<abs path to play-sound.mjs>" --tool <id>`. It ships with a zero-dependency local web manager (port 23177) to pick, preview and assign sounds per event, six original program-synthesized starter WAVs (MIT), double-click Windows installers/uninstallers that auto-detect installed agents and register them all (with `--tool` and `--list` options) using timestamped config backups, and an optional downloader for a 16-sound anime pack (personal use only). Windows-first (PowerShell `SoundPlayer` backend), Node.js >= 18, no npm dependencies. Paths are derived relative to the repo root, so it works from any clone location.

One-line install on Windows (paste into PowerShell or Windows Terminal): `powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/Yang-ChenRui/kimi-sound-hook/main/install-remote.ps1)"`. The script downloads the repo to `%USERPROFILE%\kimi-sound-hook`, detects which agents are installed, registers the hooks in all of them, and preserves your custom `sounds.json` and `sounds/` when upgrading. Some security tools block the `irm ... | iex` pipe form; if that happens, use the `iex (irm ...)` form above or download `install-remote.bat` manually. Afterwards double-click `音效管理.bat` (or `sound-manager.bat`) in the install folder to open the sound manager. Tool-specific notes: Codex requires reviewing and trusting the hooks via `/hooks` in its TUI once, Gemini CLI needs v0.26.0+, Cursor hot-reloads its config on save and has no permission-request event, and Claude Code shows registration status in its `/hooks` menu.
