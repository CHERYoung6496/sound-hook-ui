#!/usr/bin/env node
// kimi-sound-hook 可选动漫音效包下载器。
// 从効果音ラボ（https://soundeffect-lab.info/）下载素材并转码为 WAV，输出到 sounds/Anime/。
// 零依赖 Node ESM 脚本（需要系统 PATH 中存在 ffmpeg）。

import { createInterface } from 'node:readline/promises';
import { mkdirSync, readdirSync, rmSync, unlinkSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'sounds', 'Anime');
const TMP_DIR = join(os.tmpdir(), 'kimi-sound-hook-pack');

// 文件名 | 下载地址（Referer 按类别区分）
const FILES = [
  ['voice-yaho', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-yoho1.mp3'],
  ['voice-haihai', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-haihaai1.mp3'],
  ['voice-yobimashita', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-yobimashita1.mp3'],
  ['voice-yattane', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-yattane1.mp3'],
  ['voice-otsukare', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-otsukaresamadeshita1.mp3'],
  ['voice-byebye', 'https://soundeffect-lab.info/sound/voice/mp3/line-girl1/line-girl1-byebye1.mp3'],
  ['voice-ikuze', 'https://soundeffect-lab.info/sound/voice/mp3/game/swordman-start1.mp3'],
  ['voice-yatta', 'https://soundeffect-lab.info/sound/voice/mp3/game/swordman-win1.mp3'],
  ['sfx-cute-pose', 'https://soundeffect-lab.info/sound/anime/mp3/cute-pose1.mp3'],
  ['sfx-nyu3', 'https://soundeffect-lab.info/sound/anime/mp3/nyu3.mp3'],
  ['sfx-levelup', 'https://soundeffect-lab.info/sound/anime/mp3/levelup1.mp3'],
  ['sfx-question', 'https://soundeffect-lab.info/sound/anime/mp3/question1.mp3'],
  ['sfx-surprise', 'https://soundeffect-lab.info/sound/anime/mp3/surprise1.mp3'],
  ['sfx-correct', 'https://soundeffect-lab.info/sound/anime/mp3/correct1.mp3'],
  ['animal-cat1', 'https://soundeffect-lab.info/sound/animal/mp3/cat-cry1.mp3'],
  ['animal-cat2', 'https://soundeffect-lab.info/sound/animal/mp3/cat-cry2.mp3'],
];

function refererFor(url) {
  if (url.includes('/sound/anime/')) return 'https://soundeffect-lab.info/sound/anime/';
  if (url.includes('/sound/voice/')) return 'https://soundeffect-lab.info/sound/voice/';
  if (url.includes('/sound/animal/')) return 'https://soundeffect-lab.info/sound/animal/';
  return 'https://soundeffect-lab.info/';
}

function fail(message) {
  console.error(`[失败] ${message}`);
  process.exit(1);
}

async function confirm() {
  console.log('============================================================');
  console.log('版权提示：');
  console.log('  本脚本下载的素材来自 効果音ラボ（https://soundeffect-lab.info/）。');
  console.log('  该站素材可免费使用，但【禁止再分发】，仅供你本机个人使用。');
  console.log('  下载后的文件请保留在本机 sounds/Anime/ 目录，');
  console.log('  不要提交进 git 仓库，也不要上传分发到任何地方。');
  console.log('============================================================');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = '';
  try {
    answer = await rl.question('已阅读并同意上述条款？输入 y 继续，其他任意键取消：');
  } finally {
    rl.close();
  }
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('已取消，未下载任何文件。');
    process.exit(0);
  }
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: {
      Referer: refererFor(url),
      'User-Agent': 'Mozilla/5.0 (kimi-sound-hook download-pack)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`响应过小（${buf.length} 字节），疑似不是音频文件`);
  writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) fail(`需要 Node.js >= 18，当前版本为 ${process.version}。`);

  // 确认 ffmpeg 可用
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    fail('未找到 ffmpeg。请先安装 ffmpeg 并确保其在 PATH 中（https://ffmpeg.org/download.html）。');
  }

  await confirm();

  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  let okCount = 0;
  const failures = [];

  for (const [name, url] of FILES) {
    const mp3Path = join(TMP_DIR, `${name}.mp3`);
    const wavPath = join(OUT_DIR, `${name}.wav`);
    if (existsSync(wavPath)) {
      console.log(`[跳过] ${name}.wav 已存在`);
      okCount += 1;
      continue;
    }
    try {
      process.stdout.write(`[下载] ${name} ... `);
      const size = await download(url, mp3Path);
      console.log(`${(size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.log('失败');
      failures.push(`${name}：下载失败（${err.message}）`);
      continue;
    }
    const conv = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', mp3Path,
      '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
      wavPath,
    ], { encoding: 'utf8' });
    if (conv.status !== 0 || !existsSync(wavPath)) {
      failures.push(`${name}：ffmpeg 转码失败（${(conv.stderr || '').trim() || '未知错误'}）`);
      try { unlinkSync(mp3Path); } catch {}
      continue;
    }
    try { unlinkSync(mp3Path); } catch {}
    okCount += 1;
    console.log(`[转码] ${name}.wav 完成`);
  }

  // 清理临时目录中残留的 mp3
  try {
    for (const f of readdirSync(TMP_DIR)) {
      if (/\.mp3$/i.test(f)) {
        try { unlinkSync(join(TMP_DIR, f)); } catch {}
      }
    }
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}

  console.log('');
  console.log(`完成：${okCount}/${FILES.length} 个音效已保存到 sounds/Anime/。`);
  if (failures.length) {
    console.log('以下项目失败：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log('打开音效管理器（音效管理.bat）即可在「Anime」专辑中挑选这些音效。');
}

main().catch((err) => fail(err.message));
