"""Records a tour of Piano Tutor frame by frame on a virtual clock, for the README animations.

    python3 serve.py                                       # in another terminal
    python3 tools/tour/record.py <tour_dir> [base_url]
    python3 tools/tour/build_media.py <tour_dir> docs/media

The tour plays "Until I Found You (Easy)" from the song collection in songs/, so record from a copy that has it.
Needs Playwright with Chromium; build_media.py also needs ffmpeg. notes.json marks where each scene starts.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1])
BASE = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:5173/'
FPS = 30
DT = 1000 / FPS
W, H, SCALE = 1280, 720, 1.5

# Virtual time: rAF, performance.now and timers advance only when the recorder steps a frame
CLOCK = r"""
(() => {
  let vt = 0;
  const rafs = [];
  let timers = [], seq = 1;
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  window.__virtual = false;
  performance.now = () => (window.__virtual ? vt : realNow());
  window.requestAnimationFrame = (cb) => { if (!window.__virtual) return realRaf(cb); rafs.push(cb); return rafs.length; };
  window.cancelAnimationFrame = () => {};
  window.__goVirtual = () => { vt = realNow(); window.__virtual = true; };
  const realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => {
    if (!window.__virtual) return realSet(fn, ms, ...a);
    const id = 1e9 + seq++;
    timers.push({ id, at: vt + (ms || 0), fn: () => fn(...a) });
    return id;
  };
  window.clearTimeout = (id) => { if (id > 1e9) timers = timers.filter((t) => t.id !== id); else realClear(id); };
  window.__step = (ms) => {
    vt += ms;
    const due = timers.filter((t) => t.at <= vt);
    timers = timers.filter((t) => t.at > vt);
    for (const t of due) t.fn();
    for (const cb of rafs.splice(0)) cb(vt);
  };
  window.__vt = () => vt;
})();
"""

# Every note the app sounds and each scene start, stamped with virtual time; the scene starts place the GIFs
HOOK = r"""
(() => {
  window.__notes = [];
  const log = (e) => window.__notes.push({ ...e, t: window.__vt() - window.__t0 });
  for (const C of [Tone.Sampler, Tone.PolySynth]) {
    const p = C.prototype;
    const ar = p.triggerAttackRelease, a = p.triggerAttack, r = p.triggerRelease;
    p.triggerAttackRelease = function (n, d, time, v) { log({ k: 'ar', n, d: Tone.Time(d).toSeconds(), v: v ?? 1 }); return this; };
    p.triggerAttack = function (n, time, v) { log({ k: 'a', n, v: v ?? 1 }); return this; };
    p.triggerRelease = function (n) { log({ k: 'r', n }); return this; };
  }
})();
"""

OVERLAY_CSS = """
#tourTitle { position: fixed; inset: 0; z-index: 999; display: grid; place-items: center; background: #0b0f16; opacity: 0;
  pointer-events: none; text-align: center; font-family: Inter, system-ui, sans-serif; color: #e9edf3; }
#tourTitle img { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 18px 50px rgba(79,123,255,.25); }
#tourTitle h1 { margin: 26px 0 10px; font-size: 64px; font-weight: 700; letter-spacing: -1.5px; }
#tourTitle p { margin: 0; font-size: 24px; color: #9aa8bb; }
#tourTitle .url { margin-top: 30px; font-size: 20px; color: #7fa6ff; font-weight: 600; }
#tourCap { position: fixed; left: 50%; top: 86px; z-index: 998; transform: translateX(-50%); padding: 12px 22px; border-radius: 14px;
  background: rgba(11,15,22,.86); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 600 22px Inter, system-ui, sans-serif; color: #fff; white-space: nowrap; opacity: 0; pointer-events: none; }
