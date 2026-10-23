// Piano sound. The song and the player get separate volume controls; both share one set of samples.
import { noteName } from './util.js';

let songPiano = null, myPiano = null, songSynth = null, mySynth = null, click = null;
let songVol = null, myVol = null, ready = false;
let songTone = null, myTone = null; // synths for the non-piano tones on this computer

// Tones to play with. gm is the General MIDI program sent to a keyboard; 'keyboard' sends none,
// so the keyboard plays whatever tone is picked on its own panel.
export const TONES = [
  { id: 'keyboard', label: "Keyboard's own tone", midiOnly: true },
  { id: 'piano', label: 'Grand piano', gm: 0 },
  { id: 'epiano', label: 'Electric piano', gm: 4 },
  { id: 'organ', label: 'Organ', gm: 16 },
  { id: 'strings', label: 'Strings', gm: 48 },
  { id: 'synth', label: 'Synth', gm: 81 },
  { id: 'musicbox', label: 'Music box', gm: 10 },
];
let computerTone = 'piano', keyboardTone = 'keyboard';

// Optional MIDI output: when set, sound goes to the keyboard's own speakers instead of the computer.
let midiOut = null;
let songGain = 0.8, myGain = 0.9;
const SONG_CH = 0, DRUM_CH = 9;
let MY_CH = 1; // the keyboard's own tone lives on channel 1, so notes go there too in that mode
const msToTone = (t) => (t === undefined ? performance.now() : performance.now() + Math.max(0, (t - Tone.now()) * 1000));
const v127 = (vel, gain) => Math.max(1, Math.min(127, Math.round(vel * gain * 127)));

export function setMidiOutput(port) {
  if (midiOut) allNotesOff();
  midiOut = port || null;
  sendProgram();
}
export const midiOutput = () => midiOut;

function sendProgram() {
  const t = TONES.find((x) => x.id === keyboardTone);
  MY_CH = t && t.gm === undefined ? SONG_CH : 1;
  if (!midiOut || !t || t.gm === undefined) return;
  midiOut.send([0xc0 | SONG_CH, t.gm]);
  midiOut.send([0xc0 | 1, t.gm]);
}

// computer: tone for this computer's speakers; keyboard: tone sent to a MIDI keyboard
export function setTones(computer, keyboard) {
  if (keyboard !== keyboardTone) {
    if (midiOut) allNotesOff();
    keyboardTone = keyboard;
    sendProgram();
  }
  if (computer === 'keyboard' || !TONES.some((t) => t.id === computer)) computer = 'piano';
  if (computer === computerTone && (songTone || computer === 'piano')) return;
  computerTone = computer;
  if (!songVol) return;
  for (const v of [songTone, myTone]) if (v) { v.releaseAll(); setTimeout(() => v.dispose(), 3000); }
  songTone = toneSynth(computer, songVol);
  myTone = toneSynth(computer, myVol);
}

function toneSynth(id, out) {
  const P = {
    epiano: [Tone.FMSynth, { harmonicity: 3, modulationIndex: 8, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
      envelope: { attack: 0.002, decay: 1.6, sustain: 0.15, release: 0.9 }, modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.4 } }, -12],
    organ: [Tone.Synth, { oscillator: { type: 'custom', partials: [1, 0.7, 0.5, 0, 0.35, 0, 0, 0.25] },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08 } }, -18],
    strings: [Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
      envelope: { attack: 0.18, decay: 0.3, sustain: 0.8, release: 1.2 } }, -22, 2400],
    synth: [Tone.Synth, { oscillator: { type: 'fatsquare', count: 2, spread: 12 },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.4 } }, -22, 3200],
    musicbox: [Tone.Synth, { oscillator: { type: 'custom', partials: [1, 0, 0.3, 0, 0.12] },
      envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 1.2 } }, -10],
  }[id];
  if (!P) return null;
  const [voice, opts, db, cutoff] = P;
  const s = new Tone.PolySynth(voice, opts);
  s.volume.value = db;
  if (cutoff) s.chain(new Tone.Filter(cutoff, 'lowpass'), out);
  else s.connect(out);
  return s;
}

