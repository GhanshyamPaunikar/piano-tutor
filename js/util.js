export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const SOLFEGE = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
// iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). Apple allows no Web MIDI in any browser there.
export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const NO_MIDI_IOS = 'iPhone and iPad browsers can’t use MIDI keyboards, not even Chrome: Apple doesn’t allow it. Open this page in the free “Web MIDI Browser” app from the App Store to play with your keyboard. The on-screen keys work everywhere.';
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
export const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

export const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// First index whose .time >= t (arrays sorted by time)
export const lowerBound = (arr, t, key = 'time') => {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
};

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
