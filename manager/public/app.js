/* Agent 音效管理器前端逻辑（零依赖，原生 ES） */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  config: null,        // 当前编辑中的配置（内存副本）
  events: [],          // 服务端下发的 12 个事件元数据 [{key,label,desc}]
  albums: [],          // 音效库 [{name, files:[{name,path,sizeKB}]}]
  dirty: false,        // 是否有未保存改动
  pickerEventKey: null,
  pickerAlbum: null,
};

const MODE_DEFS = [
  ['single', '单个', '总是播放列表中的第一个音效（可用 ↑↓ 调整顺序）'],
  ['random', '随机', '每次从列表中随机挑选一个音效播放'],
  ['disabled', '关闭', '此事件静音，不播放任何声音'],
];

/* ---------------- 浏览器内试听（共享一个 Audio 实例） ---------------- */

let audioEl = null;
let audioPath = null;
let audioBtn = null;

function stopPreview() {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl = null;
  }
  if (audioBtn) {
    audioBtn.classList.remove('playing');
    audioBtn.textContent = '▶';
    audioBtn.title = '试听';
    audioBtn = null;
  }
  audioPath = null;
}

function preview(path, btn) {
  if (audioPath === path) {
    stopPreview();
    return;
  }
  stopPreview();
  const el = new Audio('/api/audio?path=' + encodeURIComponent(path));
  el.addEventListener('ended', stopPreview);
  el.addEventListener('error', () => {
    stopPreview();
    toast('无法播放该文件（可能不是有效的 WAV）', true);
  });
  el.play().catch(() => {});
  audioEl = el;
  audioPath = path;
  audioBtn = btn;
  btn.textContent = '⏸';
  btn.title = '停止试听';
  btn.classList.add('playing');
}

/* ---------------- 通用 UI 工具 ---------------- */

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 3800);
}

function setDirty(v) {
  state.dirty = v;
  const btn = $('#saveBtn');
  btn.disabled = !v;
  btn.classList.toggle('dirty', v);
  btn.textContent = v ? '● 保存' : '保存';
}

function markDirty() { setDirty(true); }

function showBanner(text) {
  const el = $('#banner');
  el.textContent = text;
  el.hidden = false;
}

function hideBanner() {
  $('#banner').hidden = true;
}

function baseName(p) {
  const name = String(p).split('/').pop() || '';
  return name.replace(/\.wav$/i, '');
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/* ---------------- 配置规范化 ---------------- */

function normalizeEventValue(v) {
  const mode = v && ['single', 'random', 'disabled'].includes(v.mode) ? v.mode : 'single';
  const sounds = v && Array.isArray(v.sounds) ? v.sounds.filter((s) => typeof s === 'string') : [];
  return { mode, sounds };
}

function blankConfig() {
  const c = {
    enabled: true,
    creator: 'sound-hook-ui',
    album: '',
    album_emoji: '',
    album_visible: true,
    events: {},
  };
  for (const e of state.events) c.events[e.key] = { mode: 'disabled', sounds: [] };
  return c;
}

function normalizeConfig(cfg) {
  const c = {
    enabled: cfg.enabled !== false,
    creator: typeof cfg.creator === 'string' ? cfg.creator : 'sound-hook-ui',
    album: typeof cfg.album === 'string' ? cfg.album : '',
    album_emoji: typeof cfg.album_emoji === 'string' ? cfg.album_emoji : '',
    album_visible: cfg.album_visible !== false,
    events: {},
  };
  // 保留配置里已有的事件（包括 UI 不认识的额外 key，原样透传）
  const src = cfg.events && typeof cfg.events === 'object' ? cfg.events : {};
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object') c.events[k] = normalizeEventValue(v);
  }
  // 补齐 12 个标准事件：缺失的视为「关闭」
  for (const e of state.events) {
    if (!c.events[e.key]) c.events[e.key] = { mode: 'disabled', sounds: [] };
  }
  return c;
}

/* ---------------- 渲染：事件卡片 ---------------- */

