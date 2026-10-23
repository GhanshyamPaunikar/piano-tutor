// Library screen: the built-in collection (songs/), your own MIDI folder (remembered between visits),
// files you add one by one, favourites, playlists and play history.
import * as db from './store.js';
import { $, $$, el, fmt, toast } from './util.js';
import { quickInfo } from './song.js';

const MIDI_RE = /\.(mid|midi|kar)$/i;
const LEVELS = ['Easy', 'Medium', 'Intermediate', 'Advanced'];
const ROW_H = 72;                  // list row height, fixed so the list can be virtualised
const CARD_W = 168, CARD_H = 232, GAP = 14;
const songs = (n) => `${n.toLocaleString()} song${n === 1 ? '' : 's'}`;
const DURATIONS = { short: [0, 120], mid: [120, 240], long: [240, 1e9] };

const L = {
  collection: [],      // built-in songs from songs/index.json
  folder: [],          // your MIDI folder
  uploads: [],         // files added one by one
  handle: null, folderName: '', needsPermission: false, sessionOnly: false, scanning: false, metaDone: 0,
  meta: {}, plays: {}, prefs: {},
  favs: new Set(),
  playlists: [],       // [{ id, name, songs: [entryId], created }]
  shown: [],           // entries in the order currently listed
};

const UI_KEY = 'keys.lib.v2';
const saved = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })();
const ui = {
  view: 'library', playlistId: null,
  level: '', genre: '', duration: '',
  sort: saved.sort || 'artist', desc: !!saved.desc, layout: saved.layout || 'list',
  shelfCollapsed: !!saved.shelfCollapsed,
  now: null,           // song shown in the bottom player bar
  selected: new Set(), anchor: -1, focus: 0,
};
const saveUi = () => {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ sort: ui.sort, desc: ui.desc, layout: ui.layout, shelfCollapsed: ui.shelfCollapsed })); } catch { /* private mode */ }
};

let hooks = { onOpen() {}, onPreview() {}, previewId: () => null, previewProgress: () => null, connectMidi() {}, midiState: () => ({}), setOutput() {}, setKeyboardSize() {}, keyboardSize: () => 'fit', tones: () => ({ list: [], current: '' }), setTone() {} };
let metaToken = 0;

/* ================= data ================= */

export async function initLibrary(opts) {
  hooks = { ...hooks, ...opts };
  const [meta, plays, prefs, favs, lists] = await Promise.all(['meta', 'plays', 'songprefs', 'favorites', 'playlists'].map((k) => db.get(k)));
  L.meta = meta || {}; L.plays = plays || {}; L.prefs = prefs || {};
  L.favs = new Set(favs || []);
  L.playlists = lists || [];
  wire();
  await Promise.all([loadCollection(), loadUploads()]);
  applyRoute();
  restoreFolder();
}

// songs/ holds the private song collection (personal builds only). Public builds fall back to
// starter/, a few public-domain pieces arranged for Piano Tutor.
let personalEdition = false;
export const hasCollection = () => personalEdition;

async function loadIndex(dir) {
  const r = await fetch(`${dir}/index.json`);
  if (!r.ok) throw new Error('no index');
  return (await r.json()).songs;
}

async function loadCollection() {
  let songs, dir = 'songs';
  try {
    // ?edition=public previews the public edition on a copy that has the private collection
    if (new URLSearchParams(location.search).get('edition') === 'public') throw new Error('public preview');
    songs = await loadIndex('songs');
    personalEdition = true;
  } catch {
    try { songs = await loadIndex('starter'); dir = 'starter'; } catch { songs = []; }
  }
  try {
    L.collection = songs.map((s) => ({
      id: 'c:' + s.file,
      title: s.title, artist: s.artist, level: s.level, genre: s.genre || '',
      art: s.art || '', added: s.added || 0,
      kind: 'collection',
      meta: { dur: s.dur, diff: s.diff, bpm: s.bpm },
      file: async () => {
        const r = await fetch(`${dir}/` + s.file.split('/').map(encodeURIComponent).join('/'));
        if (!r.ok) throw new Error('missing file');
        return r.blob();
      },
    }));
  } catch {
    L.collection = [];
  }
  invalidate();
}

const allEntries = () => [...L.uploads, ...L.folder, ...L.collection];
let byId = null;
export const entryById = (id) => (byId ||= new Map(allEntries().map((e) => [e.id, e]))).get(id);
function invalidate() { byId = null; twin = null; }

// Your own files often share names with collection songs; borrow their art, genre and video
const twinKey = (e) => [e.artist, e.title, e.level].join('|').toLowerCase();
let twin = null;
function twinOf(e) {
  if (e.kind === 'collection') return e;
  twin ||= new Map(L.collection.map((c) => [twinKey(c), c]));
  return twin.get(twinKey(e)) || e;
}
// Album art from Apple Music when found; otherwise artEl draws a coloured letter tile
const artOf = (e, size = 100) => {
  const a = e.art || twinOf(e).art;
  return a ? a.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : '';
};
// Share of the song learned (best of left, right and both hands), 0 to 1
const learnedShare = (e) => {
  const p = L.prefs[e.id], dur = metaOf(e).dur;
  if (!p || !p.learned || !dur) return 0;
  return Math.min(1, Math.max(0, ...Object.values(p.learned)) / dur);
};
const genreOf = (e) => e.genre || twinOf(e).genre || '';
const metaOf = (e) => e.meta || L.meta[e.id] || {};

/* ---------- your folder ---------- */

async function restoreFolder() {
  const h = await db.get('folder');
  if (!h) return;
  L.handle = h;
  L.folderName = h.name;
  try {
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') return scan();
  } catch { /* handle no longer valid */ }
  L.needsPermission = true;
  render();
}

async function reconnect() {
  try {
    if ((await L.handle.requestPermission({ mode: 'read' })) === 'granted') { L.needsPermission = false; scan(); }
  } catch {
    toast("Couldn't reopen that folder. Pick it again.");
  }
}

async function pickFolder() {
  if (!window.showDirectoryPicker) { $('#dirInput').click(); return; }
  try {
    const h = await window.showDirectoryPicker({ id: 'midi-library', mode: 'read' });
    Object.assign(L, { handle: h, folderName: h.name, needsPermission: false, sessionOnly: false });
    await db.set('folder', h);
    scan();
  } catch (e) {
    if (e.name !== 'AbortError') toast("Couldn't open that folder");
  }
}

export async function scanHandle(h) { // also used by tests
  L.handle = h; L.folderName = h.name;
  return scan();
}

async function scan() {
  L.scanning = true;
  L.folder = [];
  render();
  const out = [];
  const walk = async (dir, path) => {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') await walk(h, path ? `${path}/${name}` : name);
      else if (MIDI_RE.test(name)) {
        out.push(fileEntry(path, name, () => h.getFile()));
        if (out.length % 200 === 0) { L.folder = out.slice(); invalidate(); render(); }
      }
    }
  };
  try { await walk(L.handle, ''); } catch { toast('Some folders could not be read'); }
  L.folder = out;
  L.scanning = false;
  invalidate();
  render();
  fillMeta();
}

