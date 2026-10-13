#!/usr/bin/env node
// kimi-sound-hook 安装器：把音效 hooks 注册进各 agent 工具的配置文件。
// 零依赖 Node ESM 脚本，幂等，可重复运行；写入前必做带时间戳的 .bak 备份。
// 用法：
//   node install.mjs                        自动检测已安装的工具并逐一注册（一个都没检测到则默认装 kimi）
//   node install.mjs --tool kimi,claude     只装指定工具（--tool 可多次使用或逗号分隔）
//   node install.mjs --list                 列出全部支持的工具及检测/安装状态

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, getTool, parseToolArgs, timestampName, toolStatus } from './adapters.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLAYER_PATH = resolve(ROOT, 'play-sound.mjs').replace(/\\/g, '/');

function fail(message) {
  console.error(`[安装失败] ${message}`);
  process.exit(1);
}

// --- 环境检查 -----------------------------------------------------------------

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  fail(`需要 Node.js >= 18，当前版本为 ${process.version}。请先升级 Node.js。`);
}

if (!existsSync(PLAYER_PATH)) {
  fail(`未找到播放器 ${PLAYER_PATH}，请确认本脚本位于仓库根目录且仓库完整。`);
}

let args;
try {
  args = parseToolArgs(process.argv.slice(2));
} catch (err) {
  fail(err.message);
}

console.log('[kimi-sound-hook] 安装程序');
console.log(`  播放器路径：${PLAYER_PATH}`);

// --- --list：列出全部工具及状态 ---------------------------------------------------

if (args.list) {
  console.log('');
  console.log('支持的工具：');
  for (const tool of TOOLS) {
    const status = toolStatus(tool);
    console.log(`  - ${tool.id}（${tool.displayName}）`);
    console.log(`      配置文件：${status.configPath}`);
    console.log(`      检测：${status.detected ? '已检测到配置目录' : '未检测到配置目录'}；hook：${status.installed ? '已安装' : '未安装'}`);
  }
  process.exit(0);
}

// --- 选定目标工具 -------------------------------------------------------------------

let targets;
if (args.ids.length > 0) {
  targets = args.ids.map(getTool);
} else {
  targets = TOOLS.filter((tool) => tool.detect());
  if (targets.length === 0) {
    targets = [getTool('kimi')];
    console.log('  未检测到任何支持工具的配置目录，默认安装到 kimi（Kimi Code）。');
  } else {
    console.log(`  已检测到 ${targets.length} 个工具：${targets.map((t) => t.id).join(', ')}`);
  }
}

// --- 逐一安装 -----------------------------------------------------------------------

let installedCount = 0;
let skippedCount = 0;
let failedCount = 0;
const installedTools = [];

for (const tool of targets) {
  console.log('');
  console.log(`==> ${tool.id}（${tool.displayName}）`);
  const configPath = tool.configPath();
  console.log(`  配置文件：${configPath}`);
  try {
    let original;
    if (existsSync(configPath)) {
      original = readFileSync(configPath, 'utf8');
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
      original = tool.skeleton;
      writeFileSync(configPath, original, 'utf8');
      console.log('  配置文件不存在，已创建骨架文件。');
    }

    if (tool.isInstalled(original)) {
      console.log('[已安装] 配置中已存在 play-sound.mjs 的 hook，跳过该工具。');
      skippedCount += 1;
      continue;
    }

    const backupPath = `${configPath}.${timestampName(new Date())}.bak`;
    copyFileSync(configPath, backupPath);
    console.log(`  已备份原配置：${backupPath}`);

    writeFileSync(configPath, tool.merge(original, PLAYER_PATH), 'utf8');
    console.log(`[完成] 已注册 ${tool.eventNames.length} 个音效 hook：${tool.eventNames.join('、')}`);
    installedCount += 1;
    installedTools.push(tool);
  } catch (err) {
    failedCount += 1;
    console.error(`[安装失败] ${tool.id}：${err.message}`);
  }
}

// --- 汇总与下一步指引 -----------------------------------------------------------------

console.log('');
console.log(`[汇总] 新装 ${installedCount} 个工具，跳过 ${skippedCount} 个（已安装），失败 ${failedCount} 个。`);

if (installedTools.length > 0) {
  console.log('');
  console.log('下一步：');
  for (const tool of installedTools) {
    for (const note of tool.notes) {
      console.log(`  - ${tool.displayName}：${note}`);
    }
  }
  console.log('  - 双击「音效管理.bat」（或 sound-manager.bat）打开可视化管理器，挑选/更换音效。');
}

if (failedCount > 0) process.exit(1);
