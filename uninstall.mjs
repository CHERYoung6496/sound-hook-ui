#!/usr/bin/env node
// sound-hook-ui 卸载器：从各 agent 工具配置中移除本项目的音效 hooks。
// 只删除本项目注册的条目（旧名 kimi-sound-hook 时期的残留也一并清理），其余配置原样保留；
// 写入前必做带时间戳的 .bak 备份。
// 用法：
//   node uninstall.mjs                      从所有已安装本项目 hook 的工具中移除
//   node uninstall.mjs --tool kimi,claude   只清理指定工具（--tool 可多次使用或逗号分隔，--list 查看全部 8 个）
//   node uninstall.mjs --list               列出全部支持的工具及检测/安装状态

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TOOLS, getTool, parseToolArgs, timestampName, toolStatus } from './adapters.mjs';

function fail(message) {
  console.error(`[卸载失败] ${message}`);
  process.exit(1);
}

let args;
try {
  args = parseToolArgs(process.argv.slice(2));
} catch (err) {
  fail(err.message);
}

console.log('[sound-hook-ui] 卸载程序');

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

// --- 选定目标工具：默认从所有已安装本项目 hook 的工具中移除 -----------------------------

let targets;
if (args.ids.length > 0) {
  targets = args.ids.map(getTool);
} else {
  targets = TOOLS.filter((tool) => toolStatus(tool).installed);
  if (targets.length === 0) {
    console.log('');
    console.log('[无需卸载] 未在任何支持的工具配置中找到本项目的 hook。');
    process.exit(0);
  }
  console.log(`  检测到 ${targets.length} 个工具装有本项目 hook：${targets.map((t) => t.id).join(', ')}`);
}

// --- 逐一移除 -----------------------------------------------------------------------

let removedTools = 0;
let skippedCount = 0;
let failedCount = 0;

for (const tool of targets) {
  console.log('');
  console.log(`==> ${tool.id}（${tool.displayName}）`);
  const configPath = tool.configPath();
  console.log(`  配置文件：${configPath}`);
  try {
    if (!existsSync(configPath)) {
      console.log('[无需卸载] 配置文件不存在，跳过。');
      skippedCount += 1;
      continue;
    }

    const original = readFileSync(configPath, 'utf8');
    const { content, removed } = tool.remove(original);
    if (removed === 0) {
      console.log('[无需卸载] 未找到本项目注册的 hook，跳过。');
      skippedCount += 1;
      continue;
    }

    if (typeof tool.removeFiles === 'function') {
      // 如 pi：卸载即删除本项目生成的扩展文件本身（可随时重装生成，无需备份），
      // 而不是把 remove 结果写回配置文件
      tool.removeFiles(configPath);
      console.log('[完成] 已删除本项目的扩展文件。');
    } else {
      const backupPath = `${configPath}.${timestampName(new Date())}.bak`;
      copyFileSync(configPath, backupPath);
      console.log(`  已备份原配置：${backupPath}`);
      writeFileSync(configPath, content, 'utf8');
      console.log(`[完成] 已删除 ${removed} 个音效 hook。`);
    }
    removedTools += 1;
  } catch (err) {
    failedCount += 1;
    console.error(`[卸载失败] ${tool.id}：${err.message}`);
  }
}

console.log('');
console.log(`[汇总] 清理 ${removedTools} 个工具，跳过 ${skippedCount} 个，失败 ${failedCount} 个。`);

if (removedTools > 0) {
  console.log('重启或新开对应工具的会话后，音效 hook 将不再触发。');
  console.log('仓库目录与音效文件未被删除，如不再需要可手动删除。');
}

if (failedCount > 0) process.exit(1);
