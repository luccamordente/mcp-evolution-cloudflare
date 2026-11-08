"""Render public site icons from the approved SVG. Requires Pillow and rsvg-convert."""
from io import BytesIO
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)
SOURCE = ROOT / 'assets/svg/wapilot-negativo-icone.svg'
PUBLIC = ROOT / 'public'


def canvas(inset):
    root = ET.parse(SOURCE).getroot()
    side = float(root.attrib['width']) - 2 * inset
    root.set('width', f'{side:.4f}')
    root.set('height', f'{side:.4f}')
    root.set('viewBox', f'{inset} {inset} {side:.4f} {side:.4f}')
    background = root.find(f'{{{NS}}}rect')
    background.set('x', str(inset))
    background.set('y', str(inset))
    background.set('width', f'{side:.4f}')
    background.set('height', f'{side:.4f}')
    return ET.tostring(root, encoding='utf-8')


def render(svg, size):
    png = subprocess.check_output(['rsvg-convert', '-w', str(size), '-h', str(size)], input=svg)
    return Image.open(BytesIO(png)).convert('RGB')


# Tighter framing keeps the browser-tab mark readable at 16 px.
favicon = canvas(25.6)
(PUBLIC / 'favicon.svg').write_bytes(favicon)
render(favicon, 96).save(PUBLIC / 'favicon-96x96.png')
frames = [render(favicon, size) for size in (16, 32, 48)]
frames[-1].save(PUBLIC / 'favicon.ico', sizes=[image.size for image in frames],
                append_images=frames[:-1])
assert Image.open(PUBLIC / 'favicon.ico').ico.sizes() == {(16, 16), (32, 32), (48, 48)}

# Installation masks can crop down to a centered circle with radius 40% of the canvas.
app_icon = canvas(-24)
for filename, size in [('apple-touch-icon.png', 180), ('web-app-manifest-192x192.png', 192),
                       ('web-app-manifest-512x512.png', 512)]:
    image = render(app_icon, size)
    assert all((x + .5 - size/2)**2 + (y + .5 - size/2)**2 <= (size * .4)**2
               for y in range(size) for x in range(size) if image.getpixel((x, y))[0] > 128), filename
    image.save(PUBLIC / filename)

print('Generated site icons; ICO sizes and maskable safe zone verified.')
