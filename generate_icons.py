import os
import math

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print('Pillow not installed. Run: pip install Pillow')
    raise SystemExit(1)

BG    = '#242424'
GOLD  = '#E8C547'
SIZES = [(192, 'icon-192.png'), (512, 'icon-512.png')]

FONT_PATHS = [
    'C:/Windows/Fonts/georgia.ttf',
    'C:/Windows/Fonts/georgiai.ttf',
    'C:/Windows/Fonts/times.ttf',
    '/System/Library/Fonts/Supplemental/Georgia.ttf',
    '/System/Library/Fonts/Times New Roman.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
]

def find_font(size):
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return None

def draw_star(draw, cx, cy, outer_r, inner_r, color):
    """4-pointed star (✦ shape)."""
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i - math.pi / 2
        r = outer_r if i % 2 == 0 else inner_r
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(pts, fill=color)

def generate(size, filename):
    img  = Image.new('RGB', (size, size), BG)
    draw = ImageDraw.Draw(img)

    font_size = int(size * 0.62)
    font = find_font(font_size)
    drawn = False

    if font:
        symbol = '✦'  # ✦
        try:
            bbox = draw.textbbox((0, 0), symbol, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            # Only use font rendering if the glyph is a meaningful size
            if w > size * 0.1 and h > size * 0.1:
                x = (size - w) // 2 - bbox[0]
                y = (size - h) // 2 - bbox[1]
                draw.text((x, y), symbol, fill=GOLD, font=font)
                drawn = True
        except Exception:
            pass

    if not drawn:
        outer = int(size * 0.36)
        inner = int(size * 0.13)
        draw_star(draw, size // 2, size // 2, outer, inner, GOLD)

    img.save(filename, 'PNG')
    method = 'font' if drawn else 'geometric fallback'
    print(f'Generated {filename} ({size}x{size}) via {method}')

for sz, fn in SIZES:
    generate(sz, fn)

print('Done. Upload icon-192.png and icon-512.png to GitHub along with the other files.')
