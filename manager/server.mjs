#!/usr/bin/env node
// Kimi Code 音效管理器 —— 零依赖本地 Web 服务
// 只读写仓库根目录下的 sounds.json，不修改 play-sound.mjs。
// 所有路径均相对于仓库根目录自动推导，无任何硬编码绝对路径。

import http from 'node:http';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { dirname, join, resolve, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';

const HOST = '127.0.0.1';
const PORT = Number(process.env.SOUND_MANAGER_PORT) || 23177;

const MANAGER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(MANAGER_DIR, '..');
const PUBLIC_DIR = join(MANAGER_DIR, 'public');
const CONFIG_PATH = join(ROOT, 'sounds.json');
const PLAYER_PATH = join(ROOT, 'play-sound.mjs');
const LOG_PATH = join(ROOT, 'sound-debug.log');
const LIB_ROOT = join(ROOT, 'sounds');

const EVENTS = [
  { key: 'agent_end', label: '任务完成', desc: 'Agent 回复结束（Stop hook）' },
  { key: 'input', label: '提交输入', desc: '你提交输入时（UserPromptSubmit hook）' },
  { key: 'session_start', label: '会话开始', desc: '新会话启动（SessionStart hook）' },
  { key: 'session_end', label: '会话结束', desc: '会话结束（SessionEnd hook）' },
  { key: 'permission_request', label: '权限审批', desc: '请求权限审批（PermissionRequest hook）' },
  { key: 'ask_user_question:start', label: '向你提问', desc: '向你提问时（PreToolUse · AskUserQuestion）' },
  { key: 'ask_user_question:result', label: '提问已回答', desc: '你回答提问后（PostToolUse · AskUserQuestion）' },
  { key: 'agent_end_failure', label: '任务失败', desc: '回复异常结束（StopFailure hook）' },
  { key: 'tool_execution_error', label: '工具执行出错', desc: '工具调用失败（PostToolUseFailure hook）' },
  { key: 'interrupt', label: '任务被中断', desc: '任务被打断（Interrupt hook）' },
  { key: 'subagent_start', label: '子代理启动', desc: '子代理开始工作（SubagentStart hook）' },
  { key: 'subagent_stop', label: '子代理结束', desc: '子代理完成（SubagentStop hook）' },
];

const EVENT_PAYLOADS = {
  agent_end: { hook_event_name: 'Stop' },
  input: { hook_event_name: 'UserPromptSubmit' },
  session_start: { hook_event_name: 'SessionStart' },
  session_end: { hook_event_name: 'SessionEnd' },
  permission_request: { hook_event_name: 'PermissionRequest' },
  'ask_user_question:start': { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' },
  'ask_user_question:result': { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' },
  agent_end_failure: { hook_event_name: 'StopFailure' },
  tool_execution_error: { hook_event_name: 'PostToolUseFailure' },
  interrupt: { hook_event_name: 'Interrupt' },
  subagent_start: { hook_event_name: 'SubagentStart' },
  subagent_stop: { hook_event_name: 'SubagentStop' },
};

const MODES = new Set(['single', 'random', 'disabled']);
const CONFIG_KEYS = ['enabled', 'creator', 'album', 'album_emoji', 'album_visible', 'events'];

// ---------------------------------------------------------------------------
// 路径工具
// ---------------------------------------------------------------------------

// 统一为「解析后 + 正斜杠 + 小写」，用于白名单前缀比较。
function normalizePath(p) {
  return resolve(String(p)).replace(/\\/g, '/').toLowerCase();
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

const WHITELIST = [ROOT].map(normalizePath);

// 相对路径一律相对仓库根解析（与 play-sound.mjs 的行为一致），绝对路径原样解析。
function resolveSoundPath(p) {
  const s = String(p);
  return isAbsolute(s) ? resolve(s) : resolve(ROOT, s);
}

function isWhitelisted(p) {
  const n = normalizePath(p);
  return WHITELIST.some((root) => n === root || n.startsWith(root + '/'));
}

function checkSoundPath(p) {
  if (typeof p !== 'string' || !p.trim()) return '音效路径必须是非空字符串';
  const abs = resolveSoundPath(p);
  if (!isWhitelisted(abs)) return `音效路径不在允许的目录内：${p}`;
  if (!/\.wav$/i.test(p)) return `不是 .wav 文件：${p}`;
  try {
    if (!statSync(abs).isFile()) return `不是文件：${p}`;
  } catch {
    return `文件不存在：${p}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 配置读写
// ---------------------------------------------------------------------------

function readConfig() {
  let raw = '';
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    return { parseError: true, raw: '', error: `读取失败：${err.message}` };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('顶层不是 JSON 对象');
    }
    return value;
  } catch (err) {
    return { parseError: true, raw, error: `解析失败：${err.message}` };
  }
}

function timestampName(date) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function scanAlbums() {
  const albums = [];
  let entries;
  try {
    entries = readdirSync(LIB_ROOT, { withFileTypes: true });
  } catch {
    return albums;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(LIB_ROOT, entry.name);
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const files = items
      .filter((f) => f.isFile() && /\.wav$/i.test(f.name))
      .map((f) => {
        const full = join(dir, f.name);
        let sizeKB = 0;
        try {
          sizeKB = Math.round((statSync(full).size / 1024) * 10) / 10;
        } catch {}
        return { name: f.name, path: toPosix(full), sizeKB };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    albums.push({ name: entry.name, files });
  }
  albums.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return albums;
}

// 校验并归一化配置。返回 {config} 或 {errors}。
function validateConfig(body, previous) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['请求体必须是 JSON 对象'] };
  }
  const errors = [];
  if (typeof body.enabled !== 'boolean') errors.push('enabled 必须是布尔值（true/false）');
  if (typeof body.album !== 'string') errors.push('album 必须是字符串');
  else if (body.album.length > 100) errors.push('album 过长（最多 100 字符）');
  if (typeof body.album_emoji !== 'string') errors.push('album_emoji 必须是字符串');
  else if (body.album_emoji.length > 32) errors.push('album_emoji 过长（最多 32 字符）');

  const events = body.events;
  if (!events || typeof events !== 'object' || Array.isArray(events)) {
    errors.push('events 必须是对象');
  } else {
    for (const [key, value] of Object.entries(events)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`事件 ${key} 的值必须是对象`);
        continue;
      }
      if (!MODES.has(value.mode)) {
        errors.push(`事件 ${key} 的 mode 必须是 single / random / disabled 之一`);
      }
      if (!Array.isArray(value.sounds)) {
        errors.push(`事件 ${key} 的 sounds 必须是字符串数组`);
        continue;
      }
      value.sounds.forEach((p, i) => {
        const problem = checkSoundPath(p);
        if (problem) errors.push(`事件 ${key} 第 ${i + 1} 个音效：${problem}`);
      });
    }
  }
  if (errors.length) return { errors };

  const cleanEvents = {};
  for (const [key, value] of Object.entries(events)) {
    cleanEvents[key] = {
      mode: value.mode,
      sounds: value.sounds.map((p) => toPosix(p)),
    };
  }
  // creator / album_visible 不由 UI 控制：优先沿用请求值，否则原样保留旧配置。
  const creator = typeof body.creator === 'string' && body.creator
    ? body.creator
    : (typeof previous.creator === 'string' && previous.creator ? previous.creator : 'kimi-sound-hook');
  const albumVisible = typeof body.album_visible === 'boolean'
    ? body.album_visible
    : (typeof previous.album_visible === 'boolean' ? previous.album_visible : true);
  return {
    config: {
      enabled: body.enabled,
      creator,
      album: body.album,
      album_emoji: body.album_emoji,
      album_visible: albumVisible,
      events: cleanEvents,
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectPromise);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  try {
    return JSON.parse(text || '{}');
  } catch (err) {
    const e = new Error(`请求体不是合法 JSON：${err.message}`);
    e.statusCode = 400;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 静态文件
// ---------------------------------------------------------------------------

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(PUBLIC_DIR, rel);
  const base = resolve(PUBLIC_DIR).replace(/\\/g, '/').toLowerCase();
  if (!target.replace(/\\/g, '/').toLowerCase().startsWith(base + '/')) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  const stream = createReadStream(target);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function serveAudio(req, res, url) {
  const raw = url.searchParams.get('path');
  if (!raw) return sendJson(res, 400, { error: '缺少 path 参数' });
  let abs;
  try {
    abs = resolveSoundPath(raw);
  } catch {
    return sendJson(res, 403, { error: '路径非法' });
  }
  if (!isWhitelisted(abs)) {
    return sendJson(res, 403, { error: '路径不在允许的目录内（仓库目录之外）' });
  }
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return sendJson(res, 404, { error: '文件不存在' });
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: '不是文件' });

  const headers = {
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
  };
  const range = req.headers.range;
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : stat.size - Number(match[2]);
    let end = match[1] && match[2] ? Number(match[2]) : stat.size - 1;
    start = Math.max(0, Math.min(start, stat.size - 1));
    end = Math.max(start, Math.min(end, stat.size - 1));
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    const stream = createReadStream(abs, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  const stream = createReadStream(abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// ---------------------------------------------------------------------------
// 事件试听：走真实 hook 播放链路
// ---------------------------------------------------------------------------

function tailLog(maxBytes = 8192) {
  let fd;
  try {
    const size = statSync(LOG_PATH).size;
    const start = Math.max(0, size - maxBytes);
    fd = openSync(LOG_PATH, 'r');
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function runPlayer(payload) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let timer = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise(result);
    };
    let child;
    try {
      child = spawn(process.execPath, [PLAYER_PATH], { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (err) {
      return done({ error: `无法启动播放器：${err.message}` });
    }
    child.on('error', (err) => done({ error: `无法启动播放器：${err.message}` }));
    child.on('close', (code) => done({ code }));
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done({ code: null, timedOut: true });
    }, 4000);
    timer.unref();
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch (err) {
      done({ error: `写入 payload 失败：${err.message}` });
    }
  });
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: 'URL 编码非法' });
  }
  const method = req.method || 'GET';

  if (method === 'GET' && pathname === '/api/state') {
    const config = readConfig();
    return sendJson(res, 200, {
      config,
      events: EVENTS,
      albums: scanAlbums(),
      paths: { config: toPosix(CONFIG_PATH), library: toPosix(LIB_ROOT), public: toPosix(PUBLIC_DIR) },
    });
  }

  if (method === 'GET' && pathname === '/api/audio') {
    return serveAudio(req, res, url);
  }

  if (method === 'POST' && pathname === '/api/test-event') {
    const body = await readJsonBody(req);
    const key = body?.event;
    if (typeof key !== 'string' || !EVENT_PAYLOADS[key]) {
      return sendJson(res, 400, { error: `未知事件：${String(key)}` });
    }
    const payload = EVENT_PAYLOADS[key];
    const startedAt = Date.now();
    const result = await runPlayer(payload);
    if (result.error) return sendJson(res, 500, { error: result.error, payload });
    let played = null;
    const lines = tailLog().split('\n').reverse();
    for (const line of lines) {
      const m = /^\[(.+?)\] playing (.+)$/.exec(line.trim());
      if (!m) continue;
      const ts = Date.parse(m[1]);
      if (!Number.isNaN(ts) && ts >= startedAt - 1000) played = toPosix(m[2].trim());
      break;
    }
    return sendJson(res, 200, { ok: true, event: key, payload, played });
  }

  if (method === 'POST' && pathname === '/api/config') {
    const previous = readConfig();
    const prevValue = previous.parseError ? {} : previous;
    const body = await readJsonBody(req);
    const { config, errors } = validateConfig(body, prevValue);
    if (errors) return sendJson(res, 400, { error: errors.join('；') });

    const backupName = `sounds.json.${timestampName(new Date())}.bak`;
    const backupPath = join(ROOT, backupName);
    try {
      copyFileSync(CONFIG_PATH, backupPath);
    } catch (err) {
      return sendJson(res, 500, { error: `备份失败，未写入配置：${err.message}` });
    }
    try {
      const ordered = {};
      for (const key of CONFIG_KEYS) ordered[key] = config[key];
      writeFileSync(CONFIG_PATH, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
    } catch (err) {
      return sendJson(res, 500, { error: `写入失败（原文件已备份为 ${backupName}）：${err.message}` });
    }
    return sendJson(res, 200, { ok: true, backup: backupName });
  }

  if (method === 'POST' && pathname === '/api/shutdown') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 120).unref?.();
    return;
  }

  if (method === 'GET' && (pathname === '/' || Object.keys(STATIC_TYPES).includes(extname(pathname).toLowerCase()))) {
    return serveStatic(res, pathname);
  }
  if (method === 'GET' && pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  return sendJson(res, 404, { error: `未知路径：${method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const status = err?.statusCode || 500;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, status, { error: err?.message || '服务器内部错误' });
  });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[音效管理器] 端口 ${PORT} 已被占用，服务器可能已在运行。`);
    process.exit(1);
  }
  console.error(`[音效管理器] 服务错误：${err.message}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[音效管理器] 未捕获异常（已忽略，服务继续）：${err.message}`);
});
process.on('unhandledRejection', (err) => {
  console.error(`[音效管理器] 未处理的 Promise 拒绝（已忽略）：${err?.message ?? err}`);
});

server.listen(PORT, HOST, () => {
  console.log(`[音效管理器] 已启动： http://${HOST}:${PORT}  (${os.platform()})`);
  console.log(`[音效管理器] 配置文件： ${toPosix(CONFIG_PATH)}`);
  console.log(`[音效管理器] 音效库：   ${toPosix(LIB_ROOT)}`);
  console.log('[音效管理器] 关闭服务： 页面上的「关闭服务器」按钮，或 Ctrl+C');
});
