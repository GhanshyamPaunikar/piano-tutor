"""Writes the starter songs that ship with the public edition of Piano Tutor.

    python3 tools/make_starter_songs.py

Six public-domain pieces in simple two-hand arrangements written for Piano Tutor, saved as
starter/*.mid plus starter/index.json (the same format as songs/index.json).
"""
import json
import struct
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'starter'
PPQ = 480
N = {name: 12 * (octave + 1) + step
     for octave in range(0, 8)
     for name, step in [(f'C{octave}', 0), (f'C#{octave}', 1), (f'D{octave}', 2), (f'D#{octave}', 3), (f'E{octave}', 4),
                        (f'F{octave}', 5), (f'F#{octave}', 6), (f'G{octave}', 7), (f'G#{octave}', 8), (f'A{octave}', 9),
                        (f'A#{octave}', 10), (f'B{octave}', 11)]}


def varlen(v):
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.insert(0, (v & 0x7F) | 0x80)
        v >>= 7
    return bytes(out)


def track(events, name):
    """events: (tick, kind, data) with kind 'on'/'off'/'meta'. Returns an MTrk chunk."""
    body = b'\x00\xff\x03' + varlen(len(name)) + name.encode()
    last = 0
    for tick, kind, data in sorted(events, key=lambda e: (e[0], e[1] == 'on')):
        body += varlen(tick - last)
        last = tick
        if kind == 'meta':
            body += data
        else:
            pitch, vel = data
            body += bytes([0x90 if kind == 'on' else 0x80, pitch, vel if kind == 'on' else 0])
    body += b'\x00\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(body)) + body


def part(seq, vel):
    """seq: list of (notes, beats); notes is a name, a list of names (chord) or None (rest)."""
    events, t = [], 0
    for notes, beats in seq:
        length = round(beats * PPQ)
        if notes:
            for n in notes if isinstance(notes, list) else [notes]:
                events.append((t, 'on', (N[n], vel)))
                events.append((t + length - 20, 'off', (N[n], 0)))
        t += length
    return events, t


def write_song(path, bpm, ts, right, left):
    us = round(60e6 / bpm)
    num, den = ts
    meta = [(0, 'meta', b'\xff\x51\x03' + us.to_bytes(3, 'big')),
            (0, 'meta', b'\xff\x58\x04' + bytes([num, {2: 1, 4: 2, 8: 3}[den], 24, 8]))]
    r, rt = part(right, 90)
    l, lt = part(left, 64)
    data = b'MThd' + struct.pack('>IHHH', 6, 1, 3, PPQ) + track(meta, 'Tempo') + track(r, 'Right hand') + track(l, 'Left hand')
    path.write_bytes(data)
    notes = sum(1 for e in r + l if e[1] == 'on')
    return max(rt, lt) / PPQ * 60 / bpm, notes


def bars(*groups):
    return [x for g in groups for x in g]


# ---- arrangements (quarter note = 1 beat) ----
ode_rh = bars(
    [('E4', 1), ('E4', 1), ('F4', 1), ('G4', 1)], [('G4', 1), ('F4', 1), ('E4', 1), ('D4', 1)],
    [('C4', 1), ('C4', 1), ('D4', 1), ('E4', 1)], [('E4', 1.5), ('D4', .5), ('D4', 2)],
    [('E4', 1), ('E4', 1), ('F4', 1), ('G4', 1)], [('G4', 1), ('F4', 1), ('E4', 1), ('D4', 1)],
    [('C4', 1), ('C4', 1), ('D4', 1), ('E4', 1)], [('D4', 1.5), ('C4', .5), ('C4', 2)])
ode_lh = bars([('C3', 4)], [('G2', 4)], [('C3', 4)], [('G2', 4)], [('C3', 4)], [('G2', 4)], [('C3', 4)], [('G2', 2), ('C3', 2)])

