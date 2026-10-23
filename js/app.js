// Piano Tutor: the player. Falling notes, keyboard input, practice modes and scoring.
import { $, $$, el, fmt, isBlack, lowerBound, noteName, NOTE_NAMES, SOLFEGE, toast } from './util.js';
import { parseMidi, midiClass, HAND_COLORS, HAND_GRADIENTS, HAND_NAMES } from './song.js';
import * as audio from './audio.js';
import { initMonetize } from './monetize.js';
import { createSheet } from './sheet.js';
import { initLibrary, addFiles, recordPlay, getSongPrefs, setSongPrefs, nextEntry, entryById, hasCollection, libraryHash, renderDevices, refreshPreview, render as renderLibrary } from './library.js';

const LEAD_IN = 2;   // seconds of empty roll before the first note
const EARLY = 0.35;  // Practice: a press this early (song seconds) counts for the next chord
const TOL = 0.15;    // Play along: timing window either side of a note, in real seconds
const BAD = '#ff5d6c', FREE = '#9aa8bb', MISSED = '#2a303b';
const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

const prefs = Object.assign(
  { labels: 'letters', sheet: false, metronome: false, songVol: 0.8, myVol: 0.9, range: 'fit', window: 3, otherHand: true, output: '', tone: 'piano', keyTone: 'keyboard' },
  (() => { try { return JSON.parse(localStorage.getItem('keys.prefs')) || {}; } catch { return {}; } })(),
);
const savePrefs = () => { try { localStorage.setItem('keys.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } };

const S = {
  song: null, entry: null,
  t: -LEAD_IN, playing: false, speed: 1,
  mode: 'practice',     // watch | practice | recital
  hands: 'both',        // L | R | both
  loopA: null, loopB: null,
  learnedMap: {},       // how far you've learned this song, per hand choice: { both, L, R } in seconds
  review: false,        // replaying start -> learned point
  runOk: false,         // this run started inside the learned part (no skipping ahead)
  extHit: 0, extMiss: 0, // notes beyond the learned point in this run (Play along)
  lo: 48, hi: 83,
  learn: [],            // notes the player plays, sorted by time
  state: new Uint8Array(0), // per learn note: 0 pending, 1 hit, 2 missed
  playIdx: 0, waitIdx: 0, judgeIdx: 0, beatIdx: 0,
  chord: null, waiting: false,
  pressed: new Map(),   // midi -> key colour while held
  sparks: [],
  transpose: 0,         // semitones the song is moved up or down
  free: false,          // Free Play: no song, just the piano
  trails: [],           // Free Play: notes rising from the keys
};

const canvas = $('#roll');
const ctx = canvas.getContext('2d');
const sheet = createSheet($('#sheet'), $('#sheetStrip'));

/* ================= opening songs ================= */

// opts.mode: 'watch' | 'practice' | 'recital'; opts.hands: 'L' | 'R' | 'both'
async function openEntry(entry, opts = {}) {
  audio.unlock();
  stopPreview();
  S.free = false;
  try {
    const f = await entry.file();
    const song = parseMidi(await f.arrayBuffer(), { id: entry.id, title: entry.title });
    song.artist = entry.artist || '';
    song.level = entry.level || '';
    if (!song.notes.length) { toast('That file has no piano notes'); return; }
    S.entry = entry;
    $('#player').classList.remove('free');
    setSong(song, opts);
    syncRec();
    recordPlay(entry.id);
    showPlayer(true);
    if (opts.action === 'review') startReview();
    else if (opts.action === 'continue') continueLearning();
    const hash = '#/play/' + encodeURIComponent(entry.id);
    if (location.hash !== hash) location.hash = hash;
  } catch (err) {
    console.error(err);
    toast("Couldn't read that file. Is it a MIDI file?");
  }
}

function setSong(song, opts = {}) {
  S.song = song;
  S.loopA = S.loopB = null;
  S.speed = 1;

  const p = getSongPrefs(song.id);
  S.learnedMap = { ...((p && p.learned) || {}) };
  S.review = false;
  if (p) {
    if (p.hands && p.hands.length === song.tracks.length) song.tracks.forEach((t, i) => { t.hand = p.hands[i]; });
    S.mode = p.mode || S.mode;
    S.hands = p.practiceHands || S.hands;
    S.speed = p.speed || 1;
  }
  for (const n of song.notes) n.midi0 = n.midi;
  song.key0 = song.key;
  applyTranspose(song, (p && p.transpose) || 0);
  if (opts.mode) S.mode = opts.mode;
  if (opts.hands) S.hands = opts.hands;
  if (S.hands !== 'both' && !song.tracks.some((t) => t.hand === S.hands)) {
    if (opts.hands) toast(`This song has no separate ${S.hands === 'L' ? 'left' : 'right'}-hand part, so both hands are shown`);
    S.hands = 'both';
  }

  pause();
  fitRange();
  applyRoles();
  seek(-LEAD_IN);
  sheet.reset();
  if (prefs.sheet) sheet.render(song);

  $('#songTitle').textContent = [song.title, song.artist, song.level].filter(Boolean).join(' · ');
  $('#seek').max = song.duration;
  $('#durTime').textContent = fmt(song.duration);
  updateBpm();
  syncSegs();
  updateLoopUI();
  renderTracks();
  renderLearned();
  renderKey();
}

function saveSongSettings() {
  if (!S.song) return;
  setSongPrefs(S.song.id, { hands: S.song.tracks.map((t) => t.hand), mode: S.mode, practiceHands: S.hands, speed: S.speed, learned: S.learnedMap, transpose: S.transpose });
}

/* ================= key: move the whole song up or down ================= */

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
function shiftKey(key, d) {
  if (!key || !(key.key[0] in SEMI)) return key;
  const root = SEMI[key.key[0]] + (key.key[1] === '#' ? 1 : key.key[1] === 'b' ? -1 : 0);
  const i = (((root + d) % 12) + 12) % 12;
  return { key: (key.scale === 'minor' ? MINOR_KEYS : MAJOR_KEYS)[i], scale: key.scale };
}
const keyName = (key) => (key ? `${key.key} ${key.scale === 'minor' ? 'minor' : 'major'}` : '');

function applyTranspose(song, d) {
  S.transpose = Math.max(-12, Math.min(12, d));
  for (const n of song.notes) n.midi = Math.max(21, Math.min(108, n.midi0 + S.transpose));
  song.key = shiftKey(song.key0, S.transpose);
}

function setTranspose(d) {
  if (!S.song) return;
  applyTranspose(S.song, d);
  fitRange();
  applyRoles();
  seek(S.t);
  if (prefs.sheet) sheet.render(S.song);
  renderKey();
  saveSongSettings();
}

// The shift (within half an octave) that puts the fewest of your notes on black keys
function easiestKey() {
  const mine = S.song.notes.filter((n) => S.song.tracks[n.track].hand === 'R' || S.song.tracks[n.track].hand === 'L');
  let best = 0, bestCount = Infinity;
  for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6]) {
    const c = mine.reduce((s, n) => s + (isBlack(n.midi0 + d) ? 1 : 0), 0);
    if (c < bestCount) { best = d; bestCount = c; }
  }
  setTranspose(best);
  toast(best ? `Moved ${Math.abs(best)} semitone${Math.abs(best) > 1 ? 's' : ''} ${best > 0 ? 'up' : 'down'}: ${bestCount} black-key notes left` : 'This song is already in its easiest key');
}

function renderKey() {
  if (!S.song) return;
  const d = S.transpose;
  $('#keyVal').textContent = d > 0 ? `+${d}` : String(d);
  const from = keyName(S.song.key0), to = keyName(S.song.key);
  $('#keyInfo').textContent = !d ? (from ? `Original key: ${from}` : 'Original key')
    : from ? `${to} (from ${from})` : `${Math.abs(d)} semitone${Math.abs(d) > 1 ? 's' : ''} ${d > 0 ? 'up' : 'down'}`;
}
$('#keyDown').onclick = () => setTranspose(S.transpose - 1);
$('#keyUp').onclick = () => setTranspose(S.transpose + 1);
$('#keyReset').onclick = () => setTranspose(0);
$('#keyEasy').onclick = () => S.song && easiestKey();

// Keyboard sizes people own, with their usual lowest and highest keys
const KEYBOARDS = { 25: [48, 72], 37: [48, 84], 49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108] };
if (prefs.range === 'full') prefs.range = '88';
const fixedRange = () => KEYBOARDS[prefs.range] || null;

