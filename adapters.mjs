#!/usr/bin/env node
// sound-hook-ui 多工具适配器：集中描述 8 个 agent 工具的
// 配置路径、hook 配置格式、幂等合并（merge）与按标记移除（remove）逻辑。
// install.mjs / uninstall.mjs 共用本模块，保证写入与删除使用同一份格式定义。
//
// 每个适配器的契约：
//   id / displayName       工具标识与中文展示名
//   configDir()            配置目录（detect 以此为依据）
//   configPath()           配置文件绝对路径
//   detect()               配置目录存在即视为已安装该工具
//   isInstalled(content)   配置内容含本项目标记（play-sound.mjs 或 glue 注释）即视为已注册
//   buildHooks(playerPath) 生成该工具格式的 hook 配置
//                          （kimi 为 TOML 文本，pi 为 glue 源码，deepseek/JSON 工具为 event -> 条目数组）
//   merge(content, playerPath)  幂等合并进现有配置内容，返回新内容（保留原有其他键）；
//                          可抛出 skipToolError() 构造的错误，install.mjs 将打印中文警告并跳过该工具
//   remove(content)        删除本项目注册的条目，返回 { content, removed }
//   removeFiles?(configPath)    可选：存在时 uninstall.mjs 在备份后用它替代「写回 remove 结果」
//                          （如 pi 直接删除扩展文件）
//   notes                  安装成功后的下一步指引（中文）
//   skeleton               配置文件不存在时创建的骨架内容
//   eventNames             注册的事件名列表（用于安装报告）

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// 仓库根目录（本文件位于根目录）：deepseek 的 integrations/deepseek-hooks.json 生成在这里。
const ADAPTERS_ROOT = dirname(fileURLToPath(import.meta.url));

const PLAYER_MARKER = 'play-sound.mjs';

// 构造「跳过该工具」错误：install.mjs 捕获后打印中文警告并跳过，不计为失败。
export function skipToolError(message) {
  const err = new Error(message);
  err.skipTool = true;
  return err;
}

// --- 通用小工具 ---------------------------------------------------------------