"""


def main():
    frames = OUT / 'frames'
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob('*.png'):
        f.unlink()
    n = 0
    pos = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=SCALE)
        page.add_init_script(CLOCK)
        page.goto(BASE + '#/library')
        page.wait_for_function('window.Tone && document.querySelectorAll("#songList .row").length > 5', timeout=30000)
        page.wait_for_timeout(1500)  # album art
        page.evaluate('Tone.loaded()')
        page.add_style_tag(content=OVERLAY_CSS)
        page.evaluate("""() => {
          const t = document.createElement('div'); t.id = 'tourTitle'; document.body.append(t);
          const c = document.createElement('div'); c.id = 'tourCap'; document.body.append(c);
          window.__goVirtual(); window.__t0 = window.__vt();
        }""")
        page.evaluate(HOOK)

        js = page.evaluate

        def shoot(count=1, each=None):
            nonlocal n
            for i in range(count):
                if each:
                    each(i, count)
                js(f'__step({DT})')
                pos.append(js('window.keys && keys.S.song && !keys.S.free ? [keys.S.t, keys.S.playing && !keys.S.waiting, keys.S.speed] : null'))
                page.screenshot(path=str(frames / f'{n:05d}.png'))
                n += 1

        def mark(name, click=False):
            js('(e) => window.__notes.push({ ...e, t: window.__vt() - window.__t0 })', {'k': 'mark', 'name': name})
            if click:
                js('(e) => window.__notes.push({ ...e, t: window.__vt() - window.__t0 })', {'k': 'mark', 'name': 'click'})

        def secs(s):
            return int(round(s * FPS))

        def title(html, seconds):
            js('(h) => { const t = document.getElementById("tourTitle"); t.innerHTML = h; }', html)
            total = secs(seconds)
            fade = secs(0.5)

            def each(i, c):
                o = min(1, (i + 1) / fade, (c - i) / fade)
                js(f'document.getElementById("tourTitle").style.opacity = {o:.3f}')
            shoot(total, each)
            js('document.getElementById("tourTitle").style.opacity = 0')

        def caption(text):
            js('(s) => { const c = document.getElementById("tourCap"); c.textContent = s; c.style.opacity = s ? 1 : 0; }', text)

        def wait_song():
            for _ in range(200):
                if js('!!(window.keys && keys.S.song && !document.querySelector("#player").hidden)'):
                    return
                js('__step(0)')
                page.wait_for_timeout(50)
            raise SystemExit('song did not open')

        icon = '<div><img src="icons/icon-512.png" alt=""><h1>Piano Tutor</h1><p>Learn piano with falling notes. Every key named.</p></div>'
        mark('intro')
        title(icon, 3.4)

        # Library: scroll the songs, then search
        mark('library')
        caption('2,000+ songs to learn, free')
        sc = '#library .lib-scroll'
        shoot(secs(2.6), lambda i, c: js(f'document.querySelector("{sc}").scrollTop = {i * 9}'))
        shoot(secs(0.4), lambda i, c: js(f'document.querySelector("{sc}").scrollTop = Math.max(0, document.querySelector("{sc}").scrollTop - 120)'))
        js('document.querySelector("#search").focus()')
        for ch in 'Until I Found You':
            page.keyboard.type(ch)
            shoot(2)
        shoot(secs(1.0))

        # Listen: notes fall, every key named
        mark('listen', click=True)
        js("""location.hash = '#/play/' + encodeURIComponent('c:MIDI File - Stephen Sanchez - Until I Found You (Easy).mid')""")
        wait_song()
        js("""(() => {
          const S = keys.S, first = S.song.notes[0].time;
          window.__beats = S.song.beats.map((b) => [b.time, b.accent]);
          window.__melody = S.song.notes.filter((n) => S.song.tracks[n.track].hand === 'R' && n.time < first + 9).map((n) => [n.midi, n.time - first, n.dur]);
          document.querySelector('#modeSeg [data-v=watch]').click(); keys.seek(first - 0.8); keys.play();
        })()""")
        caption('Watch the notes fall. Every key is named.')
        shoot(secs(9))

        # Practice: carries on from here; the song waits until the lit keys are played
        mark('practice', click=True)
        js('document.querySelector("#modeSeg [data-v=practice]").click(); document.querySelector("#handsSeg [data-v=R]").click(); keys.seek(keys.S.t); keys.play()')
        caption('Practice waits for you to play the right note')
        state = {'held': [], 'since': 0}

        def practice(i, c):
            waiting = js('keys.S.waiting')
            if state['held']:
                state['since'] += 1
                if state['since'] >= 6:
                    js('(ms) => ms.forEach((m) => keys.noteOff(m))', state['held'])
                    state['held'] = []
            elif waiting:
                state['since'] += 1
                if state['since'] >= 9:  # a moment of "your turn" before pressing
                    need = js('[...keys.S.chord.need]')
                    js('(ms) => ms.forEach((m) => keys.noteOn(m, 0.8))', need)
                    mark('hit')
                    state['held'] = need
                    state['since'] = 0
            else:
                state['since'] = 0
        shoot(secs(8.5), practice)
        if state['held']:
            js('(ms) => ms.forEach((m) => keys.noteOff(m))', state['held'])

        # Loops: the next two bars, nudged by a beat
        mark('loop', click=True)
        js("""(() => {
          document.querySelector('#handsSeg [data-v=both]').click(); document.querySelector('#modeSeg [data-v=watch]').click();
          const M = keys.S.song.measures; let k = M.findIndex((m) => m > keys.S.t + 0.3);
          keys.seek(M[k] + 0.05); document.querySelector('#loopBtn').click();
          keys.seek(M[k + 1] + 0.05); document.querySelector('#loopBtn').click(); keys.play();
        })()""")
        caption('Loop any bars. Nudge either end by a beat.')
        shoot(secs(2.2))
        mark('click')
        js('document.querySelector("#loopALater").click()')
        shoot(secs(1.3))
        mark('click')
        js('document.querySelector("#loopAEarlier").click()')
        shoot(secs(2.6))

        # Sheet music, carrying on after the loop
        mark('sheet', click=True)
        js('(() => { const b = keys.S.loopB; document.querySelector("#loopBtn").click(); document.querySelector("#sheetBtn").click(); keys.seek(b - 0.3); keys.play(); })()')
        caption('Sheet music scrolls above, note by note')
        shoot(secs(6.5))
        js('keys.pause(); document.querySelector("#sheetBtn").click()')

        # Free Play: the song's melody played by hand rises from the keys
        mark('free', click=True)
        js("location.hash = '#/free'")
        page.wait_for_function('!document.querySelector("#player").hidden && keys.S.free', timeout=10000)
        caption('Free Play: what you play rises from the keys')
        melody = js('window.__melody')
        ons = {}
        for m, t, d in melody:
            ons.setdefault(int(round(t * FPS)) + 4, []).append((m, max(4, int(round(d * FPS)))))
        offs = {}

        def free(i, c):
            for m, d in ons.get(i, []):
                js(f'keys.noteOn({m}, 0.8)')
                offs[m] = i + d
            for m, at in list(offs.items()):
                if at == i:
                    js(f'keys.noteOff({m})')
                    del offs[m]
        shoot(secs(6), free)
        for m in offs:
            js(f'keys.noteOff({m})')
        caption('')
        mark('end')

        end = ('<div><img src="icons/icon-512.png" alt=""><h1>Piano Tutor</h1><p>Free on Mac, Windows and the web.<br>'
               'Works with any MIDI keyboard, or your computer keys.</p><div class="url">ghanshyampaunikar.com/pianotutor</div></div>')
        title(end, 4.2)

        notes = js('window.__notes')
        (OUT / 'notes.json').write_text(json.dumps({'fps': FPS, 'frames': n, 'notes': notes, 'pos': pos, 'beats': js('window.__beats')}))
        browser.close()
    print(f'{n} frames, {n / FPS:.1f}s, {len(notes)} note events')


if __name__ == '__main__':
    main()