// "MIDI File - Artist - Title (Easy).mid" style names are split into artist, title and level
function fileEntry(path, name, file) {
  let t = name.replace(MIDI_RE, '').replace(/^MIDI File\s*-\s*/i, '');
  let level = '';
  const m = t.match(/\(([^()]*)\)\s*$/);
  if (m) {
    const low = m[1].toLowerCase();
    level = /advanced|hard|impossible/.test(low) ? 'Advanced' : /intermediate/.test(low) ? 'Intermediate'
      : /medium|normal/.test(low) ? 'Medium' : /easy|beginner/.test(low) ? 'Easy' : '';
    if (level) t = t.slice(0, m.index).trim();
  }
  let artist = '';
  const i = t.indexOf(' - ');
  if (i > 0) { artist = t.slice(0, i); t = t.slice(i + 3); }
  return { id: 'f:' + (path ? path + '/' : '') + name, title: t, artist, level, folder: path, kind: 'folder', added: 0, file };
}

// Firefox/Safari: <input webkitdirectory> gives us the files for this visit only
function useFileList(files) {
  const list = [...files].filter((f) => MIDI_RE.test(f.name));
  if (!list.length) { toast('No MIDI files in that folder'); return; }
  L.folderName = (list[0].webkitRelativePath || '').split('/')[0] || 'Folder';
  L.sessionOnly = true;
  L.needsPermission = false;
  L.folder = list.map((f) => {
    const parts = (f.webkitRelativePath || f.name).split('/').slice(1);
    const name = parts.pop() || f.name;
    return { ...fileEntry(parts.join('/'), name, async () => f), added: Math.floor((f.lastModified || 0) / 1000) };
  });
  invalidate();
  render();
  fillMeta();
}

/* ---------- added files ---------- */

async function loadUploads() {
  const ks = (await db.keys()).filter((k) => typeof k === 'string' && k.startsWith('upload:'));
  L.uploads = await Promise.all(ks.map(async (k) => {
    const rec = await db.get(k);
    const e = fileEntry('', k.slice(7), async () => (await db.get(k)).blob);
    return { ...e, id: 'u:' + k.slice(7), kind: 'upload', key: k, added: Math.floor(((rec && rec.at) || 0) / 1000) };
  }));
  invalidate();
}

// opts are passed on to the player when a single file is added (e.g. { mode: 'watch' })
export async function addFiles(files, opts) {
  const list = [...files].filter((f) => MIDI_RE.test(f.name) || /midi/.test(f.type));
  if (!list.length) { toast('Those are not MIDI files'); return; }
  for (const f of list) await db.set('upload:' + f.name, { blob: f, at: Date.now() });
  await loadUploads();
  render();
  fillMeta();
  if (list.length === 1) {
    const e = L.uploads.find((u) => u.id === 'u:' + list[0].name);
    if (e) await hooks.onOpen(e, opts);
  } else toast(`Added ${list.length} songs`);
}

async function removeUpload(e) {
  await db.del(e.key);
  await loadUploads();
  render();
}

/* ---------- metadata (length, difficulty) for your own files, cached ---------- */

async function fillMeta() {
  const token = ++metaToken;
  const all = [...L.uploads, ...L.folder];
  let changed = 0;
  L.metaDone = 0;
  for (const e of all) {
    if (token !== metaToken) return;
    try {
      const f = await e.file();
      const sig = f.size + ':' + (f.lastModified || 0);
      if (!e.added && f.lastModified) e.added = Math.floor(f.lastModified / 1000);
      if (!L.meta[e.id] || L.meta[e.id].sig !== sig) {
        L.meta[e.id] = f.size > 3e6 ? { sig } : { sig, ...quickInfo(await f.arrayBuffer()) };
        changed++;
      }
    } catch {
      L.meta[e.id] = { sig: 'error', error: true };
    }
    L.metaDone++;
    if (L.metaDone % 40 === 0) {
      scheduleRender();
      if (changed > 200) { db.set('meta', L.meta); changed = 0; }
      await new Promise((r) => setTimeout(r));
    }
  }
  L.metaDone = all.length;
  if (changed) db.set('meta', L.meta);
  render();
}

/* ---------- plays, favourites, playlists, per-song settings ---------- */

export function recordPlay(id) {
  const p = (L.plays[id] ||= { count: 0 });
  p.count++;
  p.last = Date.now();
  db.set('plays', L.plays);
}

export const getSongPrefs = (id) => L.prefs[id];
export function setSongPrefs(id, v) {
  L.prefs[id] = v;
  db.set('songprefs', L.prefs);
}

function setFavorite(ids, on) {
  for (const id of ids) on ? L.favs.add(id) : L.favs.delete(id);
  db.set('favorites', [...L.favs]);
}

const savePlaylists = () => db.set('playlists', L.playlists);
function createPlaylist(name, ids = []) {
  const p = { id: 'p' + Date.now().toString(36), name, songs: [...new Set(ids)], created: Date.now() };
  L.playlists.push(p);
  savePlaylists();
  return p;
}
function addToPlaylist(p, ids) {
  const before = p.songs.length;
  for (const id of ids) if (!p.songs.includes(id)) p.songs.push(id);
  savePlaylists();
  toast(`Added ${p.songs.length - before} to “${p.name}”`);
}
function askPlaylistName(def = '') {
  const name = (window.prompt('Playlist name', def) || '').trim();
  return name || null;
}

// The song after this one in the list as currently filtered and sorted
export function nextEntry(id) {
  const list = L.shown.length ? L.shown : L.collection;
  if (!list.length) return null;
  const i = list.findIndex((e) => e.id === id);
  return list[(i + 1) % list.length];
}

/* ================= routing ================= */

const VIEWS = { library: 'Library', recent: 'Recent', favorites: 'Favorites', playlists: 'Playlists', playlist: '', devices: 'MIDI Devices' };

export function libraryHash() {
  return ui.view === 'playlist' ? `#/playlist/${ui.playlistId}` : `#/${ui.view}`;
}

export function applyRoute() {
  const [, view, arg] = (location.hash || '#/library').split('/');
  if (view === 'play' || view === 'free') { render(); return; }
  const next = VIEWS[view] !== undefined ? view : 'library';
  if (next !== ui.view || (arg || null) !== ui.playlistId) {
    ui.view = next;
    ui.playlistId = next === 'playlist' ? arg : null;
    ui.selected.clear();
    ui.level = ui.genre = ui.duration = '';
    ui.focus = 0;
    $('#search').value = '';
    $('#libScroll').scrollTop = 0;
  }
  closeSide();
  render();
}

function go(view, arg) {
  location.hash = view === 'playlist' ? `#/playlist/${arg}` : `#/${view}`;
}

/* ================= list building ================= */

function baseList() {
  if (ui.view === 'recent') return allEntries().filter((e) => L.plays[e.id]);
  if (ui.view === 'favorites') return allEntries().filter((e) => L.favs.has(e.id));
  if (ui.view === 'playlist') {
    const p = currentPlaylist();
    return p ? p.songs.map(entryById).filter(Boolean) : [];
  }
  return allEntries();
}
const currentPlaylist = () => L.playlists.find((p) => p.id === ui.playlistId);

