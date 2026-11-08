# WaPilot logo assets

These assets use the approved chat-bubble and short directional-pointer icon with the camel-case `WaPilot` wordmark.

## Variants

- `svg/wapilot-verde-vertical.svg` — green stacked lockup, transparent background
- `svg/wapilot-verde-carvao-vertical.svg` — green icon and charcoal wordmark, transparent background
- `svg/wapilot-negativo-vertical.svg` — white lockup on green background
- `svg/wapilot-preto-vertical.svg` — black lockup on white background
- `*-inline.svg` — horizontal lockups for each color variant
- `*-icone.svg` — icon-only versions
- `png/` — 1600 px raster companions

The white-on-green square icons (`wapilot-negativo-icone`, including the `-curvas` SVG) keep the mark at about 65% of the canvas width. They can be cropped to a centered circle without clipping the pointer, with at least 5% of the canvas width left as green padding inside the circle. Apply the circular mask to the full square without zooming in.

The SVGs contain outlined paths only; they do not depend on an installed font. The icon geometry lives in `source/icon-curves.svg`, while the wordmark is traced from the approved raster reference. The outputs are checked by rendering the SVGs back to PNG; `source/build.py` can regenerate the set.

## Site icons

Run `python3 assets/source/build-site-icons.py` from the repository root to regenerate the icons in `public/` from `svg/wapilot-negativo-icone.svg` (requires Pillow and `rsvg-convert`). Browser favicons use tighter framing for small sizes; the ICO contains separately rendered 16, 32 and 48 px frames. The Apple touch and 192/512 px installation icons use extra green padding, with the entire mark inside the [maskable safe zone](https://www.w3.org/TR/appmanifest/#icon-masks), a centered circle with radius 40% of the canvas width. The script checks the safe zone and ICO sizes before completing.
