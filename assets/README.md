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

The SVGs contain outlined paths only; they do not depend on an installed font. The icon geometry lives in `source/icon-curves.svg`, while the wordmark is traced from the approved raster reference. The outputs are checked by rendering the SVGs back to PNG; `source/build.py` can regenerate the set.