function matches(e, words, skip) {
  if (skip !== 'level' && ui.level && e.level !== ui.level) return false;
  if (ui.genre && genreOf(e) !== ui.genre) return false;
  if (ui.duration) {
    const d = metaOf(e).dur || 0, [a, b] = DURATIONS[ui.duration];
    if (d < a || d >= b) return false;
  }
  if (words.length) {
    const hay = (e.title + ' ' + e.artist + ' ' + (e.folder || '') + ' ' + genreOf(e)).toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const lvl = (e) => (e.level ? LEVELS.indexOf(e.level) : 1.5);
function sorter() {
  const title = (a, b) => collator.compare(a.title, b.title);
  const by = {
    title,
    artist: (a, b) => collator.compare(a.artist, b.artist) || title(a, b),
    played: (a, b) => ((L.plays[a.id] || {}).last || 0) - ((L.plays[b.id] || {}).last || 0) || title(a, b),
    added: (a, b) => (a.added || 0) - (b.added || 0) || title(a, b),
    level: (a, b) => lvl(a) - lvl(b) || (metaOf(a).diff || 9) - (metaOf(b).diff || 9) || title(a, b),
    duration: (a, b) => (metaOf(a).dur || 1e9) - (metaOf(b).dur || 1e9) || title(a, b),
  }[ui.sort] || title;
  return ui.desc ? (a, b) => by(b, a) : by;
}
const sortKeyLetter = (e) => {
  const c = ((ui.sort === 'artist' ? e.artist : e.title) || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

/* ================= rendering ================= */

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 250);
}

export function render() {
  renderSide();
  renderHeader();
  const devices = ui.view === 'devices', lists = ui.view === 'playlists';
  $('#libBody').hidden = devices || lists;
  $('#devicesView').hidden = !devices;
  $('#playlistsView').hidden = !lists;
  if (devices) return renderDevices();
  if (lists) return renderPlaylists();

  renderStatus();
  renderShelf();

  const base = baseList();
  const words = $('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const pre = base.filter((e) => matches(e, words, 'level'));
  renderFilters(pre, base);

  let list = ui.level ? pre.filter((e) => e.level === ui.level) : pre;
  list.sort(sorter());
  // Songs without an artist (themes, jingles) go after the named artists in either direction
  if (ui.sort === 'artist') list = [...list.filter((e) => e.artist), ...list.filter((e) => !e.artist)];
  L.shown = list;
  const shownIds = new Set(list.map((e) => e.id));
  for (const id of ui.selected) if (!shownIds.has(id)) ui.selected.delete(id);
  ui.focus = Math.min(ui.focus, Math.max(0, list.length - 1));

  $('#resultCount').textContent = list.length === base.length
    ? songs(list.length)
    : `${list.length.toLocaleString()} of ${songs(base.length)}`;
  renderEmpty(list, base, words);
  renderBulk();
  renderAZ(list);
  $('#songList').classList.toggle('grid', ui.layout === 'grid');
  $('#tableHead').hidden = ui.layout === 'grid' || !list.length;
  sizeList();
  renderNow();
}

function renderSide() {
  const counts = { library: allEntries().length, recent: Object.keys(L.plays).length, favorites: L.favs.size };
  $$('#side .nav-item[data-view]').forEach((b) => {
    const v = b.dataset.view;
    const on = ui.view === v;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    const n = b.querySelector('.n');
    if (n) n.textContent = counts[v] ? counts[v].toLocaleString() : '';
  });
  $('#side .sec-title[data-view]').classList.toggle('on', ui.view === 'playlists');

  const box = $('#sidePlaylists');
  box.innerHTML = '';
  for (const p of L.playlists) {
    const b = el('button', 'nav-item pl-item' + (ui.view === 'playlist' && ui.playlistId === p.id ? ' on' : ''));
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h12M4 12h12M4 18h8M18 15v6"/></svg>';
    b.append(el('span', 'lbl', p.name), el('span', 'n', String(p.songs.length)));
    b.title = p.name;
    b.onclick = () => go('playlist', p.id);
    box.append(b);
  }
  if (!L.playlists.length) box.append(el('div', 'side-empty', 'No playlists yet'));

  const m = hooks.midiState();
  $$('#side .led, #midiChip .led').forEach((l) => l.classList.toggle('on', !!m.connected));
  $('#midiChip .mc-text').textContent = m.connected ? m.inputs[0].name : 'No keyboard';
}

function renderHeader() {
  const p = currentPlaylist();
  const title = ui.view === 'playlist' ? (p ? p.name : 'Playlist') : ui.view === 'library' ? 'All Songs' : VIEWS[ui.view];
  $('#viewTitle').textContent = title;
  $('#crumb').textContent = title;
  const total = allEntries().length;
  $('#viewSub').textContent = {
    library: personalEdition ? songs(total) : `${songs(total)} · add your own MIDI files any time`,
    recent: 'Songs you have opened, newest first',
    favorites: 'Songs you marked with a heart',
    playlists: `${L.playlists.length} playlist${L.playlists.length === 1 ? '' : 's'}`,
    playlist: p ? `Playlist · ${songs(p.songs.length)}` : 'This playlist no longer exists',
    devices: 'Keyboards connected over USB or Bluetooth',
  }[ui.view];
  $('#folderLabel').textContent = L.folder.length || L.needsPermission ? 'Change Music Folder' : 'Add Music Folder';
  $('#col3Head').textContent = ui.view === 'recent' ? 'Last played' : 'Genre';
}

function renderStatus() {
  const status = $('#libStatus');
  status.innerHTML = '';
  if (ui.view !== 'library') return;
  if (L.needsPermission) {
    status.append(el('span', '', `Your folder “${L.folderName}” needs permission again.`));
    const b = el('button', 'btn sm', 'Reconnect');
    b.onclick = reconnect;
    status.append(b);
  } else if (L.scanning) {
    status.append(el('span', '', `Looking for songs in “${L.folderName}”… ${L.folder.length}`));
  } else if (L.folder.length) {
    const total = L.uploads.length + L.folder.length;
    let txt = `Includes your folder “${L.folderName}” (${L.folder.length.toLocaleString()} songs)`;
    if (L.metaDone < total) txt += ` · reading ${L.metaDone}/${total}`;
    status.append(el('span', '', txt));
    if (L.sessionOnly) status.append(el('span', 'muted', ' · this browser can’t remember folders; Chrome or Edge can'));
  }
}

/* ---------- continue learning / featured ---------- */

function renderShelf() {
  const shelf = $('#shelf');
  const searching = $('#search').value.trim() || ui.level || ui.genre || ui.duration;
  if (ui.view !== 'library' || searching) { shelf.hidden = true; return; }
  const items = Object.entries(L.plays).sort((a, b) => b[1].last - a[1].last).map(([id]) => entryById(id)).filter(Boolean).slice(0, 12);
  const title = 'Continue learning';
  shelf.hidden = !items.length;
  shelf.classList.toggle('collapsed', ui.shelfCollapsed);
  $('#shelfTitle').textContent = title;
  $('#shelfToggle').setAttribute('aria-expanded', String(!ui.shelfCollapsed));
  $('#shelfToggle').title = ui.shelfCollapsed ? 'Show' : 'Hide';
  const row = $('#shelfRow');
  row.innerHTML = '';
  if (ui.shelfCollapsed) return;
  for (const e of items) {
    const c = el('button', 'tile');
    c.title = `Continue learning ${e.title}`;
    c.onclick = () => hooks.onOpen(e, { mode: 'practice', action: 'continue' });
    const info = el('span', 'tile-info');
    info.append(el('span', 'tile-t', e.title), el('span', 'tile-a', e.artist || e.folder || ''));
    const meta = el('span', 'tile-m');
    if (e.level) meta.append(levelBadge(e.level));
    const share = learnedShare(e);
    if (share > 0) meta.append(el('span', 'tile-learned', share >= 0.99 ? 'Learned' : `${Math.round(share * 100)}% learned`));
    else { const p = L.plays[e.id]; if (p) meta.append(el('span', 'tile-ago', ago(p.last))); }
    info.append(meta);
    if (share > 0) { const bar = el('span', 'tile-bar'); bar.append(el('i')); bar.firstChild.style.width = `${share * 100}%`; info.append(bar); }
    c.append(artEl(e, 'tile-art', 150), info);
    row.append(c);
  }
}

/* ---------- filters ---------- */

function renderFilters(pre, base) {
  const counts = { '': pre.length };
  for (const e of pre) if (e.level) counts[e.level] = (counts[e.level] || 0) + 1;
  if (ui.level && !counts[ui.level]) ui.level = '';
  const tabs = $('#levelTabs');
  tabs.innerHTML = '';
  for (const lv of ['', ...LEVELS]) {
    if (lv && !counts[lv]) continue;
    const b = el('button', 'tab' + (ui.level === lv ? ' on' : ''));
    b.setAttribute('aria-pressed', String(ui.level === lv));
    b.append(lv || 'All', el('span', 'tab-n', (counts[lv] || 0).toLocaleString()));
    b.onclick = () => { ui.level = lv; ui.focus = 0; keepToolbar(); render(); };
    tabs.append(b);
  }

  // Genres present in this view, most common first (offered in the Filters menu)
  const g = new Map();
  for (const e of base) { const x = genreOf(e); if (x) g.set(x, (g.get(x) || 0) + 1); }
  ui.genres = [...g].sort((a, b) => b[1] - a[1]);
  if (ui.genre && !g.has(ui.genre)) ui.genre = '';
  const active = (ui.genre ? 1 : 0) + (ui.duration ? 1 : 0);
  $('#filterLabel').textContent = active ? `Filters · ${active}` : 'Filters';
  $('#filterBtn').classList.toggle('on', active > 0);
  $('#sortSel').value = ui.sort;
  const dir = $('#sortDir');
  dir.classList.toggle('desc', ui.desc);
  dir.title = ui.desc ? 'Descending (click for ascending)' : 'Ascending (click for descending)';
  dir.setAttribute('aria-label', `Sort order: ${ui.desc ? 'descending' : 'ascending'}`);
  $$('#layoutSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.v === ui.layout); b.setAttribute('aria-pressed', String(b.dataset.v === ui.layout)); });
}

function renderEmpty(list, base, words) {
  const box = $('#emptyState');
  box.innerHTML = '';
  box.hidden = list.length > 0;
  if (list.length) return;
  let title, text, action;
  if (base.length && (words.length || ui.level || ui.genre || ui.duration)) {
    title = words.length ? `No songs match “${$('#search').value.trim()}”` : 'No songs match these filters';
    text = 'Check the spelling, try fewer words, or clear the filters.';
    action = ['Clear search and filters', clearFilters];
  } else if (ui.view === 'favorites') {
    title = 'No favourites yet';
    text = 'Use the heart on any song to keep it here.';
    action = ['Browse the library', () => go('library')];
  } else if (ui.view === 'recent') {
    title = 'Nothing played yet';
    text = 'Songs you open appear here so you can pick up where you left off.';
    action = ['Browse the library', () => go('library')];
  } else if (ui.view === 'playlist') {
    title = 'This playlist is empty';
    text = 'Select songs in the library and choose “Add to playlist”.';
    action = ['Browse the library', () => go('library')];
  } else {
    title = 'No songs yet';
    text = 'Open your MIDI folder or add MIDI files to get started.';
    action = ['Open MIDI folder', pickFolder];
  }
  box.append(el('div', 'empty-t', title), el('div', 'empty-x', text));
  const b = el('button', 'btn', action[0]);
  b.onclick = action[1];
  box.append(b);
}

function filterMenu(anchor) {
  const pick = (k, v) => () => { ui[k] = ui[k] === v ? '' : v; keepToolbar(); render(); };
  const mark = (on) => (on ? '✓' : '');
  openMenu(anchor, [
    { head: 'Length' },
    { label: 'Under 2 minutes', hint: mark(ui.duration === 'short'), action: pick('duration', 'short') },
    { label: '2 to 4 minutes', hint: mark(ui.duration === 'mid'), action: pick('duration', 'mid') },
    { label: 'Over 4 minutes', hint: mark(ui.duration === 'long'), action: pick('duration', 'long') },
    '-',
    { head: 'Genre' },
    ...(ui.genres || []).slice(0, 14).map(([g, n]) => ({ label: `${g}  ·  ${n}`, hint: mark(ui.genre === g), action: pick('genre', g) })),
    ...(ui.genres && ui.genres.length ? [] : [{ head: 'Genres appear as album info loads' }]),
    '-',
    { label: 'Clear search and filters', action: clearFilters },
  ]);
}

function clearFilters() {
  ui.level = ui.genre = ui.duration = '';
  $('#search').value = '';
  render();
}

/* ---------- virtual list / grid ---------- */

let win = { a: -1, b: -1, cols: 1 };

function geometry() {
  const box = $('#songList');
  if (ui.layout === 'grid') {
    const cols = Math.max(2, Math.floor((box.clientWidth + GAP) / (CARD_W + GAP)));
    return { cols, rowH: CARD_H + GAP, rows: Math.ceil(L.shown.length / cols) };
  }
  return { cols: 1, rowH: ROW_H, rows: L.shown.length };
}

function sizeList() {
  const g = geometry();
  $('#songList').style.height = g.rows * g.rowH + 'px';
  win = { a: -1, b: -1, cols: g.cols };
  renderWindow();
}

function renderWindow(force) {
  const sc = $('#libScroll'), box = $('#songList');
  if (box.offsetParent === null) return;
  const g = geometry();
  const y = sc.scrollTop - box.offsetTop;
  const a = Math.max(0, Math.floor(y / g.rowH) - 6);
  const b = Math.min(g.rows, Math.ceil((y + sc.clientHeight) / g.rowH) + 6);
  if (!force && a === win.a && b === win.b && g.cols === win.cols) return;
  win = { a, b, cols: g.cols };
  const frag = document.createDocumentFragment();
  if (ui.layout === 'grid') {
    for (let r = a; r < b; r++) {
      for (let c = 0; c < g.cols; c++) {
        const i = r * g.cols + c;
        if (i >= L.shown.length) break;
        const card = cardEl(L.shown[i], i);
        card.style.transform = `translate(${c * (CARD_W + GAP)}px, ${r * g.rowH}px)`;
        frag.append(card);
      }
    }
  } else {
    for (let i = a; i < b; i++) {
      const row = rowEl(L.shown[i], i);
      row.style.transform = `translateY(${i * ROW_H}px)`;
      frag.append(row);
    }
  }
  const active = document.activeElement;
  const hadFocus = box.contains(active) && active.closest('[data-i]') ? +active.closest('[data-i]').dataset.i : null;
  box.replaceChildren(frag);
  if (hadFocus != null) box.querySelector(`[data-i="${hadFocus}"]`)?.focus({ preventScroll: true });
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  learn: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M8 6v7M12 6v7M16 6v7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};

const levelBadge = (level) => el('span', 'lv lv-' + level.toLowerCase(), level);

function artEl(e, cls, size) {
  const src = artOf(e, size);
  const ph = () => {
    const d = el('span', cls + ' ph');
    let h = 0;
    for (const ch of (e.artist || e.title)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    d.style.setProperty('--h', h % 360);
    d.textContent = (e.title.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '♪').toUpperCase();
    return d;
  };
  if (!src) return ph();
  const img = el('img', cls);
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = src;
  img.onerror = () => img.replaceWith(ph());
  return img;
}

function checkbox(checked, cls) {
  const lab = el('label', cls);
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.tabIndex = -1;
  box.setAttribute('aria-label', 'Select song');
  lab.append(box);
  return lab;
}

function iconBtn(act, cls, html, title) {
  const b = el('button', cls);
  b.dataset.act = act;
  b.tabIndex = -1;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = html;
  return b;
}

function rowEl(e, i) {
  const m = metaOf(e);
  const row = el('div', 'row');
  row.dataset.i = i;
  row.tabIndex = i === ui.focus ? 0 : -1;
  row.setAttribute('role', 'row');
  row.setAttribute('aria-label', `${e.title}${e.artist ? ', ' + e.artist : ''}${e.level ? ', ' + e.level : ''}`);
  const sel = ui.selected.has(e.id);
  const previewing = hooks.previewId() === e.id;
  row.classList.toggle('sel', sel);
  row.classList.toggle('previewing', previewing);
  row.classList.toggle('current', ui.now === e);

  // Number; on hover (or while selecting) a checkbox takes its place
  const num = el('span', 'c-num');
  num.append(checkbox(sel, 'c-cb'), el('span', 'num', String(i + 1)));

  const art = el('span', 'c-artwrap');
  art.append(artEl(e, 'c-art', 100), iconBtn('preview', 'c-pv', previewing ? ICON.stop : ICON.play, previewing ? 'Stop preview' : 'Preview'));
  const text = el('span', 'c-text');
  const line = el('span', 'c-line');
  line.append(el('span', 'c-t', e.title));
  if (e.level) line.append(levelBadge(e.level));
  const sub = [e.artist, e.kind === 'folder' ? e.folder : e.kind === 'upload' ? 'Added file' : ''].filter(Boolean).join(' · ');
  text.append(line, el('span', 'c-a', sub || 'Unknown artist'));
  const ti = el('span', 'c-ti');
  ti.append(art, text);

  const p = L.plays[e.id];
  const third = ui.view === 'recent' ? (p ? ago(p.last) : '') : genreOf(e);

  const act = el('span', 'c-act');
  const fav = L.favs.has(e.id);
  act.append(iconBtn('fav', 'icon-act fav' + (fav ? ' on' : ''), ICON.heart, fav ? 'Remove from favourites' : 'Add to favourites'));
  const learn = el('button', 'btn sm learn');
  learn.dataset.act = 'learn';
  learn.tabIndex = -1;
  learn.title = 'Learn this song (Enter)';
  learn.innerHTML = ICON.learn + '<span>Learn</span>';
  act.append(learn, iconBtn('more', 'icon-act more', ICON.more, 'More options'));

  row.append(num, ti, el('span', 'c-gn', third || '—'), el('span', 'c-du', m.dur ? fmt(m.dur) : ''), act);
  return row;
}

function cardEl(e, i) {
  const m = metaOf(e);
  const c = el('div', 'card');
  c.dataset.i = i;
  c.tabIndex = i === ui.focus ? 0 : -1;
  c.setAttribute('aria-label', `${e.title}${e.artist ? ', ' + e.artist : ''}`);
  c.classList.toggle('sel', ui.selected.has(e.id));
  const art = el('div', 'card-art');
  const previewing = hooks.previewId() === e.id;
  art.append(artEl(e, 'card-img', 300), iconBtn('preview', 'card-pv', previewing ? ICON.stop : ICON.play, 'Preview'), checkbox(ui.selected.has(e.id), 'card-cb'));
  c.classList.toggle('current', ui.now === e);
  const meta = el('div', 'card-m');
  if (e.level) meta.append(levelBadge(e.level));
  meta.append(el('span', 'card-du', m.dur ? fmt(m.dur) : ''), iconBtn('more', 'icon-act more', ICON.more, 'More options'));
  c.append(art, el('div', 'card-t', e.title), el('div', 'card-a', e.artist || e.folder || ''), meta);
  return c;
}

/* ---------- A–Z ---------- */

function renderAZ(list) {
  const rail = $('#az');
  const show = (ui.sort === 'title' || ui.sort === 'artist') && list.length > 30;
  rail.hidden = !show;
  if (!show) return;
  const first = new Map();
  list.forEach((e, i) => { const k = sortKeyLetter(e); if (!first.has(k)) first.set(k, i); });
  rail.innerHTML = '';
  for (const k of ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
    const b = el('button', '', k);
    b.disabled = !first.has(k);
    b.title = first.has(k) ? `Jump to ${k}` : '';
    b.onclick = () => jumpTo(first.get(k));
    rail.append(b);
  }
}

function jumpTo(i) {
  const g = geometry();
  const row = ui.layout === 'grid' ? Math.floor(i / g.cols) : i;
  $('#libScroll').scrollTop = $('#songList').offsetTop + row * g.rowH - $('.toolbar').offsetHeight - 4;
  ui.focus = i;
  renderWindow(true);
  requestAnimationFrame(() => $(`#songList [data-i="${i}"]`)?.focus({ preventScroll: true }));
}

/* ---------- selection & bulk actions ---------- */

function toggleSelect(i, range) {
  const e = L.shown[i];
  if (!e) return;
  if (range && ui.anchor >= 0) {
    const on = !ui.selected.has(e.id);
    const [a, b] = [Math.min(ui.anchor, i), Math.max(ui.anchor, i)];
    for (let k = a; k <= b; k++) on ? ui.selected.add(L.shown[k].id) : ui.selected.delete(L.shown[k].id);
  } else {
    ui.selected.has(e.id) ? ui.selected.delete(e.id) : ui.selected.add(e.id);
    ui.anchor = i;
  }
  renderBulk();
  renderWindow(true);
}

function renderBulk() {
  const n = ui.selected.size;
  $('#songList').classList.toggle('selecting', n > 0);
  $('#tableHead').classList.toggle('selecting', n > 0);
  $('#bulkBar').hidden = n === 0;
  $('#filterBar').hidden = n > 0;
  const all = $('#selectAll');
  all.checked = n > 0 && n === L.shown.length;
  all.indeterminate = n > 0 && n < L.shown.length;
  if (!n) return;
  $('#bulkCount').textContent = `${n.toLocaleString()} selected`;
  $('#bulkRemove').hidden = ui.view !== 'playlist';
  const ids = [...ui.selected];
  $('#bulkFav').textContent = ids.every((id) => L.favs.has(id)) ? 'Remove from favourites' : 'Add to favourites';
}

/* ---------- menus ---------- */

let menuEl = null, menuReturn = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  menuReturn?.focus?.({ preventScroll: true });
  menuReturn = null;
}

function openMenu(anchor, items) {
  closeMenu();
  menuReturn = anchor.closest('[data-i]') || anchor;
  menuEl = el('div', 'menu-pop');
  menuEl.setAttribute('role', 'menu');
  const build = (list) => {
    menuEl.innerHTML = '';
    for (const it of list) {
      if (it === '-') { menuEl.append(el('div', 'menu-sep')); continue; }
      if (it.head) { menuEl.append(el('div', 'menu-head', it.head)); continue; }
      const b = el(it.href ? 'a' : 'button', 'menu-item' + (it.danger ? ' danger' : ''));
      b.setAttribute('role', 'menuitem');
      b.append(el('span', '', it.label));
      if (it.hint) b.append(el('span', 'menu-hint', it.hint));
      if (it.href) { b.href = it.href; b.target = '_blank'; b.rel = 'noopener'; b.onclick = () => setTimeout(closeMenu); }
      else b.onclick = (ev) => { ev.stopPropagation(); if (it.sub) build(it.sub()); else { closeMenu(); it.action(); } };
      menuEl.append(b);
    }
    menuEl.querySelector('.menu-item')?.focus();
  };
  build(items);
  menuEl.addEventListener('keydown', (ev) => {
    const els = [...menuEl.querySelectorAll('.menu-item')];
    const k = els.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); els[(k + 1) % els.length]?.focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); els[(k - 1 + els.length) % els.length]?.focus(); }
    if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); }
    if (ev.key === 'Tab') closeMenu();
  });
  document.body.append(menuEl);
  const r = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menuEl.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
}

