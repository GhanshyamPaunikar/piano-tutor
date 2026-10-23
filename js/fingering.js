// Suggested fingering (1 = thumb … 5 = little finger) for one hand's notes.
// Each chord picks fingers in pitch order; a dynamic program keeps the hand still where it can,
// so a scale goes thumb-under rather than shifting on every note. A hint, not a teacher.

const WHITE = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6]; // semitone -> white-key steps (black keys sit between)
const pos = (m) => Math.floor(m / 12) * 7 + WHITE[m % 12];
const black = (m) => WHITE[m % 12] % 1 !== 0;

// Every way to give k notes (low to high) k different fingers in hand order
function choices(k, right) {
  const out = [];
  const pick = (from, left, acc) => {
    if (!left) { out.push(right ? acc : acc.slice().reverse()); return; }
    for (let f = from; f <= 6 - left; f++) pick(f + 1, left - 1, [...acc, f]);
  };
  pick(1, k, []);
  return out;
}

// notes: one hand's notes sorted by time. hand: 'R' | 'L'. Sets n.finger on each.
export function fingerHand(notes, hand) {
  const right = hand !== 'L';
  // Chords: notes starting within 30ms of each other, at most five of them get a finger
  const events = [];
  for (const n of notes) {
    const last = events[events.length - 1];
    if (last && n.time - last.time < 0.03) last.notes.push(n);
    else events.push({ time: n.time, end: n.time + n.dur, notes: [n] });
    events[events.length - 1].end = Math.max(events[events.length - 1].end, n.time + n.dur);
  }
  for (const n of notes) n.finger = 0;
  if (!events.length) return;

  let prev = null; // [{ fs, hand position, cost, back }]
  const table = [];
  for (const ev of events) {
    const ns = ev.notes.slice().sort((a, b) => a.midi - b.midi);
    const play = ns.length > 5 ? [...ns.slice(0, 2), ...ns.slice(-3)] : ns;
    ev.play = play;
    const opts = choices(play.length, right).map((fs) => {
      // Where the thumb would sit for each finger; the hand's position is their average
      const at = play.map((n, i) => pos(n.midi) - (right ? fs[i] - 1 : 5 - fs[i]));
      const p = at.reduce((s, x) => s + x, 0) / at.length;
      let own = at.reduce((s, x) => s + (x - p) ** 2, 0) * 0.6; // stretching inside the chord
      play.forEach((n, i) => { if (black(n.midi)) own += fs[i] === 1 ? 1.5 : fs[i] === 5 ? 0.8 : 0; });
      return { fs, p, own };
    });
    const gap = prev ? ev.time - table[table.length - 1].end : 0;
    const move = gap > 1 ? 0.3 : 1; // after a rest the hand can move freely
    const row = opts.map((o) => {
      if (!prev) return { ...o, cost: o.own + Math.abs(o.fs[0] - 2) * 0.2, back: -1 };
      let best = Infinity, back = 0;
      prev.forEach((q, j) => {
        const d = Math.abs(o.p - q.p);
        let c = q.cost + o.own + (d > 0.25 ? (1 + d) * move : 0);
        // The same finger on a different key straight after is awkward
        if (o.fs.length === 1 && q.fs.length === 1 && o.fs[0] === q.fs[0] && table[table.length - 1].play[0].midi !== ev.play[0].midi) c += 2 * move;
        if (c < best) { best = c; back = j; }
      });
      return { ...o, cost: best, back };
    });
    table.push({ end: ev.end, play, row });
    prev = row;
  }

  let k = table[table.length - 1].row.reduce((b, o, i, r) => (o.cost < r[b].cost ? i : b), 0);
  for (let e = table.length - 1; e >= 0; e--) {
    const o = table[e].row[k];
    table[e].play.forEach((n, i) => { n.finger = o.fs[i]; });
    k = o.back;
  }
}

export function fingerSong(song) {
  song.tracks.forEach((t, ti) => {
    const notes = song.notes.filter((n) => n.track === ti);
    if (t.hand === 'R' || t.hand === 'L') fingerHand(notes, t.hand);
    else for (const n of notes) n.finger = 0;
  });
}