function renderCard(ev) {
  const cfg = state.config.events[ev.key];
  const card = document.createElement('section');
  card.className = 'card';
  if (cfg.mode === 'disabled') card.classList.add('muted');

  const head = document.createElement('div');
  head.className = 'card-head';
  const h2 = document.createElement('h2');
  h2.textContent = ev.label;
  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = ev.desc;
  head.append(h2, desc);

  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [mode, label, tip] of MODE_DEFS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = tip;
    b.classList.toggle('active', cfg.mode === mode);
    b.addEventListener('click', () => {
      if (cfg.mode === mode) return;
      cfg.mode = mode;
      markDirty();
      renderGrid();
    });
    seg.appendChild(b);
  }

  const hint = document.createElement('p');
  hint.className = 'hint';
  if (cfg.mode === 'single' && cfg.sounds.length > 1) {
    hint.textContent = '「单个」模式只播放第一个音效，可用 ↑↓ 调整顺序';
  } else if (cfg.mode === 'random' && cfg.sounds.length > 1) {
    hint.textContent = `每次从 ${cfg.sounds.length} 个音效中随机播放一个`;
  }

  const list = document.createElement('ul');
  list.className = 'sounds';
  cfg.sounds.forEach((p, i) => list.appendChild(renderSoundRow(cfg, p, i)));

  const empty = document.createElement('p');
  empty.className = 'empty';
  if (cfg.sounds.length === 0) empty.textContent = '尚未配置音效，点击下方「＋ 添加音效」从音效库挑选';

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn';
  addBtn.textContent = '＋ 添加音效';
  addBtn.addEventListener('click', () => openPicker(ev.key));
  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'btn';
  testBtn.textContent = '🔊 试听此事件';
  testBtn.title = '按磁盘上已保存的配置，走真实 hook 播放链路试听（含随机挑选）';
  testBtn.addEventListener('click', () => testEvent(ev.key, testBtn));
  actions.append(addBtn, testBtn);

  card.append(head, seg, hint, list, empty, actions);
  return card;
}

function renderSoundRow(cfg, path, index) {
  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = baseName(path);
  name.title = path;

  const ops = document.createElement('span');
  ops.className = 'ops';

  const mk = (text, tip, onClick, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = tip;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  };

  const playBtn = mk('▶', '试听', () => preview(path, playBtn));
  const upBtn = mk('↑', '上移', () => {
    if (index === 0) return;
    [cfg.sounds[index - 1], cfg.sounds[index]] = [cfg.sounds[index], cfg.sounds[index - 1]];
    markDirty();
    renderGrid();
  }, index === 0);
  const downBtn = mk('↓', '下移', () => {
    if (index >= cfg.sounds.length - 1) return;
    [cfg.sounds[index + 1], cfg.sounds[index]] = [cfg.sounds[index], cfg.sounds[index + 1]];
    markDirty();
    renderGrid();
  }, index >= cfg.sounds.length - 1);
  const delBtn = mk('✕', '从列表移除', () => {
    cfg.sounds.splice(index, 1);
    markDirty();
    renderGrid();
    if (!$('#pickerOverlay').hidden) renderPickerList();
  });

  ops.append(playBtn, upBtn, downBtn, delBtn);
  li.append(name, ops);
  return li;
}

function renderGrid() {
  stopPreview();
  const grid = $('#grid');
  grid.innerHTML = '';
  for (const ev of state.events) grid.appendChild(renderCard(ev));
}

function renderTopbar() {
  $('#enabledToggle').checked = state.config.enabled;
  $('#albumInput').value = state.config.album;
  $('#emojiInput').value = state.config.album_emoji;
}

/* ---------------- 音效库选择器 ---------------- */

function openPicker(eventKey) {
  state.pickerEventKey = eventKey;
  const ev = state.events.find((e) => e.key === eventKey);
  $('#pickerTitle').textContent = `添加音效 → ${ev ? ev.label : eventKey}`;
  const names = state.albums.map((a) => a.name);
  state.pickerAlbum = names.includes(state.config.album) ? state.config.album : (names[0] || null);
  $('#pickerSearch').value = '';
  renderAlbumTabs();
  renderPickerList();
  $('#pickerOverlay').hidden = false;
  $('#pickerSearch').focus();
}

function closePicker() {
  $('#pickerOverlay').hidden = true;
  state.pickerEventKey = null;
  stopPreview();
}