function playlistItems(ids) {
  return [
    { head: 'Add to playlist' },
    ...L.playlists.map((p) => ({ label: p.name, hint: String(p.songs.length), action: () => { addToPlaylist(p, ids); render(); } })),
    { label: 'New playlist…', action: () => { const n = askPlaylistName(); if (n) { createPlaylist(n, ids); toast(`Created “${n}” with ${ids.length} song${ids.length > 1 ? 's' : ''}`); render(); } } },
  ];
}

function songMenu(e, anchor) {
  const items = () => [
    { label: 'Learn both hands', hint: 'Enter', action: () => hooks.onOpen(e, { mode: 'practice', hands: 'both' }) },
    ...(learnedShare(e) > 0 ? [
      { label: 'Review learned part', action: () => hooks.onOpen(e, { mode: 'practice', action: 'review' }) },
      { label: 'Continue learning', action: () => hooks.onOpen(e, { mode: 'practice', action: 'continue' }) },
    ] : []),
    { label: 'Learn left hand only', hint: 'L', action: () => hooks.onOpen(e, { mode: 'practice', hands: 'L' }) },
    { label: 'Learn right hand only', hint: 'R', action: () => hooks.onOpen(e, { mode: 'practice', hands: 'R' }) },
    { label: 'Listen', action: () => hooks.onOpen(e, { mode: 'watch' }) },
    '-',
    { label: L.favs.has(e.id) ? 'Remove from favourites' : 'Add to favourites', hint: 'F', action: () => { setFavorite([e.id], !L.favs.has(e.id)); render(); } },
    { label: 'Add to playlist…', sub: () => [{ label: '← Back', sub: items }, ...playlistItems([e.id])] },
    ...(ui.view === 'playlist' ? [{ label: 'Remove from this playlist', action: () => removeFromPlaylist([e.id]) }] : []),
    ...(e.kind === 'upload' ? ['-', { label: 'Remove from library', danger: true, action: () => removeUpload(e) }] : []),
  ];
  openMenu(anchor, items());
}