// Notes beyond a smaller keyboard are shown (and checked) an octave or two inside it; they still sound at pitch
function keyFor(m) {
  const r = fixedRange();
  if (!r) return m;
  while (m < r[0]) m += 12;
  while (m > r[1]) m -= 12;
  return m;
}

function setKeyboardSize(v) {
  prefs.range = v;
  savePrefs();
  $('#rangeSel').value = v;
  if (S.free) { const r = fixedRange(); S.baseLo = r ? r[0] : 36; S.baseHi = r ? r[1] : 96; layout(); }
  else fitRange();
  if (S.song) { applyRoles(); seek(S.t); }
  renderDevices();
}

// The octaves the song needs (at least three); layout() widens this to fill the screen.
// With a keyboard size chosen, exactly that keyboard is shown.
function fitRange() {
  const fixed = fixedRange();
  if (fixed || !S.song) { [S.baseLo, S.baseHi] = fixed || [21, 108]; layout(); return; }
  let lo = 108, hi = 21;
  for (const n of S.song.notes) {
    if (S.song.tracks[n.track].hand === 'off') continue;
    lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi);
  }
  if (lo > hi) { lo = 48; hi = 83; }
  lo -= lo % 12; hi += 11 - (hi % 12);
  while (hi - lo + 1 < 36) { if (lo > 21) lo -= 12; if (hi - lo + 1 < 36 && hi < 108) hi += 12; }
  S.baseLo = Math.max(21, lo); S.baseHi = Math.min(108, hi);
  layout();
}

// Decide per track who plays it: you ('me'), the app ('hear'), quietly in the background ('bg'), or nobody.
// With one hand chosen, the other hand is played for you ('hear') or silenced ('muted') per the
// "Other hand" toggle. In Listen mode the chosen hand is the only one you hear.
function applyRoles() {
  const { tracks, notes } = S.song;
  for (const t of tracks) {
    const chosen = S.hands === 'both' || S.hands === t.hand;
    if (t.hand === 'off') t.role = 'off';
    else if (t.hand === 'bg') t.role = 'bg';
    else if (chosen) t.role = S.mode === 'watch' ? 'hear' : 'me';
    else t.role = S.mode !== 'watch' && prefs.otherHand ? 'hear' : 'muted';
  }
  S.learn = notes.filter((n) => tracks[n.track].role === 'me');
  for (const n of notes) { n.li = -1; n.k = keyFor(n.midi); }
  S.learn.forEach((n, i) => { n.li = i; });
  resetRun(S.t);
}

function resetRun(t) {
  S.state = new Uint8Array(S.learn.length);
  S.waitIdx = lowerBound(S.learn, t - 0.001);
  S.judgeIdx = S.waitIdx;
  S.chord = null;
  S.runOk = t <= learned() + 0.05;
  S.extFrom = learned(); // notes after this point are new in this run
  S.extHit = S.extMiss = 0;
}

/* ================= learned part: review from the start, continue from where you stopped ================= */

const learned = () => (S.song ? S.learnedMap[S.hands] || 0 : 0);
let lastSavedLearned = 0;

function setLearned(t, save) {
  S.learnedMap[S.hands] = Math.max(0, Math.min(t, S.song.duration));
  if (save || Math.abs(S.learnedMap[S.hands] - lastSavedLearned) >= 1) { lastSavedLearned = S.learnedMap[S.hands]; saveSongSettings(); }
  renderLearned();
}

// The learned point moves forward as you play past it, but only when this run started inside the learned
// part: Practice waits for every note, so reaching a point means you played it; Play along needs 80% of the new notes.
function extendLearned(t) {
  const cur = learned();
  if (t <= cur || !S.runOk || S.mode === 'watch' || !S.learn.length) return;
  if (S.mode === 'recital') {
    // Only count up to notes that have already been judged as hit or missed
    if (S.judgeIdx < S.learn.length) t = Math.min(t, S.learn[S.judgeIdx].time - 0.01);
    const total = S.extHit + S.extMiss;
    if (t <= cur || (total && S.extMiss / total > 0.2)) return;
  }
  const done = t >= S.song.duration - 0.05 && cur < S.song.duration - 0.05;
  setLearned(t);
  if (done) { saveSongSettings(); toast('You learned the whole song! Press Enter to play it all from the start.'); }
}

// End of the bar that contains the learned point
function learnedEnd() {
  const l = learned();
  if (l <= 0) return 0;
  const m = S.song.measures.find((x) => x >= l - 0.01);
  return Math.min(S.song.duration, m === undefined ? S.song.duration : m);
}

function startReview() {
  if (!S.song) return;
  if (S.review) { stopReview(); return; }
  if (learned() <= 0) { toast('Nothing learned yet. Practise from the start, or press K to mark how far you know it.'); return; }
  S.loopA = -LEAD_IN;
  S.loopB = learnedEnd();
  S.review = true;
  seek(S.loopA);
  updateLoopUI();
  renderLearned();
  play();
  toast(`Reviewing everything you know: 0:00 to ${fmt(S.loopB)}`);
}

function stopReview() {
  S.review = false;
  S.loopA = S.loopB = null;
  updateLoopUI();
  renderLearned();
}

// Start one bar before where you stopped, to learn the next part
function continueLearning() {
  if (!S.song) return;
  if (S.review || S.loopA != null) { S.review = false; S.loopA = S.loopB = null; updateLoopUI(); }
  const l = learned();
  let start = -LEAD_IN;
  if (l > 0) {
    const ms = S.song.measures;
    let j = 0;
    while (j + 1 < ms.length && ms[j + 1] <= l) j++;
    start = j > 0 ? ms[j - 1] : -LEAD_IN;
  }
  seek(start);
  renderLearned();
  play();
}

function markLearned() {
  if (!S.song) return;
  if (S.t <= 0.05) { setLearned(0, true); toast('Learned part cleared for this hand choice'); return; }
  setLearned(S.t, true);
  toast(`Marked as learned up to ${fmt(S.t)}. Press Enter to review it from the start.`);
}

function renderLearned() {
  if (!S.song) return;
  const l = learned(), dur = S.song.duration;
  const pct = Math.round((l / dur) * 100);
  $('#learnBand').style.width = `${(l / dur) * 100}%`;
  const rb = $('#reviewBtn');
  rb.disabled = l <= 0 && !S.review;
  rb.classList.toggle('on', S.review);
  rb.textContent = S.review ? 'Stop review' : l > 0 ? `Review 0:00 to ${fmt(learnedEnd())}` : 'Review';
  $('#learnedPct').textContent = l > 0 ? `${pct}% learned` : 'Not started';
  $('#learnedInfo').textContent = l > 0
    ? `You know this song up to ${fmt(l)} of ${fmt(dur)} (${pct}%) with ${S.hands === 'both' ? 'both hands' : S.hands === 'L' ? 'the left hand' : 'the right hand'}.`
    : 'Nothing learned yet for this hand choice.';
}

/* ================= playback ================= */

