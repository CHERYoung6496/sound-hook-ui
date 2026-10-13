#!/usr/bin/env node
// kimi-sound-hook 卸载器：从 Kimi Code 的 config.toml 中移除本项目的音效 hooks。
// 按块解析：凡是 command 含 "play-sound.mjs" 的 [[hooks]] 表整段删除，其余内容原样保留。

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

function fail(message) {
  console.error(`[卸载失败] ${message}`);
  process.exit(1);
}

function timestampName(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

const kimiHome = process.env.KIMI_CODE_HOME && process.env.KIMI_CODE_HOME.trim()
  ? process.env.KIMI_CODE_HOME.trim()
  : join(os.homedir(), '.kimi-code');
const CONFIG_PATH = join(kimiHome, 'config.toml');

console.log('[kimi-sound-hook] 卸载程序');
console.log(`  KIMI_CODE_HOME：${kimiHome}`);
console.log(`  目标配置文件：${CONFIG_PATH}`);

if (!existsSync(CONFIG_PATH)) {
  console.log('');
  console.log('[无需卸载] 配置文件不存在，未做任何改动。');
  process.exit(0);
}

let original;
try {
  original = readFileSync(CONFIG_PATH, 'utf8');
} catch (err) {
  fail(`无法读取 ${CONFIG_PATH}：${err.message}。请检查文件权限。`);
}

// --- 按块解析并删除目标 [[hooks]] ----------------------------------------------
// 一个块从 "[[hooks]]" 行开始，到下一个以 "[" 开头的行（或文件末尾）结束。
// 块内 command 含 "play-sound.mjs" 的视为本项目注册的 hook，整段删除。

const lines = original.split('\n');
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

if (removed === 0) {
  console.log('');
  console.log('[无需卸载] 未找到任何指向 play-sound.mjs 的 hook，未做任何改动。');
  process.exit(0);
}

// 清理删除后可能留下的本项目注释行与多余空行
let updated = kept.join('\n');
updated = updated.replace(/\n?# --- kimi-sound-hook 音效 hooks（卸载：运行 uninstall\.mjs） ---\n?/, '\n');
updated = updated.replace(/\n{3,}/g, '\n\n');

const backupPath = `${CONFIG_PATH}.${timestampName(new Date())}.bak`;
try {
  copyFileSync(CONFIG_PATH, backupPath);
  console.log(`  已备份原配置：${backupPath}`);
} catch (err) {
  fail(`备份失败，未做任何修改：${err.message}`);
}

try {
  writeFileSync(CONFIG_PATH, updated, 'utf8');
} catch (err) {
  fail(`写入 ${CONFIG_PATH} 失败：${err.message}。原配置已备份为 ${backupPath}`);
}

console.log('');
console.log(`[完成] 已删除 ${removed} 个音效 hook。`);
console.log('重启 Kimi Code 或新开会话后，音效 hook 将不再触发。');
console.log('仓库目录与音效文件未被删除，如不再需要可手动删除。');
