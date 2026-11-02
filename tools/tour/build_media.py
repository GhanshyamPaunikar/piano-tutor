"""Builds the README animations from the frames record.py saved.

    python3 tools/tour/build_media.py <tour_dir> <media_out_dir>

<tour_dir> holds frames/ and notes.json. Writes banner.gif, practice.gif, loop.gif, sheet.gif and
free-play.gif into <media_out_dir>. Uses ffmpeg from FFMPEG, PATH or the imageio-ffmpeg package.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

TOUR = Path(sys.argv[1])
MEDIA = Path(sys.argv[2])


def ffmpeg():
    exe = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg()
data = json.loads((TOUR / 'notes.json').read_text())
FPS = data['fps']
marks = {}
for e in data['notes']:
    if e['k'] == 'mark':
        marks.setdefault(e['name'], e['t'] / 1000)


def run(*args):
    subprocess.run([FF, '-loglevel', 'error', '-y', *args], check=True)


def gif(name, start, seconds, width=800, crop=None, fps=10):
    """A looping GIF of `seconds` from `start` (seconds into the tour)."""
    first = int(round(start * FPS))
    vf = f'fps={fps}'
    if crop:
        vf += f',crop={crop}'
    vf += f',scale={width}:-1:flags=lanczos'
    src = ['-framerate', str(FPS), '-start_number', str(first), '-i', str(TOUR / 'frames' / '%05d.png'), '-t', str(seconds)]
    palette = TOUR / f'{name}-palette.png'
    run(*src, '-vf', f'{vf},palettegen=max_colors=96:stats_mode=diff', str(palette))
    run(*src, '-i', str(palette), '-lavfi', f'{vf}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle',
        '-loop', '0', str(MEDIA / f'{name}.gif'))
    palette.unlink()
    print(f'{name}.gif {(MEDIA / f"{name}.gif").stat().st_size // 1024} KB')


if __name__ == '__main__':
    MEDIA.mkdir(parents=True, exist_ok=True)
    # Frames are 1920x1080; the banner keeps the falling notes and keys, without the top bar and the controls
    gif('banner', marks['listen'] + 1.2, 4.0, width=960, crop='1920:664:0:110')
    gif('practice', marks['practice'] + 0.3, 6.0)
    gif('loop', marks['loop'] + 0.2, 5.6)
    gif('sheet', marks['sheet'] + 0.3, 5.0)
    gif('free-play', marks['free'] + 0.2, 5.4)