function allNotesOff() {
  if (!midiOut) return;
  for (const ch of [SONG_CH, 1, DRUM_CH]) {
    midiOut.send([0xb0 | ch, 123, 0]); // all notes off
    midiOut.send([0xb0 | ch, 64, 0]);  // sustain off
  }
}

export function init() {
  if (!window.Tone) return;
  Tone.context.lookAhead = 0.01;
  songVol = new Tone.Volume(0).toDestination();
  myVol = new Tone.Volume(0).toDestination();
  if (computerTone !== 'piano') { songTone = toneSynth(computerTone, songVol); myTone = toneSynth(computerTone, myVol); }

  // Plain synth until the piano samples arrive
  const synth = (out) => {
    const s = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0.15, release: 0.8 },
    }).connect(out);
    s.volume.value = -12;
    return s;
  };
  songSynth = synth(songVol);
  mySynth = synth(myVol);

  click = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } }).toDestination();
  click.volume.value = -8;

  const urls = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) for (const n of ['C', 'D#', 'F#', 'A']) urls[n + o] = n.replace('#', 's') + o + '.mp3';
  const buffers = new Tone.ToneAudioBuffers({
    urls,
    baseUrl: 'samples/', // Salamander Grand Piano samples, bundled for offline use
    onload: () => {
      const map = {};
      for (const k in urls) map[k] = buffers.get(k);
      songPiano = new Tone.Sampler({ urls: map, release: 1 }).connect(songVol);
      myPiano = new Tone.Sampler({ urls: map, release: 1 }).connect(myVol);
      ready = true;
    },
  });
}

export function unlock() {
  if (window.Tone && Tone.context.state !== 'running') Tone.start();
}

export function songNote(m, dur, vel, time) {
  if (midiOut) {
    if (songGain <= 0.001) return;
    const at = msToTone(time);
    midiOut.send([0x90 | SONG_CH, m, v127(vel, songGain)], at);
    midiOut.send([0x80 | SONG_CH, m, 0], at + Math.max(50, dur * 1000));
    return;
  }
  const v = songTone || (ready ? songPiano : songSynth);
  if (v) v.triggerAttackRelease(noteName(m), Math.max(0.05, dur), time, vel);
}
export const now = () => (window.Tone ? Tone.now() : 0);

// Returns the instrument so the caller can release the same one later
// fromKeyboard: the note came from the MIDI keyboard itself, which already makes its own sound
export function myNoteOn(m, vel, fromKeyboard = false) {
  if (midiOut) {
    if (!fromKeyboard) midiOut.send([0x90 | MY_CH, m, v127(vel, myGain)]);
    return 'midi';
  }
  const v = myTone || (ready ? myPiano : mySynth);
  if (v) v.triggerAttack(noteName(m), undefined, vel);
  return v;
}
export function myNoteOff(v, m) {
  if (v === 'midi') { if (midiOut) midiOut.send([0x80 | MY_CH, m, 0]); return; }
  if (v) v.triggerRelease(noteName(m));
}

export function stopSong() {
  if (midiOut) {
    midiOut.send([0xb0 | SONG_CH, 123, 0]);
    // Notes already queued a moment ahead can still start; silence them once more
    setTimeout(() => midiOut && midiOut.send([0xb0 | SONG_CH, 123, 0]), 450);
  }
  if (songPiano) songPiano.releaseAll();
  if (songSynth) songSynth.releaseAll();
  if (songTone) songTone.releaseAll();
}

export function metronome(accent) {
  if (midiOut) {
    // General MIDI wood blocks on the drum channel
    const note = accent ? 76 : 77, at = performance.now();
    midiOut.send([0x90 | DRUM_CH, note, accent ? 110 : 80], at);
    midiOut.send([0x80 | DRUM_CH, note, 0], at + 60);
    return;
  }
  if (click) click.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, undefined, accent ? 1 : 0.6);
}

const toDb = (g) => (g <= 0.001 ? -Infinity : 20 * Math.log10(g));
export function setVolumes(song, mine) {
  songGain = song;
  myGain = mine;
  if (!songVol) return;
  songVol.volume.value = toDb(song);
  myVol.volume.value = toDb(mine);
}