function play() {
  if (!S.song) return;
  audio.unlock();
  if (S.t >= S.song.duration) seek(S.loopA ?? -LEAD_IN);
  S.playing = true;
  updatePlayBtn();
}
function pause() { S.playing = false; updatePlayBtn(); }
function togglePlay() { S.playing ? pause() : play(); }

function seek(t) {
  if (!S.song) return;
  S.t = Math.max(-LEAD_IN, Math.min(t, S.song.duration));
  S.playIdx = lowerBound(S.song.notes, S.t);
  S.beatIdx = lowerBound(S.song.beats, S.t);
  S.waiting = false;
  resetRun(S.t);
  audio.stopSong();
}

// Practice mode: the next group of notes (starting within 50ms of each other) to be played.
function ensureChord() {
  if (S.chord || S.waitIdx >= S.learn.length) return S.chord;
  const t0 = S.learn[S.waitIdx].time;
  const need = new Set(), idx = [];
  let j = S.waitIdx;
  while (j < S.learn.length && S.learn[j].time - t0 < 0.05) { need.add(S.learn[j].k); idx.push(j); j++; }
  S.chord = { t: t0, end: j, need, all: new Set(need), idx };
  return S.chord;
}

function advance(dt) {
  const song = S.song;
  let next = S.t + dt * S.speed;

  S.waiting = false;
  if (S.mode === 'practice') {
    let c;
    while ((c = ensureChord()) && next >= c.t) {
      if (c.need.size) { next = c.t; S.waiting = true; break; }
      S.waitIdx = c.end;
      S.chord = null;
    }
  } else if (S.mode === 'recital') {
    const tol = TOL * S.speed;
    while (S.judgeIdx < S.learn.length && S.learn[S.judgeIdx].time + tol < next) {
      if (S.state[S.judgeIdx] === 0) miss(S.judgeIdx);
      S.judgeIdx++;
    }
  }

  while (S.playIdx < song.notes.length && song.notes[S.playIdx].time < next) {
    const n = song.notes[S.playIdx++];
    const role = song.tracks[n.track].role;
    if (role === 'hear' || role === 'bg') audio.songNote(n.midi, n.dur / S.speed, role === 'bg' ? n.vel * 0.7 : n.vel);
  }

  while (S.beatIdx < song.beats.length && song.beats[S.beatIdx].time < next) {
    if (prefs.metronome && song.beats[S.beatIdx].time >= 0) audio.metronome(song.beats[S.beatIdx].accent);
    S.beatIdx++;
  }

  S.t = next;
  extendLearned(S.t);
  if (S.loopB != null && S.t >= S.loopB) seek(S.loopA);
  else if (S.t >= song.duration) finish();
}

/* ================= note feedback ================= */

// Notes you play light up and sparkle; notes you let pass (Play along) turn grey. No scores are kept.
function hit(i) {
  if (S.state[i]) return;
  S.state[i] = 1;
  if (S.learn[i].time > S.extFrom) S.extHit++;
  spark(S.learn[i].k, colorOf(S.learn[i]));
}
function miss(i) {
  S.state[i] = 2;
  if (S.learn[i].time > S.extFrom) S.extMiss++;
}
const colorOf = (n) => HAND_COLORS[S.song.tracks[n.track].hand] || HAND_COLORS.bg;

// Called when the player presses a key. Returns the colour to light that key.
function judge(m) {
  if (!S.song || S.mode === 'watch' || !S.learn.length) return FREE;
  const live = S.playing;

  if (S.mode === 'practice') {
    const c = ensureChord();
    if (c && c.t - S.t <= EARLY && c.all.has(m)) {
      if (live && c.need.has(m)) {
        c.need.delete(m);
        for (const i of c.idx) if (S.learn[i].k === m) hit(i);
      }
      return colorOf(S.learn[c.idx.find((i) => S.learn[i].k === m)]);
    }
  } else {
    const tol = TOL * S.speed;
    for (let i = lowerBound(S.learn, S.t - tol); i < S.learn.length; i++) {
      const n = S.learn[i];
      if (n.time > S.t + tol) break;
      if (n.k === m && S.state[i] === 0) { if (live) hit(i); return colorOf(n); }
    }
  }

  // Re-striking a note that is still sounding is fine, anything else lights red
  for (let i = lowerBound(S.learn, S.t - 8); i < S.learn.length; i++) {
    const n = S.learn[i];
    if (n.time > S.t + 0.05) break;
    if (n.k === m && n.time + n.dur >= S.t - 0.05) return colorOf(n);
  }
  return BAD;
}

function finish() {
  pause();
  saveSongSettings();
}

function spark(m, color) {
  if (G.x[m] == null) return;
  const cx = G.x[m] + G.kw[m] / 2;
  for (let k = 0; k < 10; k++) {
    S.sparks.push({ x: cx, y: G.rollH, vx: (Math.random() - 0.5) * 140, vy: -80 - Math.random() * 180, life: 0.5, color });
  }
}

/* ================= input: MIDI keyboard, computer keys, mouse ================= */

const sounding = new Map(); // midi -> instrument it was started on
let sustain = false;
const sustained = new Set();

// fromKeyboard: played on the MIDI keyboard (which makes its own sound when it is also the output)
function noteOn(m, vel = 0.75, fromKeyboard = false) {
  if (m < 21 || m > 108) return;
  audio.unlock();
  if (sounding.has(m)) audio.myNoteOff(sounding.get(m), m);
  sounding.set(m, audio.myNoteOn(m, vel, fromKeyboard));
  sustained.delete(m);
  lastNote = noteName(m);
  recNoteOn(m, vel);
  if (S.free) {
    const color = `hsl(${(m % 12) * 30} 72% 62%)`;
    S.trails.push({ m, t0: performance.now(), t1: 0, color });
    S.pressed.set(m, color);
  } else if (!$('#player').hidden) S.pressed.set(m, judge(m));
  else renderDevices();
}

function noteOff(m) {
  recNoteOff(m);
  S.pressed.delete(m);
  for (const tr of S.trails) if (tr.m === m && !tr.t1) tr.t1 = performance.now();
  if (sustain) { sustained.add(m); return; }
  audio.myNoteOff(sounding.get(m), m);
  sounding.delete(m);
}

function setSustain(down) {
  if (down !== sustain && rec) rec.cc.push({ time: recNow(), value: down ? 1 : 0 });
  sustain = down;
  if (!down) {
    for (const m of sustained) if (!S.pressed.has(m)) { audio.myNoteOff(sounding.get(m), m); sounding.delete(m); }
    sustained.clear();
  }
}

/* ================= recording what you play ================= */

const REC_PREFIX = 'My recording ';
let rec = null; // { t0, open: Map midi -> { time, vel }, notes: [], cc: [] }
const recNow = () => (performance.now() - rec.t0) / 1000;

function recNoteOn(m, vel) {
  if (!rec) return;
  recNoteOff(m);
  rec.open.set(m, { time: recNow(), vel });
}
function recNoteOff(m) {
  const o = rec && rec.open.get(m);
  if (!o) return;
  rec.open.delete(m);
  rec.notes.push({ midi: m, time: o.time, duration: Math.max(0.05, recNow() - o.time), velocity: o.vel });
}

function startRecording() {
  audio.unlock();
  rec = { t0: performance.now(), open: new Map(), notes: [], cc: [] };
  if (sustain) rec.cc.push({ time: 0, value: 1 });
  syncRec();
  toast('Recording. Play something, then press Stop.');
}

