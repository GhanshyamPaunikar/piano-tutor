"""Builds the app icon and website favicons from desktop/build/icon-source.png.

    python3 desktop/make_icon.py

Trims the dark surround, rounds the corners (transparent outside), then writes:
  desktop/build/icon.png   1024 px app icon with the standard macOS margin
  icons/icon-*.png         full-bleed favicons and home-screen icons for the website
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
src = Image.open(HERE / 'build' / 'icon-source.png').convert('RGB')

# The icon tile is lighter than the black around it; crop to the tile
mask = src.convert('L').point(lambda v: 255 if v > 18 else 0).filter(ImageFilter.MedianFilter(5))
left, top, right, bottom = mask.getbbox()
side = max(right - left, bottom - top)
cx, cy = (left + right) / 2, (top + bottom) / 2
tile = src.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))


def rounded(img, size, radius_ratio=0.225):
    big = img.resize((size * 4, size * 4), Image.LANCZOS)
    m = Image.new('L', big.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big.width - 1, big.height - 1), radius=int(big.width * radius_ratio), fill=255)
    big.putalpha(m)
    return big.resize((size, size), Image.LANCZOS)


# App icon: 824 px tile centred on a transparent 1024 canvas (Apple's icon grid)
canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
canvas.alpha_composite(rounded(tile, 824), (100, 100))
canvas.save(HERE / 'build' / 'icon.png')

out = ROOT / 'icons'
out.mkdir(exist_ok=True)
for size in (32, 180, 192, 512):
    rounded(tile, size).save(out / f'icon-{size}.png')
rounded(tile, 64).save(out / 'favicon.png')
print('tile', tile.size, '-> desktop/build/icon.png and icons/')