tw_rh = bars(
    [('C4', 1), ('C4', 1), ('G4', 1), ('G4', 1)], [('A4', 1), ('A4', 1), ('G4', 2)],
    [('F4', 1), ('F4', 1), ('E4', 1), ('E4', 1)], [('D4', 1), ('D4', 1), ('C4', 2)],
    [('G4', 1), ('G4', 1), ('F4', 1), ('F4', 1)], [('E4', 1), ('E4', 1), ('D4', 2)],
    [('G4', 1), ('G4', 1), ('F4', 1), ('F4', 1)], [('E4', 1), ('E4', 1), ('D4', 2)],
    [('C4', 1), ('C4', 1), ('G4', 1), ('G4', 1)], [('A4', 1), ('A4', 1), ('G4', 2)],
    [('F4', 1), ('F4', 1), ('E4', 1), ('E4', 1)], [('D4', 1), ('D4', 1), ('C4', 2)])
tw_lh = bars(
    [('C3', 4)], [('F3', 2), ('C3', 2)], [('F3', 2), ('C3', 2)], [('G2', 2), ('C3', 2)],
    [('C3', 2), ('F3', 2)], [('C3', 2), ('G2', 2)], [('C3', 2), ('F3', 2)], [('C3', 2), ('G2', 2)],
    [('C3', 4)], [('F3', 2), ('C3', 2)], [('F3', 2), ('C3', 2)], [('G2', 2), ('C3', 2)])

mary_rh = bars(
    [('E4', 1), ('D4', 1), ('C4', 1), ('D4', 1)], [('E4', 1), ('E4', 1), ('E4', 2)],
    [('D4', 1), ('D4', 1), ('D4', 2)], [('E4', 1), ('G4', 1), ('G4', 2)],
    [('E4', 1), ('D4', 1), ('C4', 1), ('D4', 1)], [('E4', 1), ('E4', 1), ('E4', 1), ('E4', 1)],
    [('D4', 1), ('D4', 1), ('E4', 1), ('D4', 1)], [('C4', 4)])
mary_lh = bars([('C3', 4)], [('C3', 4)], [('G2', 4)], [('C3', 4)], [('C3', 4)], [('C3', 4)], [('G2', 4)], [('C3', 4)])

jb_rh = bars(
    [('E4', 1), ('E4', 1), ('E4', 2)], [('E4', 1), ('E4', 1), ('E4', 2)],
    [('E4', 1), ('G4', 1), ('C4', 1.5), ('D4', .5)], [('E4', 4)],
    [('F4', 1), ('F4', 1), ('F4', 1.5), ('F4', .5)], [('F4', 1), ('E4', 1), ('E4', 1), ('E4', .5), ('E4', .5)],
    [('E4', 1), ('D4', 1), ('D4', 1), ('E4', 1)], [('D4', 2), ('G4', 2)],
    [('E4', 1), ('E4', 1), ('E4', 2)], [('E4', 1), ('E4', 1), ('E4', 2)],
    [('E4', 1), ('G4', 1), ('C4', 1.5), ('D4', .5)], [('E4', 4)],
    [('F4', 1), ('F4', 1), ('F4', 1), ('F4', 1)], [('F4', 1), ('E4', 1), ('E4', 1), ('E4', .5), ('E4', .5)],
    [('G4', 1), ('G4', 1), ('F4', 1), ('D4', 1)], [('C4', 4)])
jb_lh = bars([('C3', 4)], [('C3', 4)], [('C3', 4)], [('C3', 4)], [('F2', 4)], [('C3', 4)], [('G2', 4)], [('G2', 4)],
             [('C3', 4)], [('C3', 4)], [('C3', 4)], [('C3', 4)], [('F2', 4)], [('C3', 4)], [('G2', 4)], [('C3', 4)])