async function stopRecording() {
  for (const m of [...rec.open.keys()]) recNoteOff(m);
  const { notes, cc } = rec;
  rec = null;
  syncRec();
  if (!notes.length) { toast('Nothing was played, so nothing was saved'); return; }
  // Start half a second before the first note
  const shift = Math.max(0, Math.min(...notes.map((n) => n.time)) - 0.5);
  const Midi = midiClass();
  const midi = new Midi();
  midi.header.setTempo(120);
  const tr = midi.addTrack();
  tr.name = 'Piano';
  for (const n of notes) tr.addNote({ ...n, time: n.time - shift });
  for (const c of cc) tr.addCC({ number: 64, value: c.value, time: Math.max(0, c.time - shift) });
  const d = new Date(), p2 = (x) => String(x).padStart(2, '0');
  const name = `${REC_PREFIX}${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.mid`;
  const file = new File([midi.toArray()], name, { type: 'audio/midi' });
  // Lands in your songs and opens in Listen mode, so you watch and hear yourself back
  await addFiles([file], { mode: 'watch', hands: 'both' });
  if (S.entry && S.entry.id === 'u:' + name) { seek(-LEAD_IN); play(); }
  toast('Saved to your songs. Playing it back…');
}

function syncRec() {
  $$('.rec-btn').forEach((b) => {
    b.classList.toggle('recording', !!rec);
    b.lastChild.textContent = rec ? 'Stop' : 'Record';
    b.title = rec ? 'Stop recording and play it back' : 'Record what you play';
  });
  $('#saveRecBtn').hidden = !(S.entry && S.entry.id.startsWith('u:' + REC_PREFIX));
}
$$('.rec-btn').forEach((b) => { b.onclick = () => (rec ? stopRecording() : startRecording()); });

$('#saveRecBtn').onclick = async () => {
  if (!S.entry) return;
  const blob = await S.entry.file();
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = S.entry.id.slice(2);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

let midiAccess = null, midiConnected = false, lastNote = '';
function midiState() {
  const inputs = [], outputs = [];
  if (midiAccess) {
    midiAccess.inputs.forEach((i) => inputs.push({ name: i.name, manufacturer: i.manufacturer }));
    midiAccess.outputs.forEach((o) => outputs.push({ name: o.name, manufacturer: o.manufacturer }));
  }
  const out = audio.midiOutput();
  return { supported: !!navigator.requestMIDIAccess, access: !!midiAccess, connected: inputs.length > 0, inputs, outputs, output: out ? out.name : '', lastNote };
}

// Where sound plays: '' = this computer, otherwise the name of a MIDI output (e.g. "CASIO USB-MIDI")
async function setOutput(name) {
  if (name && !midiAccess) await connectMidi();
  prefs.output = name || '';
  savePrefs();
  applyOutput();
  if (name && audio.midiOutput()) toast(`Sound now plays on ${name}`);
  else if (!name) toast('Sound now plays on this computer');
}
function applyOutput() {
  let port = null;
  if (prefs.output && midiAccess) midiAccess.outputs.forEach((o) => { if (o.name === prefs.output && o.state !== 'disconnected') port = o; });
  if (port !== audio.midiOutput()) audio.setMidiOutput(port);
  renderOutputSel();
  renderDevices();
}
// Tone is remembered separately for this computer and for the keyboard
const toneKey = () => (audio.midiOutput() ? 'keyTone' : 'tone');
function setTone(id) {
  prefs[toneKey()] = id;
  savePrefs();
  audio.setTones(prefs.tone, prefs.keyTone);
  renderToneSel();
  renderDevices();
}
function renderToneSel() {
  const sel = $('#toneSel');
  const midi = !!audio.midiOutput();
  sel.innerHTML = '';
  for (const t of audio.TONES) if (midi || !t.midiOnly) sel.append(new Option(t.label, t.id));
  sel.value = prefs[toneKey()];
  $('#toneNote').hidden = !(midi && prefs.keyTone === 'keyboard');
}
function renderOutputSel() {
  renderToneSel();
  const sel = $('#outputSel');
  const m = midiState();
  sel.innerHTML = '';
  sel.append(new Option('This computer', ''));
  for (const o of m.outputs) sel.append(new Option(o.name, o.name));
  if (prefs.output && !m.outputs.some((o) => o.name === prefs.output)) sel.append(new Option(`${prefs.output} (not connected)`, prefs.output));
  if (!m.access && m.supported) sel.append(new Option('Connect a MIDI keyboard…', '__connect'));
  sel.value = prefs.output;
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { toast('This browser has no Web MIDI. Use Chrome or Edge for a MIDI keyboard.'); return; }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = hookMidi;
    hookMidi();
  } catch {
    toast('MIDI access was blocked');
  }
}
function hookMidi() {
  const names = [];
  midiAccess.inputs.forEach((inp) => { inp.onmidimessage = onMidiMessage; names.push(inp.name); });
  midiConnected = names.length > 0;
  $$('.midi-pill .led').forEach((l) => l.classList.toggle('on', midiConnected));
  $$('.midi-label').forEach((l) => { l.textContent = midiConnected ? names[0] : 'No MIDI keyboard found'; });
  updateHint();
  applyOutput();
}
function onMidiMessage(e) {
  const [status, d1, d2] = e.data;
  const cmd = status & 0xf0;
  if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127, true);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
  else if (cmd === 0xb0 && d1 === 64) setSustain(d2 >= 64);
}
if (navigator.permissions) {
  navigator.permissions.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') connectMidi(); }).catch(() => {});
}
$$('.midi-pill').forEach((b) => { b.onclick = connectMidi; });

// Computer keyboard: home row = white keys, row above = black keys
// Two rows like a real keyboard: Z X C V B N M , . / are white keys from C3 (S D G H J L ; the black keys),
// Q W E R T Y U I O P [ ] are white keys from C4 (2 3 5 6 7 9 0 the black keys). Up/Down shift octaves.
const KEYMAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, BracketRight: 31,
};
const KEYCHAR = {
  KeyZ: 'Z', KeyS: 'S', KeyX: 'X', KeyD: 'D', KeyC: 'C', KeyV: 'V', KeyG: 'G', KeyB: 'B', KeyH: 'H', KeyN: 'N', KeyJ: 'J', KeyM: 'M',
  Comma: ',', KeyL: 'L', Period: '.', Semicolon: ';', Slash: '/',
  KeyQ: 'Q', Digit2: '2', KeyW: 'W', Digit3: '3', KeyE: 'E', KeyR: 'R', Digit5: '5', KeyT: 'T', Digit6: '6', KeyY: 'Y', Digit7: '7', KeyU: 'U',
  KeyI: 'I', Digit9: '9', KeyO: 'O', Digit0: '0', KeyP: 'P', BracketLeft: '[', BracketRight: ']',
};
let kbBase = 48; // lowest note of the bottom row
let kbUsed = false; // show computer-key hints on the piano only once someone plays with them
const kbHeld = new Map();

