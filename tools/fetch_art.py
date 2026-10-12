"""Look up album art and genre for every song in songs/index.json using the iTunes Search API.

    python3 tools/fetch_art.py

Results are cached in tools/art_cache.json (resumable; only missing songs are looked up), then
run tools/build_collection.py to merge them into songs/index.json. The API allows roughly
20 requests a minute, so a full run takes a while; it backs off automatically when throttled.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).with_name('art_cache.json')


def norm(text):
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    text = re.sub(r"[’'`]", '', text.replace('&', 'and'))
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def words(text):
    return set(norm(text).split())


def similarity(a, b):
    a, b = words(a), words(b)
    return len(a & b) / max(1, min(len(a), len(b))) if a and b else 0.0


def clean_title(title):
    title = re.sub(r'\s*[\(\[][^)\]]*[\)\]]', '', title)            # (Twilight Soundtrack), [Live]
    title = re.sub(r'\s+(ft\.?|feat\.?|featuring)\s.*$', '', title, flags=re.I)
    return title.split(' - ')[0].strip() or title


def main_artist(artist):
    return re.split(r',|&| x | ft\.? | feat\.? | and ', artist, flags=re.I)[0].strip()


def search(term):
    url = 'https://itunes.apple.com/search?' + urllib.parse.urlencode({'term': term, 'entity': 'song', 'limit': 8})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Keys/1.0'}), timeout=20) as r:
                return json.load(r).get('results', [])
        except urllib.error.HTTPError as e:
            if e.code in (403, 429, 503):
                time.sleep(30 * (attempt + 1))  # throttled: wait and retry
                continue
            return []
        except Exception:
            time.sleep(5)
    return []


def lookup(song):
    artist, title = song.get('artist', ''), clean_title(song['title'])
    term = f'{main_artist(artist)} {title}' if artist else title
    best, best_score = None, 0.0
    for r in search(term):
        t = similarity(title, r.get('trackName', ''))
        a = similarity(main_artist(artist), r.get('artistName', '')) if artist else 0.5
        score = t + a
        if t >= 0.6 and (a >= 0.5 or not artist) and score > best_score:
            best, best_score = r, score
    if not best:
        return {'art': '', 'genre': ''}
    art = re.sub(r'/\d+x\d+bb\.', '/300x300bb.', best.get('artworkUrl100', ''))
    return {'art': art, 'genre': best.get('primaryGenreName', '')}


def main():
    songs = json.loads((ROOT / 'songs' / 'index.json').read_text())['songs']
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    todo = [s for s in songs if s['file'] not in cache]
    print(f'{len(songs)} songs, {len(todo)} to look up', flush=True)
    for i, s in enumerate(todo, 1):
        cache[s['file']] = lookup(s)
        if i % 20 == 0 or i == len(todo):
            CACHE.write_text(json.dumps(cache, ensure_ascii=False))
            found = sum(1 for v in cache.values() if v['art'])
            print(f'{i}/{len(todo)} done, {found} with art', flush=True)
        time.sleep(3.1)  # stay under ~20 requests a minute
    CACHE.write_text(json.dumps(cache, ensure_ascii=False))


if __name__ == '__main__':
    sys.exit(main())
