"""Generate standalone vector assets from the two approved raster references.

Requires Pillow, potrace and rsvg-convert. No font dependency in logo assets.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter
import subprocess
import xml.etree.ElementTree as ET
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT.parents[1] / 'imagegen'
NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])


def trace(name, filename, region):
    image = Image.open(REFERENCES / filename).convert('L').crop(region)
    image = image.filter(ImageFilter.GaussianBlur(0.35))
    mask = image.point(lambda value: 0 if value < 128 else 255, '1')
    bbox = ImageOps.invert(mask.convert('L')).getbbox()
    mask = ImageOps.expand(mask.crop(bbox), 2, 255)
    pbm = ROOT / 'source' / f'{name}.pbm'
    raw = ROOT / 'source' / f'{name}-traced.svg'
    mask.save(pbm)
    subprocess.run(['potrace', str(pbm), '-s', '-o', str(raw),
                    '--turdsize', '8', '--alphamax', '0.65', '--opttolerance', '0.12',
                    '--unit', '100'], check=True)
    svg = ET.parse(raw).getroot()
    group = svg.find(NS + 'g')
    group.attrib.pop('fill', None)
    group.attrib.pop('stroke', None)
    width, height = mask.size
    body = ET.tostring(group, encoding='unicode')
    # Check that smoothing retains the selected silhouette.
    png = ROOT / 'source' / f'{name}-traced.png'
    subprocess.run(['rsvg-convert', '-w', str(width), '-h', str(height),
                    '-o', str(png), str(raw)], check=True)
    rendered = Image.open(png).convert('RGBA').getchannel('A')
    target = ImageOps.invert(mask.convert('L'))
    a = [p >= 128 for p in rendered.get_flattened_data()]
    b = [p >= 128 for p in target.get_flattened_data()]
    overlap = sum(x and y for x, y in zip(a, b)) / sum(x or y for x, y in zip(a, b))
    assert overlap > 0.985, (name, overlap)
    return dict(body=body, width=width, height=height, overlap=overlap)


# Icon from the explicitly approved single-logo image; lettering from camel-case 01.
icon = trace('icon', 'wapilot-logo-final-01.png', (520, 175, 1010, 650))
word = trace('wordmark', 'wapilot-wordmarks-camelcase.png', (90, 340, 470, 435))


def shape(asset, x, y, height, color):
    scale = height / asset['height']
    return f'<g fill="{color}" transform="translate({x:.4f} {y:.4f}) scale({scale:.8f})">{asset["body"]}</g>'


def layout(kind, ic, wc):
    if kind == 'vertical':
        ih, wh, gap, pad = 240, 64, 28, 32
        iw, ww = icon['width'] * ih / icon['height'], word['width'] * wh / word['height']
        width, height = max(iw, ww) + pad * 2, ih + gap + wh + pad * 2
        body = shape(icon, (width-iw)/2, pad, ih, ic) + shape(word, (width-ww)/2, pad+ih+gap, wh, wc)
    elif kind == 'inline':
        ih, wh, gap, pad = 96, 56, 24, 24
        iw, ww = icon['width'] * ih / icon['height'], word['width'] * wh / word['height']
        width, height = pad * 2 + iw + gap + ww, ih + pad * 2
        body = shape(icon, pad, pad, ih, ic) + shape(word, pad+iw+gap, (height-wh)/2, wh, wc)
    else:
        ih, pad = 240, 24
        iw = icon['width'] * ih / icon['height']
        width = height = max(iw, ih) + pad * 2
        body = shape(icon, (width-iw)/2, (height-ih)/2, ih, ic)
    return width, height, body


def document(width, height, body, title, background=None):
    bg = f'<rect width="100%" height="100%" fill="{background}"/>' if background else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.4f}" height="{height:.4f}" '
            f'viewBox="0 0 {width:.4f} {height:.4f}" role="img" aria-labelledby="title">'
            f'<title id="title">{title}</title>{bg}{body}</svg>')


variants = [
    ('verde', '#25D366', '#25D366', None, '01 · Verde'),
    ('verde-carvao', '#25D366', '#111A20', None, '02 · Verde e carvão'),
    ('negativo', '#FFFFFF', '#FFFFFF', '#25D366', '03 · Branco sobre verde'),
    ('preto', '#000000', '#000000', '#FFFFFF', '04 · Preto sobre branco'),
]
preview = []
manifest = {'colors': {'green': '#25D366', 'charcoal': '#111A20', 'black': '#000000', 'white': '#FFFFFF'},
            'source_overlap': {k: v['overlap'] for k, v in [('icon', icon), ('wordmark', word)]}, 'assets': []}
for row, (name, ic, wc, bg, label) in enumerate(variants):
    cellx, celly = (row % 2) * 640, (row // 2) * 590
    preview.append(f'<rect x="{cellx}" y="{celly}" width="640" height="590" fill="{bg or "#FFFFFF"}"/>')
    for kind in ('vertical', 'inline', 'icone'):
        width, height, body = layout(kind, ic, wc)
        svg = ROOT / 'svg' / f'wapilot-{name}-{kind}.svg'
        svg.write_text(document(width, height, body, f'WaPilot — {name}, {kind}', bg))
        # Full-size PNG companions rendered from the actual vectors.
        subprocess.run(['rsvg-convert', '-w', '1600', '-o', str(ROOT/'png'/f'{svg.stem}.png'), str(svg)], check=True)
        root = ET.parse(svg).getroot()
        assert not any(root.iter(NS+'text'))
        assert not any(root.iter(NS+'image'))
        assert not any(root.iter(NS+'script'))
        assert len(list(root.iter(NS+'path'))) > 0
        manifest['assets'].append(str(svg.relative_to(ROOT)))
        if kind != 'icone':
            targetw = 380 if kind == 'vertical' else 490
            scale = targetw / width
            x = cellx + (640-targetw)/2
            y = celly + (20 if kind == 'vertical' else 410)
            preview.append(f'<g transform="translate({x} {y}) scale({scale})">{body}</g>')
    preview.append(f'<text x="{cellx+320}" y="{celly+564}" fill="{wc}" text-anchor="middle" font-family="sans-serif" font-size="16">{label}</text>')
preview.append('<path d="M640 0V1180M0 590H1280" fill="none" stroke="#DDE2DF"/>')
(ROOT/'preview.svg').write_text(document(1280, 1180, ''.join(preview), 'WaPilot — quatro cores, vertical e inline'))
subprocess.run(['rsvg-convert', '-o', str(ROOT/'preview.png'), str(ROOT/'preview.svg')], check=True)
(ROOT/'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'assets': len(manifest['assets']), 'source_overlap': manifest['source_overlap']}, indent=2))