function removeFromPlaylist(ids) {
  const p = currentPlaylist();
  if (!p) return;
  p.songs = p.songs.filter((id) => !ids.includes(id));
  savePlaylists();
  ui.selected.clear();
  render();
}

/* ---------- playlists view ---------- */

function renderPlaylists() {
  const box = $('#playlistsView');
  box.innerHTML = '';
  const head = el('div', 'pl-head');
  const nb = el('button', 'btn', 'New playlist');
  nb.onclick = () => { const n = askPlaylistName(); if (n) { createPlaylist(n); render(); } };
  head.append(nb);
  box.append(head);
  if (!L.playlists.length) {
    const e = el('div', 'empty');
    e.append(el('div', 'empty-t', 'No playlists yet'), el('div', 'empty-x', 'Group songs into sets, like “Warm-ups” or “Christmas”. Select songs in the library and choose “Add to playlist”.'));
    box.append(e);
    return;
  }
  const t = el('div', 'pl-table');
  for (const p of L.playlists) {
    const r = el('div', 'pl-row');
    r.tabIndex = 0;
    r.onclick = () => go('playlist', p.id);
    r.onkeydown = (ev) => { if (ev.key === 'Enter') go('playlist', p.id); };
    const arts = el('span', 'pl-art');
    p.songs.slice(0, 4).map(entryById).filter(Boolean).forEach((e) => arts.append(artEl(e, 'pl-img', 100)));
    const info = el('span', 'c-ti');
    info.append(el('span', 'c-t', p.name), el('span', 'c-a', `${songs(p.songs.length)} · created ${new Date(p.created).toLocaleDateString()}`));
    const act = el('span', 'pl-act');
    const rn = el('button', 'btn sm', 'Rename');
    rn.onclick = (ev) => { ev.stopPropagation(); const n = askPlaylistName(p.name); if (n) { p.name = n; savePlaylists(); render(); } };
    const del = el('button', 'btn sm danger', 'Delete');
    del.onclick = (ev) => {
      ev.stopPropagation();
      if (!window.confirm(`Delete the playlist “${p.name}”? The songs stay in your library.`)) return;
      L.playlists = L.playlists.filter((x) => x !== p);
      savePlaylists();
      render();
    };
    act.append(rn, del);
    r.append(arts, info, act);
    t.append(r);
  }
  box.append(t);
}