# Fur Elise, opening (3/8, sixteenth = 0.25 beat); a short rest first so the pickup ends bar 1
s = 0.25
fe_rh = bars(
    [(None, 4 * s), ('E5', s), ('D#5', s)],
    [('E5', s), ('D#5', s), ('E5', s), ('B4', s), ('D5', s), ('C5', s)],
    [('A4', 2 * s), (None, s), ('C4', s), ('E4', s), ('A4', s)],
    [('B4', 2 * s), (None, s), ('E4', s), ('G#4', s), ('B4', s)],
    [('C5', 2 * s), (None, s), ('E4', s), ('E5', s), ('D#5', s)],
    [('E5', s), ('D#5', s), ('E5', s), ('B4', s), ('D5', s), ('C5', s)],
    [('A4', 2 * s), (None, s), ('C4', s), ('E4', s), ('A4', s)],
    [('B4', 2 * s), (None, s), ('E4', s), ('C5', s), ('B4', s)],
    [('A4', 6 * s)])
fe_lh = bars(
    [(None, 6 * s)], [(None, 6 * s)],
    [('A2', s), ('E3', s), ('A3', s), (None, 3 * s)], [('E2', s), ('E3', s), ('G#3', s), (None, 3 * s)],
    [('A2', s), ('E3', s), ('A3', s), (None, 3 * s)], [(None, 6 * s)],
    [('A2', s), ('E3', s), ('A3', s), (None, 3 * s)], [('E2', s), ('E3', s), ('G#3', s), (None, 3 * s)],
    [('A2', s), ('E3', s), ('A3', s), (None, 3 * s)])

e = 0.5
mg_rh = bars(
    [('D5', 1), ('G4', e), ('A4', e), ('B4', e), ('C5', e)], [('D5', 1), ('G4', 1), ('G4', 1)],
    [('E5', 1), ('C5', e), ('D5', e), ('E5', e), ('F#5', e)], [('G5', 1), ('G4', 1), ('G4', 1)],
    [('C5', 1), ('D5', e), ('C5', e), ('B4', e), ('A4', e)], [('B4', 1), ('C5', e), ('B4', e), ('A4', e), ('G4', e)],
    [('F#4', 1), ('G4', e), ('A4', e), ('B4', e), ('G4', e)], [('A4', 3)])
mg_lh = bars([('G3', 2), ('A3', 1)], [('B3', 3)], [('C4', 3)], [('B3', 3)], [('A3', 3)], [('G3', 3)], [('D3', 3)], [('D3', 2), ('C3', 1)])

SONGS = [
    ('ode-to-joy.mid', 'Ode to Joy', 'Ludwig van Beethoven', 'Easy', 'Classical', 120, (4, 4), ode_rh, ode_lh),
    ('twinkle-twinkle.mid', 'Twinkle Twinkle Little Star', 'Traditional', 'Easy', "Children's Music", 100, (4, 4), tw_rh, tw_lh),
    ('mary-had-a-little-lamb.mid', 'Mary Had a Little Lamb', 'Traditional', 'Easy', "Children's Music", 110, (4, 4), mary_rh, mary_lh),
    ('jingle-bells.mid', 'Jingle Bells', 'James Lord Pierpont', 'Easy', 'Holiday', 120, (4, 4), jb_rh, jb_lh),
    ('fur-elise-opening.mid', 'Für Elise (opening)', 'Ludwig van Beethoven', 'Medium', 'Classical', 120, (3, 8), fe_rh, fe_lh),
    ('minuet-in-g.mid', 'Minuet in G', 'Christian Petzold', 'Easy', 'Classical', 110, (3, 4), mg_rh, mg_lh),
]


def main():
    OUT.mkdir(exist_ok=True)
    index = []
    now = int(time.time())
    for file, title, artist, level, genre, bpm, ts, rh, lh in SONGS:
        dur, notes = write_song(OUT / file, bpm, ts, rh, lh)
        nps = notes / dur
        index.append({'file': file, 'title': title, 'artist': artist, 'level': level, 'genre': genre,
                      'dur': round(dur, 1), 'bpm': bpm, 'notes': notes,
                      'diff': 1 if nps < 2 else 2 if nps < 4 else 3, 'added': now})
    (OUT / 'index.json').write_text(json.dumps({'songs': index}, ensure_ascii=False, indent=1))
    print(f'wrote {len(index)} starter songs to {OUT}')


if __name__ == '__main__':
    main()