function updateHint() {
  if (S.free) {
    $('#hint').innerHTML = `Bottom row <kbd>Z</kbd>–<kbd>/</kbd> = ${noteName(kbBase)}–${noteName(kbBase + 16)} · top row <kbd>Q</kbd>–<kbd>]</kbd> = ${noteName(kbBase + 12)}–${noteName(kbBase + 31)} · rows above are the black keys · <kbd>↑</kbd> <kbd>↓</kbd> octave · hold <kbd>Space</kbd> to sustain`;
    $('#octLabel').textContent = `${noteName(kbBase)} – ${noteName(kbBase + 31)}`;
    return;
  }
  const modeHint = {
    watch: 'Listen: sit back and watch the notes.',
    practice: 'Practice: the song waits until you play each note.',
    recital: 'Play along: play in time, the song keeps going.',
  }[S.mode];
  const keys = midiConnected ? '' : ` · Computer keys <kbd>Z</kbd>–<kbd>/</kbd> and <kbd>Q</kbd>–<kbd>]</kbd> play from ${noteName(kbBase)}, <kbd>↑</kbd> <kbd>↓</kbd> octave`;
  $('#hint').innerHTML = `${modeHint}${keys} · <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> skip · <kbd>-</kbd> <kbd>=</kbd> tempo · <kbd>Enter</kbd> review learned part · <kbd>Shift</kbd>+<kbd>Enter</kbd> continue · <kbd>K</kbd> mark learned`;
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  const typing = (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'SELECT' || tag === 'TEXTAREA';
  const inPlayer = !$('#player').hidden;

  if (e.code === 'Escape') {
    if (!$('#settings').hidden) $('#settings').hidden = true;
    else if (inPlayer) showPlayer(false);
    return;
  }
  if (typing || !inPlayer) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (S.free) setSustain(true); else if (!e.repeat) togglePlay();
    return;
  }
  if (e.target.type === 'range' && e.code.startsWith('Arrow')) return;
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); shiftOctave(e.code === 'ArrowUp' ? 1 : -1); return; }
  if (!S.free && S.song) {
    if (e.code === 'Enter' && !/BUTTON|A/.test(e.target.tagName)) { e.preventDefault(); if (e.shiftKey) continueLearning(); else startReview(); return; }
    if (e.code === 'KeyK' && !e.repeat) { markLearned(); return; }
  }
  if (e.code === 'ArrowLeft') { seek(S.t - 5); return; }
  if (e.code === 'ArrowRight') { seek(S.t + 5); return; }
  if (e.code === 'Minus' || e.code === 'Equal') {
    const i = SPEEDS.findIndex((v) => Math.abs(v - S.speed) < 0.001);
    const j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + (e.code === 'Equal' ? 1 : -1)));
    setSpeed(SPEEDS[j]);
    return;
  }
  if (e.repeat) return;
  if (e.code in KEYMAP && !kbHeld.has(e.code)) {
    const m = kbBase + KEYMAP[e.code];
    kbHeld.set(e.code, m);
    kbUsed = true;
    noteOn(m);
  }
});
window.addEventListener('keyup', (e) => {
  if (kbHeld.has(e.code)) { noteOff(kbHeld.get(e.code)); kbHeld.delete(e.code); }
  if (e.code === 'Space' && S.free) setSustain(false);
});

function shiftOctave(d) {
  kbBase = Math.max(24, Math.min(72, kbBase + d * 12));
  updateHint();
}
window.addEventListener('blur', () => { kbHeld.forEach((m) => noteOff(m)); kbHeld.clear(); });

const pointerNotes = new Map();
canvas.addEventListener('pointerdown', (e) => {
  const m = keyAt(e.offsetX, e.offsetY);
  if (m == null) return;
  canvas.setPointerCapture(e.pointerId);
  pointerNotes.set(e.pointerId, m);
  noteOn(m);
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointerNotes.has(e.pointerId)) return;
  const m = keyAt(e.offsetX, e.offsetY), prev = pointerNotes.get(e.pointerId);
  if (m == null || m === prev) return;
  noteOff(prev); noteOn(m); pointerNotes.set(e.pointerId, m);
});
const endPointer = (e) => {
  if (!pointerNotes.has(e.pointerId)) return;
  noteOff(pointerNotes.get(e.pointerId));
  pointerNotes.delete(e.pointerId);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (!S.song || e.offsetY > G.rollH) return;
  e.preventDefault();
  seek(S.t - e.deltaY * 0.004);
}, { passive: false });

/* ================= drawing ================= */

const G = { w: 0, h: 0, rollH: 0, kbH: 0, ww: 0, x: [], kw: [], whites: [] };
const MAX_WHITE = 40; // px; on wider screens the keyboard shows more octaves rather than stretching keys

function layout() {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  G.w = r.width; G.h = r.height;

  // Start from the song's octaves and add octaves either side until the keys are a natural width
  const whitesIn = (a, b) => { let n = 0; for (let m = a; m <= b; m++) if (!isBlack(m)) n++; return n; };
  let lo = S.baseLo ?? S.lo, hi = S.baseHi ?? S.hi, below = true;
  while (!fixedRange() && G.w / whitesIn(lo, hi) > MAX_WHITE && (lo > 21 || hi < 108)) {
    if ((below && lo > 21) || hi >= 108) lo = Math.max(21, lo - 12); else hi = Math.min(108, hi + 12);
    below = !below;
  }
  S.lo = lo; S.hi = hi;

  G.whites = [];
  for (let m = S.lo; m <= S.hi; m++) if (!isBlack(m)) G.whites.push(m);
  G.ww = G.w / G.whites.length;
  // Real piano keys are about 5-6 times taller than wide
  G.kbH = Math.round(Math.min(Math.max(G.ww * 5.2, 100), 240, G.h * 0.38));
  G.rollH = G.h - G.kbH;

  const bw = G.ww * 0.58;
  let wi = 0;
  G.x = []; G.kw = [];
  for (let m = S.lo; m <= S.hi; m++) {
    // Whole-pixel key edges so falling notes and lane lines sit exactly on the keys
    if (isBlack(m)) { G.x[m] = Math.round(wi * G.ww - bw / 2); G.kw[m] = Math.round(bw); }
    else { G.x[m] = Math.round(wi * G.ww); G.kw[m] = Math.round((wi + 1) * G.ww) - G.x[m]; wi++; }
  }
}
new ResizeObserver(layout).observe($('#rollwrap'));

function keyAt(x, y) {
  if (y < G.rollH || y > G.h) return null;
  if (y < G.rollH + G.kbH * 0.62) {
    for (let m = S.lo; m <= S.hi; m++) if (isBlack(m) && x >= G.x[m] && x < G.x[m] + G.kw[m]) return m;
  }
  const i = Math.floor(x / G.ww);
  return i >= 0 && i < G.whites.length ? G.whites[i] : null;
}

