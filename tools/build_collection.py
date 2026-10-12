"""Copy a folder of MIDI files into songs/ and write songs/index.json for the built-in collection.

    python3 tools/build_collection.py path/to/your/midi/folder

Re-run it whenever you add files to that folder. The index holds artist, title, level,
length, tempo and note count, so the library shows everything without opening each file.
"""
import json
import re
import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'songs'
MIDI_EXT = {'.mid', '.midi', '.kar'}


def read_varlen(data, i):
    value = 0
    while True:
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not b & 0x80:
            return value, i


def midi_stats(data):
    """Length in seconds, starting BPM and playable note count (drums excluded)."""
    if data[:4] != b'MThd':
        raise ValueError('not a MIDI file')
    hlen, = struct.unpack('>I', data[4:8])
    _fmt, ntrks, division = struct.unpack('>HHH', data[8:14])
    if division & 0x8000:
        raise ValueError('SMPTE timing not supported')
    ppq = division
    i = 8 + hlen
    tempos = []  # (tick, microseconds per quarter)
    last_tick = 0
    notes = 0
    for _ in range(ntrks):
        while i + 8 <= len(data) and data[i:i + 4] != b'MTrk':  # skip unknown chunks
            clen, = struct.unpack('>I', data[i + 4:i + 8])
            i += 8 + clen
        if i + 8 > len(data):
            break
        tlen, = struct.unpack('>I', data[i + 4:i + 8])
        j, end = i + 8, min(i + 8 + tlen, len(data))
        i = end
        tick, status = 0, 0
        while j < end:
            delta, j = read_varlen(data, j)
            tick += delta
            b = data[j]
            if b & 0x80:
                status = b
                j += 1
            if status == 0xFF:
                mtype = data[j]
                mlen, j = read_varlen(data, j + 1)
                if mtype == 0x51 and mlen == 3:
                    tempos.append((tick, int.from_bytes(data[j:j + 3], 'big')))
                if mtype == 0x2F:
                    break
                j += mlen
            elif status in (0xF0, 0xF7):
                slen, j = read_varlen(data, j)
                j += slen
            else:
                kind, chan = status & 0xF0, status & 0x0F
                size = 1 if kind in (0xC0, 0xD0) else 2
                if kind == 0x90 and data[j + 1] > 0 and chan != 9:
                    notes += 1
                if kind in (0x80, 0x90):
                    last_tick = max(last_tick, tick)
                j += size
    tempos.sort()
    if not tempos or tempos[0][0] > 0:
        tempos.insert(0, (0, 500000))
    seconds, prev_tick, prev_tempo = 0.0, 0, tempos[0][1]
    for t, us in tempos[1:]:
        if t >= last_tick:
            break
        seconds += (t - prev_tick) * prev_tempo / ppq / 1e6
        prev_tick, prev_tempo = t, us
    seconds += (last_tick - prev_tick) * prev_tempo / ppq / 1e6
    return seconds, round(60e6 / tempos[0][1]), notes


def parse_name(stem):
    name = re.sub(r'^MIDI File\s*-\s*', '', stem).strip()
    raw_level = ''
    m = re.search(r'\(([^()]*)\)\s*$', name)
    if m:
        raw_level = m.group(1)
        name = name[:m.start()].strip()
    low = raw_level.lower()
    if any(w in low for w in ('advanced', 'hard', 'impossible')):
        level = 'Advanced'
    elif 'intermediate' in low:
        level = 'Intermediate'
    elif 'medium' in low or 'normal' in low:
        level = 'Medium'
    elif 'easy' in low or 'beginner' in low:
        level = 'Easy'
    else:
        level = ''
    artist, title = '', name
    if ' - ' in name:
        artist, title = name.split(' - ', 1)
    return artist.strip(), title.strip(), level


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).expanduser()
    OUT.mkdir(exist_ok=True)
    art_path = Path(__file__).with_name('art_cache.json')
    art = json.loads(art_path.read_text()) if art_path.exists() else {}
    songs, skipped = [], []
    for f in sorted(src.rglob('*')):
        if not f.is_file() or f.suffix.lower() not in MIDI_EXT:
            continue
        rel = f.relative_to(src).as_posix()
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists() or dest.stat().st_size != f.stat().st_size:
            shutil.copy2(f, dest)
        try:
            dur, bpm, notes = midi_stats(dest.read_bytes())
        except Exception as e:  # unreadable file: keep it out of the collection
            skipped.append(f'{rel}: {e}')
            continue
        if notes == 0:
            skipped.append(f'{rel}: no notes')
            continue
        artist, title, level = parse_name(f.stem)
        nps = notes / dur if dur else 0
        diff = 1 if nps < 2 else 2 if nps < 4 else 3 if nps < 7 else 4 if nps < 11 else 5
        song = {'file': rel, 'artist': artist, 'title': title, 'level': level,
                'dur': round(dur, 1), 'bpm': bpm, 'notes': notes, 'diff': diff,
                'added': int(f.stat().st_mtime)}
        found = art.get(rel) or {}
        if found.get('art'):
            song['art'] = found['art']
        if found.get('genre'):
            song['genre'] = found['genre']
        songs.append(song)
    (OUT / 'index.json').write_text(json.dumps({'songs': songs}, ensure_ascii=False, separators=(',', ':')))
    with_art = sum(1 for x in songs if x.get('art'))
    print(f'{len(songs)} songs indexed into {OUT / "index.json"}, {with_art} with album art')
    for s in skipped:
        print('skipped', s)


if __name__ == '__main__':
    main()
