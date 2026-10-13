# 各工具配置参考

本文档列出 kimi-sound-hook 在每个 agent 工具中的配置文件位置、注册方式与已知限制。所有工具的 hook 命令统一为：

```
node "<play-sound.mjs 绝对路径，正斜杠>" --tool <工具标识>
```

payload 一律由工具以 JSON 写入 stdin，播放器读取 `hook_event_name` 并按工具归一化为 `sounds.json` 中的 12 个通用事件名（`agent_end`、`input`、`session_start`、`session_end`、`permission_request`、`ask_user_question:start`、`ask_user_question:result`、`agent_end_failure`、`tool_execution_error`、`interrupt`、`subagent_start`、`subagent_stop`）。

## Kimi Code（`kimi`）

- 配置文件：`~/.kimi-code/config.toml`（`KIMI_CODE_HOME` 环境变量可覆盖根目录）
- 格式：TOML，事件注册为 `[[hooks]]` 块
- 生效方式：重启 Kimi Code 或新开一个会话

## Claude Code（`claude`）

- 配置文件：`~/.claude/settings.json`
- 格式：JSON
- 查看注册状态：在 Claude Code 中使用 `/hooks` 菜单

## Codex CLI（`codex`）

- 配置文件：`~/.codex/hooks.json`（`CODEX_HOME` 环境变量可覆盖根目录）
- 格式：JSON
- 首次使用：注册后需在 Codex TUI 中执行 `/hooks`，审查并信任这些 hook，之后才会触发
- 事件缺口：无工具执行出错事件（`tool_execution_error` 不触发）、无向用户提问事件（`ask_user_question:*` 不触发）

## Gemini CLI（`gemini`）

- 配置文件：`~/.gemini/settings.json`
- 格式：JSON
- 版本要求：**v0.26.0 及以上**（更早版本没有 hooks 支持）
- 事件缺口：无向用户提问事件（`ask_user_question:*` 不触发）、无子代理事件（`subagent_start` / `subagent_stop` 不触发）

## Cursor（`cursor`）

- 配置文件：`~/.cursor/hooks.json`
- 格式：JSON
- 生效方式：配置保存即热重载，无需重启
- 事件缺口：无权限请求事件（`permission_request` 不触发）、无提问事件、无子代理事件
- `stop` 事件的 `status` 字段用于区分结局：`error` 归一化为 `agent_end_failure`，`aborted` 归一化为 `interrupt`

## Continue（`continue`）

- 配置文件：`~/.continue/settings.json`
- 格式：JSON
- 12 个通用事件全覆盖

## 备份与卸载

- 安装器/卸载器在改动任何配置文件之前，都会先把它复制为 `<配置文件>.YYYYMMDD-HHMMSS.bak`。
- 卸载只删除指向本项目 `play-sound.mjs` 的条目，配置中的其他内容原样保留。
- `node install.mjs --list` / `node uninstall.mjs --list` 可查看全部支持工具的本机检测与注册状态。