export function timestampName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function envOrHome(envName, fallbackDir) {
  const value = process.env[envName];
  if (value && value.trim()) return value.trim();
  return join(os.homedir(), fallbackDir);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 判断一个 hook 条目是否由本项目注册（命令或参数中引用了 play-sound.mjs）。
function referencesPlayer(value) {
  if (value === undefined || value === null) return false;
  return JSON.stringify(value).includes(PLAYER_MARKER);
}

function parseJsonConfig(content) {
  if (!content || !content.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`配置文件不是合法的 JSON：${err.message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error('配置文件的根节点不是 JSON 对象，为避免破坏配置未做改动');
  }
  return parsed;
}

// --- kimi（Kimi Code）：TOML [[hooks]] 块追加 / 按块删除 ------------------------

const KIMI_EVENTS = [
  { event: 'PreToolUse', matcher: 'AskUserQuestion' },
  { event: 'PermissionRequest' },
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'Stop' },
  { event: 'UserPromptSubmit' },
];

const KIMI_MARKER_COMMENT = '# --- sound-hook-ui 音效 hooks（卸载：运行 uninstall.mjs） ---';

function kimiBuildHooks(playerPath) {
  // TOML 基本字符串内层双引号以 \" 转义；路径统一用正斜杠，避免反斜杠转义问题。
  const command = `node \\"${playerPath}\\" --tool kimi`;
  return KIMI_EVENTS.map(({ event, matcher }) => {
    const lines = ['[[hooks]]', `event = "${event}"`];
    if (matcher) lines.push(`matcher = "${matcher}"`);
    lines.push(`command = "${command}"`, 'timeout = 5');
    return lines.join('\n');
  }).join('\n\n');
}

function kimiMerge(content, playerPath) {
  if (content.includes(PLAYER_MARKER)) return content;
  const separator = content.endsWith('\n') || content === '' ? '\n' : '\n\n';
  return `${content}${separator}${KIMI_MARKER_COMMENT}\n${kimiBuildHooks(playerPath)}\n`;
}

function kimiRemove(content) {
  // 按块解析：一个块从 "[[hooks]]" 行开始，到下一个以 "[" 开头的行（或文件末尾）结束。
  // 块内 command 含 "play-sound.mjs" 的视为本项目注册的 hook，整段删除。
  const lines = content.split('\n');
  const kept = [];
  let removed = 0;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === '[[hooks]]') {
      const block = [lines[i]];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('[')) {
        block.push(lines[i]);
        i += 1;
      }
      const text = block.join('\n');
      if (/^\s*command\s*=.*play-sound\.mjs/m.test(text)) {
        removed += 1;
        continue; // 丢弃该块
      }
      kept.push(...block);
    } else {
      kept.push(lines[i]);
      i += 1;
    }
  }

  if (removed === 0) return { content, removed: 0 };

  // 清理删除后可能留下的本项目注释行与多余空行
  // 注释标记需同时匹配旧名 kimi-sound-hook 与新名 sound-hook-ui，以清除旧版安装的残留。
  let updated = kept.join('\n');
  updated = updated.replace(/\n?# --- (?:kimi-sound-hook|sound-hook-ui) 音效 hooks（卸载：运行 uninstall\.mjs） ---\n?/, '\n');
  updated = updated.replace(/\n{3,}/g, '\n\n');
  return { content: updated, removed };
}

const kimiDir = () => envOrHome('KIMI_CODE_HOME', '.kimi-code');

const kimi = {
  id: 'kimi',
  displayName: 'Kimi Code',
  eventNames: KIMI_EVENTS.map((e) => e.event),
  notes: ['重启 Kimi Code 或新开一个会话，hooks 才会生效。'],
  skeleton: '# Kimi Code 配置文件（由 sound-hook-ui 安装器创建）\n',
  configDir: kimiDir,
  configPath: () => join(kimiDir(), 'config.toml'),
  detect: () => existsSync(kimiDir()),
  isInstalled: (content) => typeof content === 'string' && content.includes(PLAYER_MARKER),
  buildHooks: kimiBuildHooks,
  merge: kimiMerge,
  remove: kimiRemove,
};

// --- JSON 工具通用工厂 ----------------------------------------------------------
//
// 事件定义形如 { event: 'SessionStart', matcher?: 'AskUserQuestion' }。
// makeInner(playerPath) 生成最内层 hook 条目；wrapEntry 决定条目如何挂到事件数组上：
//   layeredEntry —— claude/codex/gemini/continue 的三层结构 { matcher?, hooks: [<条目>] }
//   flatEntry    —— cursor 的扁平结构，条目直接放进事件数组
// ensureTopLevel 可在合并时补齐顶层字段（cursor 需要保留 version: 1）。

function layeredEntry(inner, matcher) {
  return matcher ? { matcher, hooks: [inner] } : { hooks: [inner] };
}

function flatEntry(inner) {
  return inner;
}

function jsonAdapter({ id, displayName, configDir, configFile, events, makeInner, wrapEntry, ensureTopLevel, notes }) {
  const buildHooks = (playerPath) => {
    const hooks = {};
    for (const { event, matcher } of events) {
      hooks[event] = [wrapEntry(makeInner(playerPath), matcher)];
    }
    return hooks;
  };

  return {
    id,
    displayName,
    eventNames: events.map((e) => e.event),
    notes,
    skeleton: '{}\n',
    configDir,
    configPath: () => join(configDir(), configFile),
    detect: () => existsSync(configDir()),
    isInstalled: (content) => typeof content === 'string' && content.includes(PLAYER_MARKER),
    buildHooks,

    merge(content, playerPath) {
      const obj = parseJsonConfig(content);
      if (ensureTopLevel) ensureTopLevel(obj);
      if (obj.hooks !== undefined && !isPlainObject(obj.hooks)) {
        throw new Error('配置文件中的 hooks 字段不是对象，为避免破坏配置未做改动');
      }
      const hooks = obj.hooks ?? {};
      obj.hooks = hooks;
      const ours = buildHooks(playerPath);
      for (const [event, entries] of Object.entries(ours)) {
        const existing = hooks[event];
        if (existing === undefined) {
          hooks[event] = entries;
          continue;
        }
        if (!Array.isArray(existing)) {
          throw new Error(`配置文件中 hooks.${event} 不是数组，为避免破坏配置未做改动`);
        }
        if (existing.some(referencesPlayer)) continue; // 该事件已注册过本项目的 hook
        hooks[event] = [...existing, ...entries];
      }
      return `${JSON.stringify(obj, null, 2)}\n`;
    },

    remove(content) {
      if (!content.includes(PLAYER_MARKER)) return { content, removed: 0 };
      const obj = parseJsonConfig(content);
      if (!isPlainObject(obj.hooks)) return { content, removed: 0 };
      let removed = 0;
      const hooks = obj.hooks;
      for (const event of Object.keys(hooks)) {
        const arr = hooks[event];
        if (!Array.isArray(arr)) continue;
        const kept = [];
        for (const entry of arr) {
          if (isPlainObject(entry) && Array.isArray(entry.hooks)) {
            // 三层结构：只丢内层指向 play-sound.mjs 的条目，同层其他 hook 保留
            const innerKept = entry.hooks.filter((h) => !referencesPlayer(h));
            removed += entry.hooks.length - innerKept.length;
            if (innerKept.length > 0) kept.push({ ...entry, hooks: innerKept });
          } else if (referencesPlayer(entry)) {
            removed += 1;
          } else {
            kept.push(entry);
          }
        }
        if (kept.length > 0) hooks[event] = kept;
        else delete hooks[event]; // 数组被清空说明该事件下只有本项目的条目
      }
      if (removed === 0) return { content, removed: 0 };
      if (Object.keys(hooks).length === 0) delete obj.hooks;
      return { content: `${JSON.stringify(obj, null, 2)}\n`, removed };
    },
  };
}

// --- 各工具事件表 ----------------------------------------------------------------

const CLAUDE_EVENTS = [
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'Stop' },
  { event: 'UserPromptSubmit' },
  { event: 'PermissionRequest' },
  { event: 'PreToolUse', matcher: 'AskUserQuestion' },
  { event: 'PostToolUseFailure' },
  { event: 'StopFailure' },
  { event: 'SubagentStart' },
  { event: 'SubagentStop' },
];

const CODEX_EVENTS = [
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'Stop' },
  { event: 'UserPromptSubmit' },
  { event: 'PermissionRequest' },
  { event: 'Interrupt' },
  { event: 'SubagentStart' },
  { event: 'SubagentStop' },
];

const GEMINI_EVENTS = [
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'BeforeAgent' },
  { event: 'AfterAgent' },
  { event: 'Notification' },
  { event: 'AfterTool' },
];

const CURSOR_EVENTS = [
  { event: 'sessionStart' },
  { event: 'sessionEnd' },
  { event: 'stop' },
  { event: 'beforeSubmitPrompt' },
  { event: 'postToolUseFailure' },
];

// --- deepseek（DeepSeek Harness，CLI 名 dsh）：桥接插件 hooks.json + profile 补丁 ----------
//
// 官方桥接插件 @deepseek-ai/dsh-hooks-claude-code 把 dsh 事件桥接为 Claude Code 方言
// （stdin JSON、字段 hook_event_name、Claude Code 风格三层 hooks.json）。安装分两步：
//   1. 在仓库根目录生成 integrations/deepseek-hooks.json（桥接仅支持 7 个事件）
//   2. 向 ~/.dsh/profiles/web/cordis.patch.yml 追加指向该文件的 YAML 列表项

const DEEPSEEK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStart',
  'SubagentStop',
];

const deepseekDir = () => envOrHome('DSH_HOME', '.dsh');
// integrations/deepseek-hooks.json 位于仓库内，与 DSH_HOME/沙盒无关。
const deepseekHooksFile = () => join(ADAPTERS_ROOT, 'integrations', 'deepseek-hooks.json');
const DEEPSEEK_YAML_MARK = 'deepseek-hooks.json';

function deepseekBuildHooks(playerPath) {
  const command = `node "${playerPath.replace(/\\/g, '/')}" --tool deepseek`;
  const hooks = {};
  for (const event of DEEPSEEK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 5 }] }];
  }
  return hooks;
}

// 幂等重写 integrations/deepseek-hooks.json（内容只取决于播放器路径）。
function deepseekWriteHooksFile(playerPath) {
  const file = deepseekHooksFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ hooks: deepseekBuildHooks(playerPath) }, null, 2)}\n`, 'utf8');
}

function deepseekYamlBlock() {
  const configPath = deepseekHooksFile().replace(/\\/g, '/');
  return [
    `- name: '@deepseek-ai/dsh-hooks-claude-code'`,
    `  config:`,
    `    configPath: '${configPath}'`,
  ].join('\n');
}

const deepseek = {
  id: 'deepseek',
  displayName: 'DeepSeek Harness (dsh)',
  eventNames: DEEPSEEK_EVENTS,
  notes: [
    '还需运行 `dsh plugin --profile web add @deepseek-ai/dsh-hooks-claude-code` 安装桥接插件（仅一次），并重启 dsh web。',
  ],
  skeleton: '',
  configDir: deepseekDir,
  configPath: () => join(deepseekDir(), 'profiles', 'web', 'cordis.patch.yml'),
  detect: () => existsSync(deepseekDir()),
  // YAML 已指向本项目的 hooks.json 且该文件存在，才视为已安装（文件丢失时允许重装补回）。
  isInstalled: (content) =>
    typeof content === 'string' && content.includes(DEEPSEEK_YAML_MARK) && existsSync(deepseekHooksFile()),
  buildHooks: deepseekBuildHooks,

  merge(content, playerPath) {
    // 无论 YAML 状态如何，先保证仓库内的 hooks.json 存在且为最新内容。
    deepseekWriteHooksFile(playerPath);
    if (content.includes(DEEPSEEK_YAML_MARK)) return content; // 幂等：已指向本文件
    const trimmed = content.trimStart();
    const startsWithListItem = trimmed.startsWith('- ') || /^-(?=\r?$)/.test(trimmed);
    if (trimmed !== '' && !startsWithListItem) {
      throw skipToolError(
        'cordis.patch.yml 已有内容且不是以 "- " 开头的列表结构（可能是 dict 等其他结构），为避免破坏配置未做改动；' +
          `请手动为 @deepseek-ai/dsh-hooks-claude-code 添加 configPath 指向 ${deepseekHooksFile().replace(/\\/g, '/')}`,
      );
    }
    const separator = content === '' || content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}${deepseekYamlBlock()}\n`;
  },

  remove(content) {
    // 按 YAML 顶层列表项整块删除：块从 "- " 起始行开始，到下一个 "- " 起始行（或文件末尾）结束。
    // 含标记的块整段丢弃，其余内容（含注释与空行）原样保留。
    let removed = 0;
    let updated = content;
    if (content.includes(DEEPSEEK_YAML_MARK)) {
      const lines = content.split('\n');
      const kept = [];
      let i = 0;
      while (i < lines.length) {
        if (/^-(?=\s|$)/.test(lines[i])) {
          const block = [lines[i]];
          i += 1;
          while (i < lines.length && !/^-(?=\s|$)/.test(lines[i])) {
            block.push(lines[i]);
            i += 1;
          }
          if (block.join('\n').includes(DEEPSEEK_YAML_MARK)) {
            removed += 1;
            continue; // 丢弃该块
          }
          kept.push(...block);
        } else {
          kept.push(lines[i]);
          i += 1;
        }
      }
      updated = kept.join('\n').replace(/\n{3,}/g, '\n\n');
    }
    // 反向第 2 步：删除仓库内的 integrations/deepseek-hooks.json（不影响 removed 计数）。
    rmSync(deepseekHooksFile(), { force: true });
    if (removed === 0) return { content, removed: 0 };
    return { content: updated, removed };
  },
};

// --- pi（Pi agent）：进程内 TypeScript 扩展 glue ------------------------------------------
//
// pi 自动发现 ~/.pi/agent/extensions/<name>/index.ts。安装即把 glue 扩展写入
// extensions/sound-hook-ui/index.ts，把生命周期事件转发给 play-sound.mjs；卸载即删除该文件。

const PI_GLUE_MARKER = '// sound-hook-ui glue';
const piDir = () => envOrHome('PI_HOME', '.pi');
const piExtensionFile = () => join(piDir(), 'agent', 'extensions', 'sound-hook-ui', 'index.ts');

function piGlueSource(playerPath) {
  const player = playerPath.replace(/\\/g, '/');
  return `// sound-hook-ui glue —— 把 Pi 生命周期事件转发给播放器，可安全删除（卸载即删此文件）
import { spawn } from 'node:child_process';
const PLAYER = '${player}';
function playSound(event, payload = {}) {
  try {
    const child = spawn('node', [PLAYER, '--tool', 'pi'], { stdio: ['pipe', 'ignore', 'ignore'], detached: true, windowsHide: true });
    child.on('error', () => {});
    child.stdin.end(JSON.stringify({ tool: 'pi', event, ...payload }));
    child.unref();
  } catch {}
}
export default function (pi) {
  pi.on('session_start', async (e) => playSound('session_start', { reason: e && e.reason }));
  pi.on('session_shutdown', async (e) => playSound('session_end', { reason: e && e.reason }));
  pi.on('input', async (e) => { if (e && e.source === 'extension') return { action: 'continue' }; playSound('input', { source: e && e.source }); return { action: 'continue' }; });
  pi.on('agent_settled', async () => playSound('agent_end'));
  pi.on('tool_execution_end', async (e) => { if (e && e.isError) playSound('tool_execution_error', { toolName: e.toolName }); });
}
`;
}

const pi = {
  id: 'pi',
  displayName: 'Pi agent',
  eventNames: ['session_start', 'session_end', 'input', 'agent_end', 'tool_execution_error'],
  notes: ['重启 pi 或在会话中执行 /reload 后，音效扩展才会生效。'],
  skeleton: '',
  configDir: () => join(piDir(), 'agent'),
  configPath: piExtensionFile,
  detect: () => existsSync(join(piDir(), 'agent')),
  isInstalled: (content) => typeof content === 'string' && content.includes(PI_GLUE_MARKER),
  buildHooks: (playerPath) => piGlueSource(playerPath),

  merge(content, playerPath) {
    if (content.includes(PI_GLUE_MARKER)) return content; // 幂等：已是本项目的 glue
    if (content.trim() !== '') {
      throw skipToolError(
        `扩展文件 ${piExtensionFile()} 已存在但不含 sound-hook-ui 标记，为避免覆盖未做改动；` +
          '请手动备份并删除该文件后重新安装',
      );
    }
    return piGlueSource(playerPath);
  },

  remove(content) {
    // 卸载方式是删除整个文件（见 removeFiles），这里只按标记确认归属。
    if (!content.includes(PI_GLUE_MARKER)) return { content, removed: 0 };
    return { content: '', removed: 1 };
  },

  // uninstall.mjs 在备份后调用：删除 glue 文件；目录空了则连同 sound-hook-ui 目录删除。
  removeFiles(configPath) {
    rmSync(configPath, { force: true });
    const dir = dirname(configPath);
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // 目录删除失败（例如同目录留有卸载备份 .bak）不影响卸载结果
    }
  },
};

// --- 工具清单 ---------------------------------------------------------------------

export const TOOLS = [
  kimi,
  jsonAdapter({
    id: 'claude',
    displayName: 'Claude Code',
    configDir: () => join(os.homedir(), '.claude'),
    configFile: 'settings.json',
    events: CLAUDE_EVENTS,
    makeInner: (playerPath) => ({
      type: 'command',
      command: 'node',
      args: [playerPath, '--tool', 'claude'],
      timeout: 5,
    }),
    wrapEntry: layeredEntry,
    notes: ['重启 Claude Code 或新开一个会话，hooks 才会生效。'],
  }),
  jsonAdapter({
    id: 'codex',
    displayName: 'Codex CLI',
    configDir: () => envOrHome('CODEX_HOME', '.codex'),
    configFile: 'hooks.json',
    events: CODEX_EVENTS,
    makeInner: (playerPath) => ({
      type: 'command',
      command: `node "${playerPath}" --tool codex`,
      timeout: 5,
    }),
    wrapEntry: layeredEntry,
    notes: ['重启 Codex CLI 或新开一个会话，并在 TUI 中执行 /hooks 信任本项目的 hooks 后才会生效。'],
  }),
  jsonAdapter({
    id: 'gemini',
    displayName: 'Gemini CLI',
    configDir: () => join(os.homedir(), '.gemini'),
    configFile: 'settings.json',
    events: GEMINI_EVENTS,
    makeInner: (playerPath) => ({
      type: 'command',
      name: 'sound-hook-ui',
      command: `node "${playerPath}" --tool gemini`,
      timeout: 5000,
    }),
    wrapEntry: layeredEntry,
    notes: ['重启 Gemini CLI 或新开一个会话，hooks 才会生效。'],
  }),
  jsonAdapter({
    id: 'cursor',
    displayName: 'Cursor',
    configDir: () => join(os.homedir(), '.cursor'),
    configFile: 'hooks.json',
    events: CURSOR_EVENTS,
    makeInner: (playerPath) => ({
      command: `node "${playerPath}" --tool cursor`,
      timeout: 10,
    }),
    wrapEntry: flatEntry,
    ensureTopLevel: (obj) => { if (obj.version === undefined) obj.version = 1; },
    notes: ['Cursor 会在 hooks.json 保存后热重载，无需重启。'],
  }),
  jsonAdapter({
    id: 'continue',
    displayName: 'Continue cn CLI',
    configDir: () => join(os.homedir(), '.continue'),
    configFile: 'settings.json',
    events: CLAUDE_EVENTS,
    makeInner: (playerPath) => ({
      type: 'command',
      command: 'node',
      args: [playerPath, '--tool', 'continue'],
      timeout: 5,
    }),
    wrapEntry: layeredEntry,
    notes: ['重启 Continue cn CLI 或新开一个会话，hooks 才会生效。'],
  }),
  deepseek,
  pi,
];

// --- 供安装器/卸载器共用的辅助 -----------------------------------------------------

export function getTool(id) {
  return TOOLS.find((tool) => tool.id === id);
}

// 解析 --tool <id>（可多次使用或逗号分隔，也接受 --tool=<id>）与 --list。
export function parseToolArgs(argv) {
  const ids = [];
  let list = false;
  const collect = (value) => {
    for (const piece of value.split(',')) {
      const id = piece.trim();
      if (id) ids.push(id);
    }
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') {
      list = true;
    } else if (arg === '--tool') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--tool 后面需要跟工具 id（可用 --list 查看可选值）。');
      }
      collect(value);
      i += 1;
    } else if (arg.startsWith('--tool=')) {
      collect(arg.slice('--tool='.length));
    } else {
      throw new Error(`未知参数：${arg}（仅支持 --tool <id> 与 --list）。`);
    }
  }
  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!getTool(id)) {
      throw new Error(`不支持的工具 id：${id}（可选：${TOOLS.map((t) => t.id).join(', ')}）。`);
    }
  }
  return { ids: unique, list };
}

// 汇总单个工具的检测/安装状态（供 --list 与卸载器的自动检测使用）。
export function toolStatus(tool) {
  const configPath = tool.configPath();
  let installed = false;
  if (existsSync(configPath)) {
    try {
      installed = tool.isInstalled(readFileSync(configPath, 'utf8'));
    } catch {
      installed = false;
    }
  }
  return { configPath, detected: tool.detect(), installed };
}