/* ---------- MIDI devices view ---------- */

export function renderDevices() {
  if (ui.view !== 'devices') { renderSide(); return; }
  const m = hooks.midiState();
  const box = $('#devicesView');
  box.innerHTML = '';
  const card = el('section', 'dev-card');
  const top = el('div', 'dev-top');
  const txt = el('div', 'dev-text');
  txt.append(
    el('div', 'dev-title', m.connected ? `${m.inputs.length} keyboard${m.inputs.length > 1 ? 's' : ''} connected` : m.supported ? 'No keyboard connected' : 'This browser can’t use MIDI keyboards'),
    el('div', 'dev-sub', !m.supported ? 'Use Chrome or Edge to connect a keyboard. The computer keyboard and mouse still work.'
      : m.access ? 'Plug in a keyboard over USB or Bluetooth and it shows up here.' : 'Allow access so Piano Tutor can hear your keyboard.'),
  );
  top.append(el('span', 'led' + (m.connected ? ' on' : '')), txt);
  if (m.supported) {
    const b = el('button', 'btn', m.access ? 'Refresh' : 'Connect keyboard');
    b.onclick = () => hooks.connectMidi();
    top.append(b);
  }
  card.append(top);
  for (const d of m.inputs || []) {
    const r = el('div', 'dev-row');
    r.append(el('span', 'led on'), el('span', 'c-t', d.name), el('span', 'c-a', d.manufacturer || ''));
    card.append(r);
  }
  const test = el('div', 'dev-test');
  test.append(el('span', 'muted', 'Last key played'), el('span', 'dev-note', m.lastNote || '–'));
  card.append(test);
  // Where the app's sound plays
  const out = el('section', 'dev-card dev-out');
  const head = el('div', 'dev-top');
  const ht = el('div', 'dev-text');
  ht.append(el('div', 'dev-title', 'Play sound on'), el('div', 'dev-sub', 'Send the song, previews and metronome to your keyboard to hear them through its own speakers. Keys you press on the keyboard are not sent back, so nothing doubles up.'));
  head.append(ht);
  out.append(head);
  const opts = [{ name: '', label: 'This computer', sub: 'Speakers or headphones' }, ...(m.outputs || []).map((o) => ({ name: o.name, label: o.name, sub: o.manufacturer || 'MIDI keyboard' }))];
  for (const o of opts) {
    const on = (m.output || '') === o.name;
    const b = el('button', 'dev-opt' + (on ? ' on' : ''));
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.append(el('span', 'radio'), el('span', 'c-t', o.label), el('span', 'c-a', o.sub));
    b.onclick = () => hooks.setOutput(o.name);
    out.append(b);
  }
  if (!m.access && m.supported) {
    const r = el('div', 'dev-row');
    r.append(el('span', 'c-a', 'Connect your keyboard above to see it here.'));
    out.append(r);
  }

  // Which instrument the sound uses
  const tone = el('section', 'dev-card dev-out');
  const th = el('div', 'dev-top');
  const tt = el('div', 'dev-text');
  tt.append(el('div', 'dev-title', 'Tone'), el('div', 'dev-sub', m.output
    ? `How ${m.output} sounds. "Keyboard's own tone" follows whatever you pick on its panel, for the song and your keys alike.`
    : 'How the song and your keys sound on this computer.'));
  th.append(tt);
  const tc = el('div', 'size-chips');
  const { list, current: curTone } = hooks.tones();
  for (const t of list) {
    if (t.midiOnly && !m.output) continue;
    const b = el('button', 'tab' + (curTone === t.id ? ' on' : ''), t.label);
    b.setAttribute('aria-pressed', String(curTone === t.id));
    b.onclick = () => hooks.setTone(t.id);
    tc.append(b);
  }
  tone.append(th, tc);

  // Keyboard size, so the screen shows exactly the keys you have
  const size = el('section', 'dev-card dev-out');
  const sh = el('div', 'dev-top');
  const st = el('div', 'dev-text');
  st.append(el('div', 'dev-title', 'Your keyboard size'), el('div', 'dev-sub', 'The screen then shows exactly your keys, spread across the full width. Notes beyond your keyboard move an octave inside it.'));
  sh.append(st);
  const chips = el('div', 'size-chips');
  const current = hooks.keyboardSize ? hooks.keyboardSize() : 'fit';
  for (const [v, label] of [['fit', 'Fit to song'], ['25', '25 keys'], ['37', '37 keys'], ['49', '49 keys'], ['61', '61 keys'], ['76', '76 keys'], ['88', '88 keys']]) {
    const b = el('button', 'tab' + (current === v ? ' on' : ''), label);
    b.setAttribute('aria-pressed', String(current === v));
    b.onclick = () => hooks.setKeyboardSize(v);
    chips.append(b);
  }
  size.append(sh, chips);

  const help = el('section', 'dev-help');
  help.append(el('h3', '', 'No keyboard?'), el('p', '', 'Play with your computer keyboard: the bottom row Z X C V B N M , . / and the top row Q W E R T Y U I O P [ ] are the white keys, and the rows just above them are the black keys. Up and Down arrows change the octave. You can also click the keys on screen, or try Free Play.'));
  box.append(card, size, out, tone, help);
  renderSide();
}