function rrect(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

function label(m) {
  if (prefs.labels === 'solfege') return SOLFEGE[m % 12];
  if (prefs.labels === 'octave') return noteName(m);
  return NOTE_NAMES[m % 12];
}

// Largest font (up to max) that fits text in a given width
function fitFont(txt, width, max, weight = 600) {
  for (let fs = max; fs >= 7; fs--) {
    ctx.font = `${weight} ${fs}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(txt).width <= width - 3) return fs;
  }
  return 0;
}

function draw(now, dt) {
  const { w, rollH, kbH, ww } = G;
  if (!w) return;
  ctx.clearRect(0, 0, w, G.h);

  // Lane lines at every C and F
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let m = S.lo + 1; m <= S.hi; m++) if (m % 12 === 0 || m % 12 === 5) ctx.fillRect(Math.round(G.x[m]), 0, 1, rollH);

  const active = new Map(); // midi -> hand of a note sounding now
  const pulse = 0.55 + 0.45 * Math.sin(now / 140);
  const song = S.song;
  const showLabels = prefs.labels !== 'off';

  if (song) {
    const pps = rollH / prefs.window;
    const t = S.t;
    const yOf = (time) => rollH - (time - t) * pps;

    // Bar lines with bar numbers
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    song.measures.forEach((mt, i) => {
      const y = yOf(mt);
      if (y > rollH || y < 0) return;
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(0, Math.round(y), w, 1);
      ctx.fillStyle = '#3e4656';
      ctx.fillText(String(i + 1), 14, y - 4);
    });

    // Where you've learned up to
    if (S.mode !== 'watch' && learned() > 0) {
      const y = yOf(learned());
      if (y >= 0 && y <= rollH) {
        ctx.fillStyle = 'rgba(60,207,142,0.85)';
        ctx.fillRect(0, Math.round(y) - 1, w, 2);
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Learned up to here', w - 12, y - 6);
        ctx.textAlign = 'left';
      }
    }

    // Loop markers
    ctx.fillStyle = 'rgba(79,123,255,0.7)';
    for (const lt of [S.loopA, S.loopB]) {
      if (lt == null) continue;
      const y = yOf(lt);
      if (y >= 0 && y <= rollH) ctx.fillRect(0, Math.round(y) - 1, w, 2);
    }

    // Middle C marker
    if (G.x[60] != null) {
      const x = Math.round(G.x[60]) + 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x - 0.5, 8, 1, rollH - 8);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, 8, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, rollH); ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const chord = S.mode === 'practice' ? S.chord : null;
    const nextSet = chord ? new Set(chord.idx.filter((i) => chord.need.has(S.learn[i].k)).map((i) => S.learn[i])) : null;
    const minH = showLabels ? 20 : 6;

    for (let i = lowerBound(song.notes, t - 10); i < song.notes.length; i++) {
      const n = song.notes[i];
      if (n.time > t + prefs.window + 0.1) break;
      const tr = song.tracks[n.track];
      if (tr.role === 'off' || G.x[n.k] == null) continue;
      if (n.time + n.dur < t - 0.02) continue;

      const y1 = yOf(n.time);
      const hgt = Math.max(minH, (n.time + n.dur - n.time) * pps);
      const black = isBlack(n.k);
      const inset = black ? 0.5 : Math.max(1.5, ww * 0.1);
      const x = G.x[n.k] + inset;
      const bw = G.kw[n.k] - inset * 2;
      const r = Math.min(6, bw / 2.5);
      const top = y1 - hgt;
      const [c0, c1] = HAND_GRADIENTS[tr.hand] || HAND_GRADIENTS.bg;
      const sounding = (S.waiting ? n.time < t : n.time <= t + 0.001) && n.time + n.dur > t;
      if (sounding && tr.role !== 'bg' && tr.role !== 'muted') active.set(n.k, tr.hand);

      const st = n.li >= 0 ? S.state[n.li] : 0;
      ctx.globalAlpha = tr.role === 'me' || (tr.role === 'hear' && S.mode === 'watch') ? 1 : tr.role === 'hear' ? 0.45 : tr.role === 'muted' ? 0.12 : 0.2;
      if (st === 2) ctx.fillStyle = MISSED;
      else {
        const g = ctx.createLinearGradient(0, top, 0, y1);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.fillStyle = g;
      }
      if (sounding && tr.role !== 'bg' && tr.role !== 'muted') { ctx.shadowColor = c1; ctx.shadowBlur = 22; }
      rrect(x, top, bw, hgt, r); ctx.fill();
      ctx.shadowBlur = 0;
      if (st === 1) { ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill(); }

      if (nextSet && nextSet.has(n)) {
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        rrect(x, top, bw, hgt, r); ctx.stroke();
      }

      // Every note carries its name
      if (showLabels && tr.role !== 'bg' && tr.role !== 'muted') {
        const txt = label(n.k);
        const fs = fitFont(txt, bw, 16, 700);
        if (fs) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = st === 2 ? '#8a93a4' : 'rgba(255,255,255,0.96)';
          ctx.shadowColor = 'rgba(0,0,0,0.35)';
          ctx.shadowBlur = 2;
          ctx.fillText(txt, x + bw / 2, y1 - 4);
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Notes fade in at the top
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const fade = ctx.createLinearGradient(0, 0, 0, 70);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, 70);
    ctx.restore();
  }

  // Free Play: what you play rises from the keys
  if (S.free && S.trails.length) {
    const speed = 140; // px per second
    const t = performance.now();
    S.trails = S.trails.filter((tr) => !tr.t1 || rollH - ((t - tr.t1) / 1000) * speed > -40);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, rollH); ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tr of S.trails) {
      if (G.x[tr.m] == null) continue;
      const bottom = rollH - ((t - (tr.t1 || t)) / 1000) * speed;
      const top = rollH - ((t - tr.t0) / 1000) * speed;
      const black = isBlack(tr.m);
      const inset = black ? 0.5 : Math.max(1.5, ww * 0.1);
      const x = G.x[tr.m] + inset, bw = G.kw[tr.m] - inset * 2;
      const h = Math.max(6, bottom - top);
      ctx.globalAlpha = tr.t1 ? 0.85 : 1;
      ctx.fillStyle = tr.color;
      if (!tr.t1) { ctx.shadowColor = tr.color; ctx.shadowBlur = 18; }
      rrect(x, bottom - h, bw, h, Math.min(6, bw / 2.5)); ctx.fill();
      ctx.shadowBlur = 0;
      if (prefs.labels !== 'off' && h >= 18) {
        const fs = fitFont(label(tr.m), bw, 14, 700);
        if (fs) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(10,14,21,0.85)'; ctx.fillText(label(tr.m), x + bw / 2, bottom - h + 4); }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Glow above sounding keys
  active.forEach((hand, m) => {
    const g = ctx.createLinearGradient(0, rollH - 40, 0, rollH);
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, (HAND_COLORS[hand] || HAND_COLORS.bg) + '55');
    ctx.fillStyle = g;
    ctx.fillRect(G.x[m] - 2, rollH - 40, G.kw[m] + 4, 40);
  });

  /* ----- keyboard ----- */
  const need = S.mode === 'practice' && S.waiting && S.chord ? S.chord.need : null;
  const needHand = (m) => {
    for (const i of S.chord.idx) if (S.learn[i].k === m) return song.tracks[S.learn[i].track].hand;
    return 'R';
  };
  const keyFill = (m) => {
    if (S.pressed.has(m)) return S.pressed.get(m);
    if (active.has(m)) return HAND_COLORS[active.get(m)] || HAND_COLORS.bg;
    return null;
  };
  const kbChar = {};
  if (S.free || (kbUsed && !midiConnected)) for (const code in KEYMAP) if (!kbChar[kbBase + KEYMAP[code]]) kbChar[kbBase + KEYMAP[code]] = KEYCHAR[code];

  const top = rollH + 1;
  const whiteG = ctx.createLinearGradient(0, top, 0, G.h);
  whiteG.addColorStop(0, '#e9edf3');
  whiteG.addColorStop(0.15, '#f7f9fc');
  whiteG.addColorStop(1, '#e4e8ef');
  const gloss = ctx.createLinearGradient(0, top, 0, G.h);
  gloss.addColorStop(0, 'rgba(255,255,255,0)');
  gloss.addColorStop(1, 'rgba(255,255,255,0.28)');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const m of G.whites) {
    const x = G.x[m] + 1, kw = G.kw[m] - 2;
    const fill = keyFill(m);
    ctx.fillStyle = fill || whiteG;
    rrect(x, top, kw, kbH - 3, [0, 0, 5, 5]); ctx.fill();
    if (fill) { ctx.fillStyle = gloss; ctx.fill(); }
    if (need && need.has(m) && !S.pressed.has(m)) {
      ctx.globalAlpha = pulse * 0.75; ctx.fillStyle = HAND_COLORS[needHand(m)]; ctx.fill(); ctx.globalAlpha = 1;
    }
    // Key names
    const isC = m % 12 === 0;
    const name = isC ? noteName(m) : label(m);
    if (showLabels || isC) {
      const fs = fitFont(name, kw, 15, 700);
      if (fs) {
        ctx.fillStyle = fill ? '#fff' : isC ? '#11151c' : '#3f4654';
        ctx.fillText(name, x + kw / 2, G.h - 12);
      }
    }
    if (ww >= 16 && kbChar[m]) {
      ctx.font = '500 9px ui-monospace, monospace';
      ctx.fillStyle = fill ? 'rgba(255,255,255,0.8)' : '#b4bac6';
      ctx.fillText(kbChar[m], x + kw / 2, G.h - 32);
    }
  }

  const bh = kbH * 0.62;
  const blackG = ctx.createLinearGradient(0, top, 0, top + bh);
  blackG.addColorStop(0, '#0b0e14');
  blackG.addColorStop(1, '#232a37');
  for (let m = S.lo; m <= S.hi; m++) {
    if (!isBlack(m)) continue;
    const x = G.x[m], bw = G.kw[m];
    const fill = keyFill(m);
    ctx.fillStyle = fill || blackG;
    rrect(x, top - 1, bw, bh, [0, 0, 4, 4]); ctx.fill();
    if (!fill) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 2, top + bh - 8, bw - 4, 2); }
    if (need && need.has(m) && !S.pressed.has(m)) {
      ctx.globalAlpha = pulse * 0.85; ctx.fillStyle = HAND_COLORS[needHand(m)]; rrect(x, top - 1, bw, bh, [0, 0, 4, 4]); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (showLabels) {
      const fs = fitFont(label(m), bw - 2, 12, 700);
      if (fs) {
        ctx.fillStyle = fill ? '#fff' : '#e3e7ee';
        ctx.fillText(label(m), x + bw / 2, top + bh - 8);
      }
    }
    if (ww >= 16 && kbChar[m]) {
      ctx.font = '500 9px ui-monospace, monospace';
      ctx.fillStyle = '#6b7385';
      ctx.fillText(kbChar[m], x + bw / 2, top + bh - 26);
    }
  }

  // Shadow where the notes meet the keys
  const sh = ctx.createLinearGradient(0, top, 0, top + 10);
  sh.addColorStop(0, 'rgba(0,0,0,0.35)');
  sh.addColorStop(1, 'transparent');
  ctx.fillStyle = sh;
  ctx.fillRect(0, top, w, 10);

  // Hit sparks
  if (S.sparks.length) {
    S.sparks = S.sparks.filter((p) => (p.life -= dt) > 0);
    for (const p of S.sparks) {
      p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, p.life / 0.5);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ================= UI ================= */

function openFreePlay() {
  stopPreview();
  pause();
  audio.stopSong();
  S.free = true;
  S.song = null;
  S.entry = null;
  S.trails = [];
  const r = fixedRange();
  S.baseLo = r ? r[0] : 36; S.baseHi = r ? r[1] : 96;
  $('#player').classList.add('free');
  $('#songTitle').textContent = 'Free Play';
  updateHint();
  showPlayer(true);
  if (location.hash !== '#/free') location.hash = '#/free';
}

let lastLibraryHash = '#/library';
function showPlayer(show) {
  if (show && !S.song && !S.free) return;
  if (!show) {
    pause();
    if (S.song && !S.free) saveSongSettings();
    $('#settings').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen();
    if (location.hash.startsWith('#/play/') || location.hash === '#/free') location.hash = lastLibraryHash;
    if (S.free) { S.free = false; setSustain(false); $('#player').classList.remove('free'); }
    renderLibrary();
  }
  $('#player').hidden = !show;
  $('#library').hidden = show;
  if (show) requestAnimationFrame(layout);
}

// #/play/<song id> opens the player; anything else is a library page (back/forward work)
function onHash() {
  const h = location.hash;
  if (h === '#/free') { if (!S.free || $('#player').hidden) openFreePlay(); return; }
  if (h.startsWith('#/play/')) {
    const id = decodeURIComponent(h.slice(7));
    if ($('#player').hidden || !S.entry || S.entry.id !== id) {
      const e = entryById(id);
      if (e) openEntry(e); else location.hash = lastLibraryHash;
    }
  } else {
    lastLibraryHash = h || '#/library';
    if (!$('#player').hidden) showPlayer(false);
  }
}
window.addEventListener('hashchange', onHash);

/* ----- previews: the first 30 seconds of a song, played from the library ----- */
let preview = null;
const previewId = () => (preview ? preview.id : null);
const previewProgress = () => (preview && preview.t0 ? { id: preview.id, pos: Math.max(0, audio.now() - preview.t0), len: preview.len } : null);
async function togglePreview(entry) {
  if (preview && preview.id === entry.id) { stopPreview(); return; }
  stopPreview();
  audio.unlock();
  const me = (preview = { id: entry.id, timer: 0 });
  refreshPreview();
  try {
    const song = parseMidi(await (await entry.file()).arrayBuffer(), { id: entry.id, title: entry.title });
    if (preview !== me) return;
    const first = song.notes.length ? song.notes[0].time : 0;
    const notes = song.notes.filter((n) => n.time < first + 30);
    const start = audio.now() + 0.15 - first;
    me.t0 = start + first;
    let i = 0;
    const end = notes.reduce((x, n) => Math.max(x, n.time + Math.min(n.dur, 2)), 0);
    me.len = Math.max(1, end - first);
    refreshPreview();
    const pump = () => {
      const t = audio.now();
      while (i < notes.length && start + notes[i].time < t + 0.4) {
        const n = notes[i++];
        audio.songNote(n.midi, Math.min(n.dur, 2), n.vel * 0.85, start + n.time);
      }
      if (i >= notes.length && t > start + end) stopPreview();
    };
    pump();
    me.timer = setInterval(pump, 100);
  } catch {
    stopPreview();
    toast("Couldn't play a preview of that song");
  }
}
function stopPreview() {
  if (!preview) return;
  clearInterval(preview.timer);
  preview = null;
  audio.stopSong();
  refreshPreview();
}

const PLAY_PATH = 'M7 4v16l13-8z', PAUSE_PATH = 'M6 4h4v16H6zM14 4h4v16h-4z';
function updatePlayBtn() { $('#playIcon').innerHTML = `<path d="${S.playing ? PAUSE_PATH : PLAY_PATH}"/>`; }

function syncSegs() {
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
  $$('#handsSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === S.hands);
    b.disabled = S.song && b.dataset.v !== 'both' && !S.song.tracks.some((t) => t.hand === b.dataset.v);
  });
  const other = $('#otherHandBtn');
  other.hidden = S.hands === 'both' || S.mode === 'watch';
  other.textContent = `Other hand: ${prefs.otherHand ? 'on' : 'off'}`;
  other.classList.toggle('on', prefs.otherHand);
  $('#sheetBtn').classList.toggle('on', prefs.sheet);
  $('#metroBtn').classList.toggle('on', prefs.metronome);
  updateHint();
}

$$('#modeSeg button').forEach((b) => {
  b.onclick = () => { S.mode = b.dataset.v; applyRoles(); seek(S.t); syncSegs(); saveSongSettings(); };
});
$$('#handsSeg button').forEach((b) => {
  b.onclick = () => {
    S.hands = b.dataset.v;
    if (S.review) { S.review = false; S.loopA = S.loopB = null; updateLoopUI(); }
    applyRoles(); seek(S.t); syncSegs(); saveSongSettings(); renderLearned();
  };
});
$('#otherHandBtn').onclick = () => { prefs.otherHand = !prefs.otherHand; savePrefs(); applyRoles(); seek(S.t); syncSegs(); };

function renderTracks() {
  const box = $('#trackList');
  box.innerHTML = '';
  S.song.tracks.forEach((t) => {
    const row = el('div', 'track');
    const dot = el('span', 'dot');
    dot.style.background = HAND_COLORS[t.hand] || '#444';
    const info = el('div', 'track-info');
    info.append(el('div', 'track-name', t.name), el('div', 'track-sub', `${t.count} notes`));
    const sel = el('select');
    for (const h of ['R', 'L', 'bg', 'off']) sel.append(new Option(HAND_NAMES[h], h));
    sel.value = t.hand;
    sel.onchange = () => {
      t.hand = sel.value;
      if (S.hands !== 'both' && !S.song.tracks.some((x) => x.hand === S.hands)) S.hands = 'both';
      fitRange();
      applyRoles();
      seek(S.t);
      if (prefs.sheet) sheet.render(S.song);
      renderTracks();
      syncSegs();
      saveSongSettings();
    };
    row.append(dot, info, sel);
    box.append(row);
  });
}

function updateLoopUI() {
  const btn = $('#loopBtn'), band = $('#loopBand');
  const dur = S.song ? S.song.duration : 1;
  if (S.loopA == null) { btn.textContent = 'Loop A–B'; btn.classList.remove('active'); band.style.display = 'none'; return; }
  btn.classList.add('active');
  const a = Math.max(0, S.loopA) / dur * 100;
  band.style.display = 'block';
  band.style.left = a + '%';
  if (S.loopB == null) { btn.textContent = 'Set end (B)'; band.style.width = '0'; }
  else { btn.textContent = 'Clear loop'; band.style.width = ((S.loopB - Math.max(0, S.loopA)) / dur * 100) + '%'; }
}

$('#loopBtn').onclick = () => {
  if (!S.song) return;
  if (S.review) { stopReview(); return; }
  if (S.loopA == null) S.loopA = Math.max(0, S.t);
  else if (S.loopB == null) {
    if (S.t <= S.loopA + 0.25) { toast('Play or skip past point A first'); return; }
    S.loopB = S.t;
    S.loopA = Math.max(-LEAD_IN, S.loopA - 0.5); // short run-up into the loop
    seek(S.loopA);
  } else { S.loopA = S.loopB = null; seek(S.t); }
  updateLoopUI();
};

$('#playBtn').onclick = togglePlay;
$('#restartBtn').onclick = () => seek(S.loopA ?? -LEAD_IN);
$('#backBtn').onclick = () => showPlayer(false);
$('#songPick').onclick = () => showPlayer(false);
$('#reviewBtn').onclick = startReview;
$('#continueBtn').onclick = continueLearning;
$('#markBtn').onclick = markLearned;
$('#resetLearned').onclick = () => { if (S.song) { setLearned(0, true); toast('Learned part cleared for this hand choice'); } };
window.addEventListener('beforeunload', () => { if (S.song && !S.free) saveSongSettings(); });
$('#octDown').onclick = () => shiftOctave(-1);
$('#octUp').onclick = () => shiftOctave(1);
$('#sustainBtn').addEventListener('pointerdown', () => setSustain(true));
$('#sustainBtn').addEventListener('pointerup', () => setSustain(false));
$('#sustainBtn').addEventListener('pointerleave', () => setSustain(false));
$('#clearTrails').onclick = () => { S.trails = []; };
const playNext = () => { const e = S.entry && nextEntry(S.entry.id); if (e) openEntry(e); };
$('#nextBtn').onclick = playNext;
$('#fsBtn').onclick = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); };

const seekEl = $('#seek');
let scrubbing = false;
seekEl.addEventListener('pointerdown', () => { scrubbing = true; });
seekEl.addEventListener('pointerup', () => { scrubbing = false; });
seekEl.addEventListener('change', () => { scrubbing = false; });
seekEl.addEventListener('input', () => seek(parseFloat(seekEl.value)));

function updateBpm() {
  const bpm = S.song ? S.song.bpm : 120;
  $('#bpmVal').textContent = `${Math.round(bpm * S.speed)} BPM`;
  $('#bpmBtn').title = `Tempo: ${Math.round(S.speed * 100)}% of the original ${bpm} BPM`;
}
function setSpeed(v) {
  S.speed = v;
  updateBpm();
  saveSongSettings();
}
$('#bpmBtn').onclick = (e) => {
  e.stopPropagation();
  const menu = $('#bpmMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = '';
  const bpm = S.song ? S.song.bpm : 120;
  for (const v of SPEEDS.slice().reverse()) {
    const b = el('button', Math.abs(v - S.speed) < 0.001 ? 'on' : '');
    b.append(`${Math.round(bpm * v)} BPM`, el('em', '', v === 1 ? 'original' : `${Math.round(v * 100)}%`));
    b.onclick = () => { setSpeed(v); menu.hidden = true; };
    menu.append(b);
  }
  menu.hidden = false;
};
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) $('#bpmMenu').hidden = true; });

$('#sheetBtn').onclick = () => {
  prefs.sheet = !prefs.sheet;
  savePrefs();
  $('#sheet').hidden = !prefs.sheet;
  if (prefs.sheet && S.song) sheet.render(S.song);
  syncSegs();
};
$('#metroBtn').onclick = () => { prefs.metronome = !prefs.metronome; savePrefs(); syncSegs(); };
$('#settingsBtn').onclick = () => { $('#settings').hidden = !$('#settings').hidden; };
$('#closeSettings').onclick = () => { $('#settings').hidden = true; };

$('#labelsSel').value = prefs.labels;
$('#labelsSel').onchange = (e) => { prefs.labels = e.target.value; savePrefs(); };
$('#windowSel').value = String(prefs.window);
$('#windowSel').onchange = (e) => { prefs.window = parseFloat(e.target.value); savePrefs(); };
$('#rangeSel').value = prefs.range;
$('#rangeSel').onchange = (e) => setKeyboardSize(e.target.value);
$('#songVol').value = prefs.songVol;
$('#myVol').value = prefs.myVol;
const applyVolumes = () => audio.setVolumes(prefs.songVol, prefs.myVol);
$('#songVol').oninput = (e) => { prefs.songVol = parseFloat(e.target.value); applyVolumes(); savePrefs(); };
$('#myVol').oninput = (e) => { prefs.myVol = parseFloat(e.target.value); applyVolumes(); savePrefs(); };

// Drag & drop MIDI files anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').classList.add('show'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.remove('show'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').classList.remove('show');
  if (e.dataTransfer.files.length) { audio.unlock(); addFiles(e.dataTransfer.files); }
});

/* ================= main loop ================= */

let last = performance.now(), lastTimeText = '', wasWaiting = false;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!$('#player').hidden) {
    if (S.song && S.playing) advance(dt);
    draw(now, dt);
    if (S.song) {
      const txt = fmt(S.t);
      if (txt !== lastTimeText) { $('#curTime').textContent = txt; lastTimeText = txt; }
      if (!scrubbing) seekEl.value = Math.max(0, S.t);
      if (prefs.sheet) sheet.update(S.t);
    }
    const waiting = S.playing && S.waiting;
    if (waiting !== wasWaiting) { $('#waiting').classList.toggle('show', waiting); wasWaiting = waiting; }
  }
  requestAnimationFrame(frame);
}

/* ================= start ================= */

audio.setTones(prefs.tone, prefs.keyTone);
audio.init();
applyVolumes();
$('#sheet').hidden = !prefs.sheet;
if (!window.Midi) toast("Couldn't load the MIDI reader. Check your internet connection.");
updateHint();
$('#toneSel').onchange = (e) => { audio.unlock(); setTone(e.target.value); };
$('#outputSel').onchange = (e) => { const v = e.target.value; if (v === '__connect') { connectMidi(); renderOutputSel(); } else setOutput(v); };
renderOutputSel();

initLibrary({ onOpen: openEntry, onPreview: togglePreview, previewId, previewProgress, connectMidi, midiState, setOutput, setKeyboardSize, keyboardSize: () => prefs.range, tones: () => ({ list: audio.TONES, current: prefs[toneKey()] }), setTone })
  .then(() => { initMonetize({ personalEdition: hasCollection() }); onHash(); });
requestAnimationFrame(frame);

// Handy for debugging in the console
window.keys = { S, seek, play, pause, noteOn, noteOff, openEntry };
