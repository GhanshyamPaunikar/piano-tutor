// Scrolling grand-staff sheet music generated from the MIDI notes (right hand on top, left hand below).
// MIDI has no notation, so notes are quantised to sixteenths and each hand is drawn as a single voice.
import { lowerBound } from './util.js';

const DUR = [[16, 'w'], [12, 'hd'], [8, 'h'], [6, 'qd'], [4, 'q'], [3, '8d'], [2, '8'], [1, '16']];
const SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const FLAT = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);
const VALID_KEYS = new Set(['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm']);

const split16 = (n) => {
  const out = [];
  for (const [v, d] of DUR) while (n >= v) { out.push([v, d]); n -= v; }
  return out;
};

function keySpecOf(key) {
  if (!key) return 'C';
  const spec = key.key + (key.scale === 'minor' ? 'm' : '');
  return VALID_KEYS.has(spec) ? spec : 'C';
}

export function createSheet(wrap, strip) {
  let anchors = [], items = [], lit = [], renderedFor = null;

  function render(song) {
    const sig = song.id + '|' + song.tracks.map((t) => t.hand).join(',');
    if (sig === renderedFor) return;
    renderedFor = sig;
    strip.innerHTML = '';
    anchors = []; items = []; lit = [];

    const F = window.Vex && Vex.Flow;
    if (!F) { strip.textContent = 'Sheet music could not load.'; return; }

    const q = song.ppq / 4; // ticks per sixteenth
    const [tsN, tsD] = song.ts;
    const m16 = Math.max(1, Math.round(tsN * 16 / tsD));
    const keySpec = keySpecOf(song.key);
    const names = FLAT_KEYS.has(keySpec) ? FLAT : SHARP;
    const nM = song.measureTicks.length - 1;

    const byMeasure = { R: Array.from({ length: nM }, () => []), L: Array.from({ length: nM }, () => []) };
    for (const n of song.notes) {
      const hand = song.tracks[n.track].hand;
      if (hand !== 'R' && hand !== 'L') continue;
      const mi = Math.floor(Math.round(n.tick / q) / m16);
      if (mi >= 0 && mi < nM) byMeasure[hand][mi].push(n);
    }

    const renderer = new F.Renderer(strip, F.Renderer.Backends.SVG);
    const ctx = renderer.getContext();
    const toSec = (s16) => song.tickToSec(s16 * q);

    let x = 10;
    for (let mi = 0; mi < nM; mi++) {
      const top = new F.Stave(x, 6, 100);
      const bot = new F.Stave(x, 92, 100);
      if (mi === 0) {
        top.addClef('treble').addKeySignature(keySpec).addTimeSignature(`${tsN}/${tsD}`);
        bot.addClef('bass').addKeySignature(keySpec).addTimeSignature(`${tsN}/${tsD}`);
      }

      let parts;
      try {
        parts = [buildVoice(F, byMeasure.R[mi], mi, 'treble'), buildVoice(F, byMeasure.L[mi], mi, 'bass')];
        F.Accidental.applyAccidentals(parts.map((p) => p.voice), keySpec);
      } catch (e) {
        parts = [buildVoice(F, [], mi, 'treble'), buildVoice(F, [], mi, 'bass')];
      }
      parts[0].voice.setStave(top);
      parts[1].voice.setStave(bot);

      const voices = parts.map((p) => p.voice);
      const formatter = new F.Formatter().joinVoices([voices[0]]).joinVoices([voices[1]]);
      const minW = formatter.preCalculateMinTotalWidth(voices);
      const noteW = Math.max(minW * 1.5 + 16, m16 * 8, 70);
      const pad = top.getNoteStartX() - top.getX();
      const w = pad + noteW + 8;
      top.setWidth(w); bot.setWidth(w);

      top.setContext(ctx).draw();
      bot.setContext(ctx).draw();
      if (mi === 0) {
        new F.StaveConnector(top, bot).setType('brace').setContext(ctx).draw();
        new F.StaveConnector(top, bot).setType('singleLeft').setContext(ctx).draw();
      }
      new F.StaveConnector(top, bot).setType('singleRight').setContext(ctx).draw();

      formatter.format(voices, noteW);
      parts[0].voice.draw(ctx, top);
      parts[1].voice.draw(ctx, bot);
      for (const p of parts) {
        p.beams.forEach((b) => b.setContext(ctx).draw());
        p.ties.forEach((t) => t.setContext(ctx).draw());
        for (const r of p.recs) {
          const t0 = toSec(r.s);
          anchors.push({ t: t0, x: r.note.getAbsoluteX() });
          if (!r.rest) {
            const el = (r.note.getSVGElement && r.note.getSVGElement()) || (r.note.attrs && r.note.attrs.el);
            items.push({ time: t0, t1: toSec(r.s + r.len), el });
          }
        }
      }
      x += w;
      anchors.push({ t: toSec((mi + 1) * m16), x: x - 4 });
    }

    renderer.resize(x + 600, 190);
    anchors.sort((a, b) => a.t - b.t || a.x - b.x);
    items.sort((a, b) => a.time - b.time);

    function buildVoice(F, notes, mi, clef) {
      const start = mi * m16;
      const groups = new Map();
      for (const n of notes) {
        const pos = Math.min(m16 - 1, Math.max(0, Math.round(n.tick / q) - start));
        const len = Math.max(1, Math.round(n.durTick / q));
        let g = groups.get(pos);
        if (!g) groups.set(pos, (g = { mids: new Set(), len: 0 }));
        g.mids.add(n.midi);
        g.len = Math.max(g.len, len);
      }
      const positions = [...groups.keys()].sort((a, b) => a - b);
      const ticks = [], ties = [], recs = [];
      const restKey = clef === 'treble' ? 'b/4' : 'd/3';
      const dot = (sn, d) => { if (d.includes('d')) F.Dot.buildAndAttach([sn], { all: true }); };

      const addRest = (from, len) => {
        let p = from;
        for (const [v, d] of split16(len)) {
          const r = new F.StaveNote({ clef, keys: [restKey], duration: d + 'r' });
          dot(r, d);
          ticks.push(r);
          recs.push({ note: r, s: start + p, len: v, rest: true });
          p += v;
        }
      };

      let cur = 0;
      positions.forEach((pos, i) => {
        if (pos > cur) addRest(cur, pos - cur);
        const next = i + 1 < positions.length ? positions[i + 1] : m16;
        const g = groups.get(pos);
        const len = Math.min(g.len, next - pos);
        const keys = [...g.mids].sort((a, b) => a - b).map((m) => names[m % 12] + '/' + (Math.floor(m / 12) - 1));
        const idx = keys.map((_, k) => k);
        let prev = null, p = pos;
        for (const [v, d] of split16(len)) {
          const sn = new F.StaveNote({ clef, keys, duration: d, auto_stem: true });
          dot(sn, d);
          ticks.push(sn);
          recs.push({ note: sn, s: start + p, len: v, rest: false });
          if (prev) ties.push(new F.StaveTie({ first_note: prev, last_note: sn, first_indices: idx, last_indices: idx }));
          prev = sn;
          p += v;
        }
        cur = pos + len;
      });
      if (cur < m16) addRest(cur, m16 - cur);

      const voice = new F.Voice({ num_beats: tsN, beat_value: tsD }).setMode(F.Voice.Mode.SOFT);
      voice.addTickables(ticks);
      const beams = F.Beam.generateBeams(ticks);
      return { voice, beams, ties, recs };
    }
  }

  function update(t) {
    if (!anchors.length) return;
    let x;
    if (t <= anchors[0].t) x = anchors[0].x - (anchors[0].t - t) * 60;
    else {
      let lo = 0, hi = anchors.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (anchors[mid].t <= t) lo = mid; else hi = mid - 1; }
      const a = anchors[lo], b = anchors[lo + 1];
      x = b ? a.x + (b.x - a.x) * (t - a.t) / Math.max(1e-6, b.t - a.t) : a.x;
    }
    strip.style.transform = `translate3d(${Math.round(wrap.clientWidth * 0.28 - x)}px,0,0)`;

    const now = [];
    for (let i = lowerBound(items, t - 8); i < items.length && items[i].time <= t; i++) {
      if (items[i].t1 > t) now.push(items[i]);
    }
    for (const it of lit) if (!now.includes(it) && it.el) it.el.classList.remove('now');
    for (const it of now) if (it.el) it.el.classList.add('now');
    lit = now;
  }

  return { render, update, reset: () => { renderedFor = null; } };
}