/* ================= helpers ================= */

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.floor(d / 7)} wk ago`;
  return new Date(t).toLocaleDateString();
}

// After a filter change, don't leave the list scrolled past its new end
function keepToolbar() {
  const sc = $('#libScroll');
  sc.scrollTop = Math.min(sc.scrollTop, $('.toolbar').offsetTop);
}

export function surprise() {
  const list = L.shown.length ? L.shown : L.collection;
  if (list.length) hooks.onOpen(list[Math.floor(Math.random() * list.length)], { mode: 'practice' });
}

function closeSide() { document.body.classList.remove('side-open'); }

function focusRow(i) {
  if (!L.shown.length) return;
  i = Math.max(0, Math.min(L.shown.length - 1, i));
  const sc = $('#libScroll'), g = geometry();
  const row = ui.layout === 'grid' ? Math.floor(i / g.cols) : i;
  const y = $('#songList').offsetTop + row * g.rowH;
  const head = $('.toolbar').offsetHeight;
  if (y < sc.scrollTop + head) sc.scrollTop = y - head - 4;
  else if (y + g.rowH > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + g.rowH - sc.clientHeight + 4;
  ui.focus = i;
  renderWindow(true);
  $(`#songList [data-i="${i}"]`)?.focus({ preventScroll: true });
}

export function refreshPreview() {
  renderWindow(true);
  renderNow();
}

/* ---------- bottom player bar ---------- */

function setNow(e) {
  ui.now = e;
  renderNow();
  renderWindow(true);
}

function renderNow() {
  const e = ui.now, bar = $('#nowBar');
  bar.hidden = !e || $('#library').hidden;
  if (!e) return;
  const art = $('#nbArt');
  art.replaceChildren(artEl(e, 'nb-art', 150));
  $('#nbTitle').textContent = e.title;
  $('#nbArtist').textContent = [e.artist, e.level].filter(Boolean).join(' · ') || 'Unknown artist';
  const fav = L.favs.has(e.id);
  const fb = $('#nbFav');
  fb.className = 'icon-act fav' + (fav ? ' on' : '');
  fb.innerHTML = ICON.heart;
  fb.title = fav ? 'Remove from favourites' : 'Add to favourites';
  const playing = hooks.previewId() === e.id;
  const pb = $('#nbPlay');
  pb.innerHTML = playing ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>' : ICON.play;
  pb.title = playing ? 'Stop preview' : 'Play a 30-second preview';
  pb.setAttribute('aria-label', pb.title);
  if (playing) tickNow(); else { $('#nbFill').style.width = '0%'; $('#nbPos').textContent = '0:00'; }
}

let nowRaf = 0;
function tickNow() {
  cancelAnimationFrame(nowRaf);
  const step = () => {
    const pr = hooks.previewProgress();
    if (!pr || !ui.now || pr.id !== ui.now.id) return;
    $('#nbFill').style.width = Math.min(100, (pr.pos / pr.len) * 100) + '%';
    $('#nbPos').textContent = fmt(pr.pos);
    $('#nbLen').textContent = fmt(pr.len);
    nowRaf = requestAnimationFrame(step);
  };
  step();
}

