// Turns a MIDI file into the song model the player uses, and guesses which track is which hand.

export const HAND_COLORS = { R: '#34d399', L: '#4f7bff', bg: '#7d8590' };
// Note gradients, top to bottom
export const HAND_GRADIENTS = { R: ['#1fb985', '#4be8b4'], L: ['#3157e8', '#6a7dff'], bg: ['#4a5160', '#5d6575'] };
export const HAND_NAMES = { R: 'Right hand', L: 'Left hand', bg: 'Background', off: 'Hidden' };

const RIGHT = /\b(right|r\.?h\.?|treble|upper)\b/i;
const LEFT = /\b(left|l\.?h\.?|lower)\b/i;
const PIANO = /piano|keys|klavier|pno/i;

const clean = (s) => {
  s = (s || '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};

export function midiClass() {
  return window.Midi && (window.Midi.Midi || window.Midi);
}

export function parseMidi(buf, { id, title }) {
  const Midi = midiClass();
  if (!Midi) throw new Error('MIDI reader failed to load');
  const midi = new Midi(buf);
  const h = midi.header;

  const tracks = midi.tracks
    .filter((t) => t.notes.length && t.channel !== 9 && !(t.instrument && t.instrument.percussion))
    .map((t, i) => ({
      name: clean(t.name) || clean(t.instrument && t.instrument.name) || `Track ${i + 1}`,
      family: (t.instrument && t.instrument.family) || '',
      notes: t.notes.map((n) => ({ midi: n.midi, time: n.time, dur: n.duration, vel: n.velocity, tick: n.ticks, durTick: n.durationTicks })),
    }));

  let ts = h.timeSignatures[0] && h.timeSignatures[0].timeSignature;
  if (!ts || !(ts[0] > 0) || !(ts[1] > 0)) ts = [4, 4];
  const ks = h.keySignatures[0];

  return buildSong({
    id,
    title: title || clean(h.name) || 'Untitled',
    tracks,
    ppq: h.ppq,
    ts,
    key: ks ? { key: ks.key, scale: ks.scale } : null,
    bpm: h.tempos.length ? Math.round(h.tempos[0].bpm) : 120,
    tickToSec: (tk) => h.ticksToSeconds(tk),
  });
}

// Quick stats for the library list without building the whole song.
export function quickInfo(buf) {
  const midi = new (midiClass())(buf);
  let notes = 0, end = 0;
  for (const t of midi.tracks) {
    if (t.channel === 9) continue;
    notes += t.notes.length;
    for (const n of t.notes) end = Math.max(end, n.time + n.duration);
  }
  const nps = end ? notes / end : 0;
  const diff = nps < 2 ? 1 : nps < 4 ? 2 : nps < 7 ? 3 : nps < 11 ? 4 : 5;
  return { dur: end, notes, diff };
}

export function buildSong({ id, title, tracks, ppq, ts, key, bpm, tickToSec }) {
  tracks = assignHands(tracks.filter((t) => t.notes.length));

  const notes = [];
  tracks.forEach((t, ti) => {
    t.count = t.notes.length;
    for (const n of t.notes) { n.track = ti; notes.push(n); }
  });
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);

  let duration = 0, endTick = 0;
  for (const n of notes) { duration = Math.max(duration, n.time + n.dur); endTick = Math.max(endTick, n.tick + n.durTick); }

  const perMeasure = ppq * 4 * ts[0] / ts[1];
  const measureTicks = [0];
  while (measureTicks[measureTicks.length - 1] < endTick && measureTicks.length < 4000) measureTicks.push(measureTicks.length * perMeasure);
  if (measureTicks.length < 2) measureTicks.push(perMeasure);

  const beatTicks = ppq * 4 / ts[1];
  const lastTick = measureTicks[measureTicks.length - 1];
  const beats = [];
  for (let k = 0; k * beatTicks <= lastTick; k++) beats.push({ time: tickToSec(k * beatTicks), accent: k % ts[0] === 0 });

  return {
    id, title, tracks, notes, duration, ppq, ts, key, bpm: bpm || 120, tickToSec,
    measureTicks, measures: measureTicks.map(tickToSec), beats,
  };
}

// Guess hands the way a teacher would: named tracks first, then the piano part(s).
function assignHands(tracks) {
  tracks.forEach((t) => { t.hand = 'bg'; });

  const r = tracks.find((t) => RIGHT.test(t.name));
  const l = tracks.find((t) => LEFT.test(t.name));
  if (r && l && r !== l) { r.hand = 'R'; l.hand = 'L'; return tracks; }

  let cands = tracks.filter((t) => t.family === 'piano' || PIANO.test(t.name));
  if (!cands.length) cands = tracks.slice();

  if (cands.length === 1) {
    // One part holds both hands: split it at middle C.
    const t = cands[0];
    const base = tracks.length > 1 ? t.name + ' · ' : '';
    const hi = { name: base + 'Right hand', family: t.family, hand: 'R', notes: t.notes.filter((n) => n.midi >= 60) };
    const lo = { name: base + 'Left hand', family: t.family, hand: 'L', notes: t.notes.filter((n) => n.midi < 60) };
    const i = tracks.indexOf(t);
    tracks.splice(i, 1, ...[hi, lo].filter((x) => x.notes.length));
    return tracks;
  }

  const avg = (t) => t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length;
  const [a, b] = cands.slice().sort((x, y) => y.notes.length - x.notes.length);
  if (avg(a) >= avg(b)) { a.hand = 'R'; b.hand = 'L'; } else { a.hand = 'L'; b.hand = 'R'; }
  return tracks;
}