function renderAlbumTabs() {
  const wrap = $('#albumTabs');
  wrap.innerHTML = '';
  if (state.albums.length === 0) {
    wrap.textContent = '未找到专辑';
    return;
  }
  for (const album of state.albums) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${album.name}（${album.files.length}）`;
    b.classList.toggle('active', album.name === state.pickerAlbum);
    b.addEventListener('click', () => {
      state.pickerAlbum = album.name;
      renderAlbumTabs();
      renderPickerList();
    });
    wrap.appendChild(b);
  }
}

function renderPickerList() {
  const wrap = $('#pickerList');
  wrap.innerHTML = '';
  const album = state.albums.find((a) => a.name === state.pickerAlbum);
  if (!album) {
    wrap.innerHTML = '<p class="empty">音效库为空或目录不可读</p>';
    return;
  }
  const q = $('#pickerSearch').value.trim().toLowerCase();
  const cfg = state.config.events[state.pickerEventKey];
  const files = album.files.filter((f) => !q || f.name.toLowerCase().includes(q));
  if (files.length === 0) {
    wrap.innerHTML = `<p class="empty">${q ? '没有匹配的音效' : '该专辑没有 .wav 文件'}</p>`;
    return;
  }
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'pick-row';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = baseName(f.name);
    name.title = f.path;

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = `${f.sizeKB} KB`;

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.textContent = '▶';
    playBtn.title = '试听';
    playBtn.addEventListener('click', () => preview(f.path, playBtn));

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn small';
    const added = cfg.sounds.includes(f.path);
    addBtn.textContent = added ? '已添加' : '添加';
    addBtn.disabled = added;
    addBtn.addEventListener('click', () => {
      if (cfg.sounds.includes(f.path)) return; // 去重
      cfg.sounds.push(f.path);
      markDirty();
      renderGrid();
      renderPickerList();
    });

    row.append(name, size, playBtn, addBtn);
    wrap.appendChild(row);
  }
}

/* ---------------- 动作：试听事件 / 保存 / 关闭服务器 ---------------- */

async function testEvent(key, btn) {
  if (state.dirty) toast('提示：有未保存的改动，此次试听播放的是磁盘上已保存的配置');
  btn.disabled = true;
  try {
    const { res, data } = await postJson('/api/test-event', { event: key });
    if (res.ok && data.ok) {
      toast(data.played
        ? `已触发播放：${baseName(data.played)}`
        : '已发送测试事件（未检测到播放：该事件可能被关闭、列表为空或全局未启用）');
    } else {
      alert('试听失败：' + (data.error || `HTTP ${res.status}`));
    }
  } catch (err) {
    alert('试听失败：' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function save() {
  const btn = $('#saveBtn');
  btn.disabled = true;
  const payload = {
    enabled: state.config.enabled,
    creator: state.config.creator,
    album: state.config.album,
    album_emoji: state.config.album_emoji,
    album_visible: state.config.album_visible,
    events: state.config.events,
  };
  try {
    const { res, data } = await postJson('/api/config', payload);
    if (res.ok && data.ok) {
      setDirty(false);
      hideBanner();
      toast(`已保存 ✅ 原配置已备份为 ${data.backup}`);
    } else {
      alert('保存失败：' + (data.error || `HTTP ${res.status}`));
      btn.disabled = false;
    }
  } catch (err) {
    alert('保存失败：' + err.message);
    btn.disabled = false;
  }
}

async function shutdown() {
  if (!confirm('确定要关闭音效管理器服务器吗？\n（sounds.json 与 hook 播放不受影响，只是关闭本管理页面）')) return;
  setDirty(false);
  try { await fetch('/api/shutdown', { method: 'POST' }); } catch {}
  document.body.innerHTML =
    '<div class="bye"><h1>服务器已关闭</h1><p>可以直接关闭此页面。下次需要管理音效时，双击仓库根目录下的「音效管理.bat」（或 sound-manager.bat）。</p></div>';
}

/* ---------------- 初始化 ---------------- */

function bindStaticControls() {
  $('#enabledToggle').addEventListener('change', (e) => {
    state.config.enabled = e.target.checked;
    markDirty();
  });
  $('#albumInput').addEventListener('input', (e) => {
    state.config.album = e.target.value;
    markDirty();
  });
  $('#emojiInput').addEventListener('input', (e) => {
    state.config.album_emoji = e.target.value;
    markDirty();
  });
  $('#saveBtn').addEventListener('click', save);
  $('#shutdownBtn').addEventListener('click', shutdown);

  $('#pickerClose').addEventListener('click', closePicker);
  $('#pickerSearch').addEventListener('input', renderPickerList);
  $('#pickerOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closePicker();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#pickerOverlay').hidden) closePicker();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

async function init() {
  bindStaticControls();
  let data;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('#grid').innerHTML = `<p class="fatal">无法加载配置：${err.message}</p>`;
    return;
  }
  state.events = Array.isArray(data.events) ? data.events : [];
  state.albums = Array.isArray(data.albums) ? data.albums : [];

  if (data.config && data.config.parseError) {
    showBanner(`⚠️ 配置文件损坏或读取失败（${data.config.error || '未知错误'}）。下面展示的是一份空白配置，修改后点击「保存」会自动备份原文件并覆盖修复。`);
    state.config = blankConfig();
  } else {
    state.config = normalizeConfig(data.config || {});
  }

  renderTopbar();
  renderGrid();
}

init();