function previewAt(offset) {
  if (!L.shown.length) return;
  const i = ui.now ? L.shown.indexOf(ui.now) : -1;
  const e = L.shown[(i + offset + L.shown.length) % L.shown.length];
  setNow(e);
  hooks.onPreview(e);
  focusRow(L.shown.indexOf(e));
}

/* ================= events ================= */

function wire() {
  $('#folderBtn').onclick = pickFolder;
  $('#dirInput').addEventListener('change', (e) => { useFileList(e.target.files); e.target.value = ''; });
  $('#addFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  $('#surpriseBtn').onclick = surprise;

  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.focus = 0; keepToolbar(); render(); }, 60);
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && L.shown.length) { e.preventDefault(); focusRow(0); }
    if (e.key === 'Enter' && L.shown.length) hooks.onOpen(L.shown[0], { mode: 'practice' });
    if (e.key === 'Escape') { e.stopPropagation(); if ($('#search').value) { $('#search').value = ''; render(); } else $('#search').blur(); }
  });
  $('#filterBtn').onclick = (ev) => { ev.stopPropagation(); filterMenu(ev.currentTarget); };
  $('#sortSel').onchange = (e) => { ui.sort = e.target.value; ui.desc = ui.sort === 'played' || ui.sort === 'added'; saveUi(); render(); };
  $('#sortDir').onclick = () => { ui.desc = !ui.desc; saveUi(); render(); };
  $$('#layoutSeg button').forEach((b) => { b.onclick = () => { ui.layout = b.dataset.v; saveUi(); render(); }; });

  $('#shelfToggle').onclick = () => { ui.shelfCollapsed = !ui.shelfCollapsed; saveUi(); render(); };
  $('#shelfAll').onclick = () => go('recent');
  $('#navBack').onclick = () => history.back();
  $('#navFwd').onclick = () => history.forward();
  $('#newPlaylist').onclick = () => { const n = askPlaylistName(); if (n) { const p = createPlaylist(n); go('playlist', p.id); } };
  $('#side .sec-title[data-view]').onclick = () => go('playlists');
  $('#midiChip').onclick = () => go('devices');
  $('#nbPlay').onclick = () => { if (ui.now) hooks.onPreview(ui.now); };
  $('#nbPrev').onclick = () => previewAt(-1);
  $('#nbNext').onclick = () => previewAt(1);
  $('#nbLearn').onclick = () => { if (ui.now) hooks.onOpen(ui.now, { mode: 'practice' }); };
  $('#nbMore').onclick = (ev) => { ev.stopPropagation(); if (ui.now) songMenu(ui.now, ev.currentTarget); };
  $('#nbFav').onclick = () => { if (ui.now) { setFavorite([ui.now.id], !L.favs.has(ui.now.id)); render(); renderNow(); } };
  $('#sideOpen').onclick = () => document.body.classList.add('side-open');
  $('#sideScrim').onclick = closeSide;
  $$('#side .nav-item[data-view]').forEach((b) => { b.onclick = () => go(b.dataset.view); });

  $('#selectAll').onchange = (e) => {
    if (e.target.checked) L.shown.forEach((x) => ui.selected.add(x.id)); else ui.selected.clear();
    renderBulk();
    renderWindow(true);
  };
  $('#bulkClear').onclick = () => { ui.selected.clear(); renderBulk(); renderWindow(true); };
  $('#bulkFav').onclick = () => {
    const ids = [...ui.selected];
    setFavorite(ids, !ids.every((id) => L.favs.has(id)));
    render();
  };
  $('#bulkList').onclick = (ev) => { ev.stopPropagation(); openMenu(ev.currentTarget, playlistItems([...ui.selected])); };
  $('#bulkRemove').onclick = () => removeFromPlaylist([...ui.selected]);

  const sc = $('#libScroll');
  let ticking = false;
  sc.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; renderWindow(); });
  }, { passive: true });
  sc.addEventListener('scroll', () => { if (menuEl) closeMenu(); }, { passive: true });
  new ResizeObserver(() => sizeList()).observe($('#songList'));

  const list = $('#songList');
  list.addEventListener('click', (ev) => {
    const host = ev.target.closest('[data-i]');
    if (!host) return;
    const i = +host.dataset.i, e = L.shown[i];
    ui.focus = i;
    if (ev.target.closest('.c-cb, .card-cb')) { ev.preventDefault(); toggleSelect(i, ev.shiftKey); return; }
    const btn = ev.target.closest('[data-act]');
    const act = btn && btn.dataset.act;
    if (act === 'preview') { setNow(e); hooks.onPreview(e); return; }
    if (act === 'learn') { hooks.onOpen(e, { mode: 'practice' }); return; }
    if (act === 'fav') { setFavorite([e.id], !L.favs.has(e.id)); render(); return; }
    if (act === 'more') { ev.stopPropagation(); songMenu(e, btn); return; }
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ui.selected.size) { toggleSelect(i, ev.shiftKey); return; }
    if (ev.detail > 1) return; // second click of a double click
    if (ui.now !== e) { setNow(e); hooks.onPreview(e); }
  });
  list.addEventListener('dblclick', (ev) => {
    const host = ev.target.closest('[data-i]');
    if (!host || ev.target.closest('a, button, label')) return;
    hooks.onOpen(L.shown[+host.dataset.i], { mode: 'practice' });
  });
  list.addEventListener('keydown', (ev) => {
    const host = ev.target.closest('[data-i]');
    if (!host || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const i = +host.dataset.i, e = L.shown[i];
    const step = ui.layout === 'grid' ? win.cols : 1;
    const keys = {
      ArrowDown: () => focusRow(i + step),
      ArrowUp: () => (i - step < 0 ? $('#search').focus() : focusRow(i - step)),
      ArrowRight: () => ui.layout === 'grid' && focusRow(i + 1),
      ArrowLeft: () => ui.layout === 'grid' && focusRow(i - 1),
      Home: () => focusRow(0), End: () => focusRow(L.shown.length - 1),
      PageDown: () => focusRow(i + 10 * step), PageUp: () => focusRow(i - 10 * step),
      Enter: () => hooks.onOpen(e, { mode: 'practice' }),
      ' ': () => { setNow(e); hooks.onPreview(e); },
      x: () => toggleSelect(i, false), X: () => toggleSelect(i, true),
      f: () => { setFavorite([e.id], !L.favs.has(e.id)); render(); focusRow(i); },
      l: () => hooks.onOpen(e, { mode: 'practice', hands: 'L' }),
      r: () => hooks.onOpen(e, { mode: 'practice', hands: 'R' }),
      m: () => songMenu(e, host.querySelector('[data-act="more"]') || host),
    };
    const fn = keys[ev.key];
    if (fn) { ev.preventDefault(); fn(); }
  });

  document.addEventListener('click', (ev) => { if (menuEl && !menuEl.contains(ev.target)) closeMenu(); });
  window.addEventListener('keydown', (ev) => {
    if ($('#library').hidden) return;
    const typing = /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName) && ev.target.type !== 'checkbox';
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (ev.key === 'Escape') {
      if (menuEl) { closeMenu(); return; }
      if (ui.selected.size) { ui.selected.clear(); renderBulk(); renderWindow(true); return; }
      closeSide();
    }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === '/') { ev.preventDefault(); $('#search').focus(); }
  });
  window.addEventListener('hashchange', applyRoute);
}
