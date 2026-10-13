#!/usr/bin/env node
// kimi-sound-hook 安装器：把 6 个音效 hook 注册进 Kimi Code 的 config.toml。
// 零依赖 Node ESM 脚本，幂等，可重复运行。

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAYER_PATH = resolve(ROOT, 'play-sound.mjs').replace(/\\/g, '/');

function fail(message) {
  console.error(`[安装失败] ${message}`);
  process.exit(1);
}

function timestampName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

// --- 环境检查 ---------------------------------------------------------------

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  fail(`需要 Node.js >= 18，当前版本为 ${process.version}。请先升级 Node.js。`);
}

const kimiHome = process.env.KIMI_CODE_HOME && process.env.KIMI_CODE_HOME.trim()
  ? process.env.KIMI_CODE_HOME.trim()
  : join(os.homedir(), '.kimi-code');
const CONFIG_PATH = join(kimiHome, 'config.toml');

console.log('[kimi-sound-hook] 安装程序');
console.log(`  KIMI_CODE_HOME：${kimiHome}`);
console.log(`  目标配置文件：${CONFIG_PATH}`);
console.log(`  播放器路径：  ${PLAYER_PATH}`);

if (!existsSync(PLAYER_PATH)) {
  fail(`未找到播放器 ${PLAYER_PATH}，请确认本脚本位于仓库根目录且仓库完整。`);
}

// --- 读取（必要时创建）config.toml -------------------------------------------

const SKELETON = '# Kimi Code 配置文件（由 kimi-sound-hook 安装器创建）\n';

let original;
if (existsSync(CONFIG_PATH)) {
  try {
    original = readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    fail(`无法读取 ${CONFIG_PATH}：${err.message}。请检查文件权限。`);
  }
} else {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, SKELETON, 'utf8');
    console.log('  配置文件不存在，已创建骨架文件。');
    original = SKELETON;
  } catch (err) {
    fail(`无法创建 ${CONFIG_PATH}：${err.message}。请检查目录权限。`);
  }
}

// --- 幂等检查 -----------------------------------------------------------------

if (original.includes('play-sound.mjs')) {
  console.log('');
  console.log('[已安装] config.toml 中已存在 play-sound.mjs 的 hook 配置，本次未做改动。');
  console.log('如需重新安装，请先运行 uninstall.mjs（或双击 uninstall.bat）。');
  process.exit(0);
}

// --- 备份 ---------------------------------------------------------------------

const backupPath = `${CONFIG_PATH}.${timestampName(new Date())}.bak`;
try {
  copyFileSync(CONFIG_PATH, backupPath);
  console.log(`  已备份原配置：${backupPath}`);
} catch (err) {
  fail(`备份失败，未做任何修改：${err.message}`);
}

// --- 追加 hooks ---------------------------------------------------------------

const HOOKS = [
  { event: 'PreToolUse', matcher: 'AskUserQuestion' },
  { event: 'PermissionRequest' },
  { event: 'SessionStart' },
  { event: 'SessionEnd' },
  { event: 'Stop' },
  { event: 'UserPromptSubmit' },
];

// TOML 基本字符串内层双引号以 \" 转义；路径统一用正斜杠，避免反斜杠转义问题。
const command = `node \\"${PLAYER_PATH}\\"`;
const blocks = HOOKS.map((h) => {
  const lines = ['[[hooks]]', `event = "${h.event}"`];
  if (h.matcher) lines.push(`matcher = "${h.matcher}"`);
  lines.push(`command = "${command}"`, 'timeout = 5');
  return lines.join('\n');
}).join('\n\n');

const separator = original.endsWith('\n') || original === '' ? '\n' : '\n\n';
const updated = `${original}${separator}# --- kimi-sound-hook 音效 hooks（卸载：运行 uninstall.mjs） ---\n${blocks}\n`;

try {
  writeFileSync(CONFIG_PATH, updated, 'utf8');
} catch (err) {
  fail(`写入 ${CONFIG_PATH} 失败：${err.message}。原配置已备份为 ${backupPath}`);
}

console.log('');
console.log(`[完成] 已向 config.toml 追加 ${HOOKS.length} 个音效 hook：`);
for (const h of HOOKS) {
  console.log(`  - ${h.event}${h.matcher ? ` (matcher: ${h.matcher})` : ''}`);
}
console.log('');
console.log('下一步：');
console.log('  1. 重启 Kimi Code 或新开一个会话，hooks 才会生效。');
console.log('  2. 双击「音效管理.bat」（或 sound-manager.bat）打开可视化管理器，挑选/更换音效。');
