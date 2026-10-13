#!/usr/bin/env node
// kimi-sound-hook 多工具适配器：集中描述 6 个 agent 工具的
// 配置路径、hook 配置格式、幂等合并（merge）与按标记移除（remove）逻辑。
// install.mjs / uninstall.mjs 共用本模块，保证写入与删除使用同一份格式定义。
//
// 每个适配器的契约：
//   id / displayName       工具标识与中文展示名
//   configDir()            配置目录（detect 以此为依据）
//   configPath()           配置文件绝对路径
//   detect()               配置目录存在即视为已安装该工具
//   isInstalled(content)   配置内容含 play-sound.mjs 即视为本项目 hook 已注册
//   buildHooks(playerPath) 生成该工具格式的 hook 配置（kimi 为 TOML 文本，其余为 event -> 条目数组）
//   merge(content, playerPath)  幂等合并进现有配置内容，返回新内容（保留原有其他键）
//   remove(content)        删除所有含 play-sound.mjs 的 hook 条目，返回 { content, removed }
//   notes                  安装成功后的下一步指引（中文）
//   skeleton               配置文件不存在时创建的骨架内容
//   eventNames             注册的事件名列表（用于安装报告）

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const PLAYER_MARKER = 'play-sound.mjs';

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

const KIMI_MARKER_COMMENT = '# --- kimi-sound-hook 音效 hooks（卸载：运行 uninstall.mjs） ---';

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
  let updated = kept.join('\n');
  updated = updated.replace(/\n?# --- kimi-sound-hook 音效 hooks（卸载：运行 uninstall\.mjs） ---\n?/, '\n');
  updated = updated.replace(/\n{3,}/g, '\n\n');
  return { content: updated, removed };
}

const kimiDir = () => envOrHome('KIMI_CODE_HOME', '.kimi-code');

const kimi = {
  id: 'kimi',
  displayName: 'Kimi Code',
  eventNames: KIMI_EVENTS.map((e) => e.event),
  notes: ['重启 Kimi Code 或新开一个会话，hooks 才会生效。'],
  skeleton: '# Kimi Code 配置文件（由 kimi-sound-hook 安装器创建）\n',
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
      name: 'kimi-sound-hook',
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
