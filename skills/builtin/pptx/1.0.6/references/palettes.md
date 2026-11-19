# Palettes

`THEME` at the top of the deck script holds the deck's colors and font. Colors
are 6-digit hex without `#`.

```javascript
const THEME = {
  main: "0070C0",      // title bars and the strongest accents
  support: "404040",   // subheadings and second-level accents
  ink: "1A1A1A",       // body text and dark backgrounds
  paper: "FFFFFF",     // light backgrounds and text on dark
  canvas: "F5F5F5",    // soft slide and card backgrounds
  highlight: "FF6B35", // the one color for what must stand out
  font: "Calibri",
};
```

## Choosing one

Use the brief's style when it names one or gives brand colors. Otherwise pick
the row whose purpose fits the deck; do not fall back to plain blue.

| Palette | main | support | highlight | ink | canvas | font | Fits |
|---|---|---|---|---|---|---|---|
| Corporate blue | `0070C0` | `003087` | `00B0F0` | `1A1A1A` | `F0F4F8` | Calibri | finance, enterprise |
| Executive dark | `1E2761` | `408EC6` | `7A2048` | `0A0A0A` | `F5F5F5` | Calibri | leadership, board |
| Tech green | `00897B` | `00695C` | `FF6F00` | `212121` | `F1F8F6` | Calibri | engineering, operations |
| Startup bold | `6C63FF` | `3D5AFE` | `FF6584` | `1A1A2E` | `F8F8FF` | Calibri | product, pitch |
| Minimal mono | `212121` | `616161` | `FF5252` | `000000` | `FAFAFA` | Calibri | design, consulting |
| Warm business | `B85042` | `E7E8D1` | `A7BEAE` | `2C2C2C` | `FDF6F0` | Georgia | retail, people, culture |
| Deep navy | `003153` | `005F73` | `EE9B00` | `001220` | `F0F4F8` | Calibri | healthcare, legal |
| Vivid orange | `E85D04` | `F48C06` | `023E8A` | `1A1A1A` | `FFF8F2` | Calibri | marketing, sales |

`paper` stays `FFFFFF` in every palette.

## Fonts

| Font | Feel | Notes |
|---|---|---|
| Calibri | clean, modern | the default; available almost everywhere |
| Arial | neutral, corporate | the universal fallback |
| Georgia | warm, editorial | suits people and culture topics |
| Trebuchet MS | friendly, rounded | suits product and startup topics |
| Cambria | formal serif | suits legal and finance topics |

A viewer without the chosen font falls back to another one, so check the
render. The font also sets the East Asian typeface: when the slides contain
Chinese, use a CJK font instead, such as "PingFang SC" or "Microsoft YaHei".

## Where each color goes

```javascript
// Title bar                → THEME.main
// Title bar text           → THEME.paper
// Slide background         → THEME.paper (or THEME.canvas)
// Card edge                → THEME.main (or THEME.highlight)
// Body text                → THEME.ink
// Muted text and captions  → "888888"
// Done, success            → "2E7D32"
// Open, warning            → THEME.highlight
// Dividers                 → "E0E0E0"
```
