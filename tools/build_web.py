"""Builds the web version of Piano Tutor, with the full song collection, into a folder served at a sub-path.

    python3 tools/build_web.py ../ghanshyam/public/pianotutor --base /pianotutor/

The page is served at <base> without a trailing slash (e.g. ghanshyampaunikar.com/pianotutor), so paths that the
browser resolves against the page address are made absolute. Paths inside the CSS and between the JS modules
resolve against their own files and are left alone. With songs/ included the app runs as the personal edition:
no ads and no purchase.
"""
import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COPY = ['index.html', 'style.css', 'js', 'vendor', 'samples', 'fonts', 'icons', 'starter', 'songs']


def patch(path, pairs):
    text = path.read_text(encoding='utf-8')
    for old, new, count in pairs:
        found = text.count(old)
        if found != count:
            raise SystemExit(f'{path.name}: expected {count} of {old!r}, found {found}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out', type=Path)
    ap.add_argument('--base', default='/pianotutor/')
    args = ap.parse_args()
    base = '/' + args.base.strip('/') + '/'
    out = args.out.resolve()

    if not (ROOT / 'songs' / 'index.json').exists():
        raise SystemExit('songs/index.json is missing: the web version needs the song collection')
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in COPY:
        src = ROOT / name
        if src.is_dir():
            shutil.copytree(src, out / name, ignore=shutil.ignore_patterns('.DS_Store'))
        else:
            shutil.copy2(src, out / name)

    patch(out / 'index.html', [
        ('href="icons/', f'href="{base}icons/', 3),
        ('src="icons/', f'src="{base}icons/', 3),
        ('href="style.css', f'href="{base}style.css', 1),
        ('src="vendor/', f'src="{base}vendor/', 3),
        ('src="js/app.js', f'src="{base}js/app.js', 1),
    ])
    patch(out / 'js' / 'audio.js', [("baseUrl: 'samples/'", f"baseUrl: '{base}samples/'", 1)])
    patch(out / 'js' / 'library.js', [
        ('fetch(`${dir}/index.json`)', f'fetch(`{base}${{dir}}/index.json`)', 1),
        ('fetch(`${dir}/` + s.file', f'fetch(`{base}${{dir}}/` + s.file', 1),
    ])

    files = sum(1 for p in out.rglob('*') if p.is_file())
    size = sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
    print(f'Built {files} files, {size / 1e6:.1f} MB, into {out} (served at {base.rstrip("/")})')


if __name__ == '__main__':
    main()
