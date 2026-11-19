# PptxGenJS notes

## A deck in brief

```javascript
const PptxGenJS = require("pptxgenjs");

const deck = new PptxGenJS(); // one new instance per deck
deck.layout = "LAYOUT_16x9";
deck.author = "Author";
deck.title = "Deck title";

const slide = deck.addSlide();
slide.addText("Hello", { x: 0.5, y: 0.5, fontSize: 36, color: "363636" });

deck.writeFile({ fileName: "deck.pptx" });
```

Canvas sizes, in inches: `LAYOUT_16x9` 10 × 5.625 (the default and the one the
layouts use), `LAYOUT_16x10` 10 × 6.25, `LAYOUT_4x3` 10 × 7.5, `LAYOUT_WIDE`
13.3 × 7.5.

## Text

```javascript
slide.addText("Plain text", {
  x: 1, y: 1, w: 8, h: 2, fontSize: 24, fontFace: "Arial",
  color: "363636", bold: true, align: "center", valign: "middle",
});

// Letter spacing is charSpacing; letterSpacing is ignored.
slide.addText("SPACED", { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });

// Mixed formatting in one box
slide.addText([
  { text: "Bold ", options: { bold: true } },
  { text: "italic", options: { italic: true } },
], { x: 1, y: 3, w: 8, h: 1 });

// Several lines: breakLine on every run but the last
slide.addText([
  { text: "Line 1", options: { breakLine: true } },
  { text: "Line 2", options: { breakLine: true } },
  { text: "Line 3" },
], { x: 0.5, y: 0.5, w: 8, h: 2 });
```

A text box has inner padding by default. Set `margin: 0` when its text must
line up with a shape, line or image at the same x.

`fontFace` sets the Latin and the East Asian typeface together, so text in
Chinese needs a font that has Chinese glyphs (for example "PingFang SC" or
"Microsoft YaHei").

## Lists

```javascript
slide.addText([
  { text: "First", options: { bullet: true, breakLine: true } },
  { text: "Second", options: { bullet: true, breakLine: true } },
  { text: "Third", options: { bullet: true } },
], { x: 0.5, y: 0.5, w: 8, h: 3 });

// Indented and numbered items
{ text: "Sub-item", options: { bullet: true, indentLevel: 1 } }
{ text: "First", options: { bullet: { type: "number" }, breakLine: true } }
```

Use `bullet: true`, never a typed "•": the typed one shows a second bullet.

## Shapes

```javascript
slide.addShape(deck.shapes.RECTANGLE, {
  x: 0.5, y: 0.8, w: 1.5, h: 3.0,
  fill: { color: "FF0000" }, line: { color: "000000", width: 2 },
});
slide.addShape(deck.shapes.OVAL, { x: 4, y: 1, w: 2, h: 2, fill: { color: "0000FF" } });
slide.addShape(deck.shapes.LINE, {
  x: 1, y: 3, w: 5, h: 0, line: { color: "FF0000", width: 3, dashType: "dash" },
});

// Translucent fill (0 opaque, 100 invisible)
slide.addShape(deck.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2, fill: { color: "0088CC", transparency: 50 },
});

// Rounded corners need ROUNDED_RECTANGLE; rectRadius does nothing on RECTANGLE.
slide.addShape(deck.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2, fill: { color: "FFFFFF" }, rectRadius: 0.1,
});

// Shadow
slide.addShape(deck.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2, fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 },
});
```

| Shadow option | Values | Note |
|---|---|---|
| `type` | `"outer"`, `"inner"` | |
| `color` | 6-digit hex | no `#`, no alpha digits |
| `blur` | 0–100 pt | |
| `offset` | 0–200 pt | never negative: a negative offset corrupts the file |
| `angle` | 0–359° | where the shadow falls: 135 bottom-right, 270 up |
| `opacity` | 0.0–1.0 | the only place for shadow transparency |

To shadow upward, for a bar along the bottom, use `angle: 270` with a positive
offset. Gradient fills are not supported; use a gradient image as the
background instead.

## Images

```javascript
slide.addImage({ path: "img/photo.jpg", x: 1, y: 1, w: 5, h: 3 });            // file
slide.addImage({ path: "https://example.com/photo.jpg", x: 1, y: 1, w: 5, h: 3 }); // URL
slide.addImage({ data: "image/png;base64,iVBOR...", x: 1, y: 1, w: 5, h: 3 });  // base64

slide.addImage({
  path: "img/photo.jpg", x: 1, y: 1, w: 5, h: 3,
  rotate: 45, rounding: true, transparency: 50,
  flipH: true, flipV: false,
  altText: "What the image shows",
  hyperlink: { url: "https://example.com" },
});
```

Fit an image to its frame without distorting it:

```javascript
{ sizing: { type: "contain", w: 4, h: 3 } } // fits inside, keeps the ratio
{ sizing: { type: "cover", w: 4, h: 3 } }   // fills the frame, keeps the ratio, may crop
{ sizing: { type: "crop", x: 0.5, y: 0.5, w: 2, h: 2 } } // a chosen part
```

Or size it from its pixel ratio:

```javascript
const pixelWidth = 1978, pixelHeight = 923, height = 3.0;
const width = height * (pixelWidth / pixelHeight);
slide.addImage({ path: "img/photo.jpg", x: (10 - width) / 2, y: 1.2, w: width, h: height });
```

PNG, JPG and GIF work everywhere; SVG works in current PowerPoint.

## Backgrounds

```javascript
slide.background = { color: "F1F1F1" };
slide.background = { color: "FF3399", transparency: 50 };
slide.background = { path: "https://example.com/bg.jpg" };
slide.background = { data: "image/png;base64,iVBOR..." };
```

## Tables

```javascript
slide.addTable([
  ["Header 1", "Header 2"],
  ["Cell 1", "Cell 2"],
], {
  x: 1, y: 1, w: 8, h: 2,
  border: { pt: 1, color: "999999" }, fill: { color: "F1F1F1" },
});

// Styled header and merged cells
slide.addTable([
  [{ text: "Header", options: { fill: { color: "6699CC" }, color: "FFFFFF", bold: true } }, "Cell"],
  [{ text: "Merged", options: { colspan: 2 } }],
], { x: 1, y: 3.5, w: 8, colW: [4, 4] });
```

## Charts

```javascript
slide.addChart(deck.charts.BAR, [{
  name: "Sales", labels: ["Q1", "Q2", "Q3", "Q4"], values: [4500, 5500, 6200, 7100],
}], { x: 0.5, y: 0.6, w: 6, h: 3, barDir: "col", showTitle: true, title: "Quarterly sales" });

slide.addChart(deck.charts.LINE, [{
  name: "Temperature", labels: ["Jan", "Feb", "Mar"], values: [32, 35, 42],
}], { x: 0.5, y: 4, w: 6, h: 3, lineSize: 3, lineSmooth: true });

slide.addChart(deck.charts.PIE, [{
  name: "Share", labels: ["A", "B", "Other"], values: [35, 45, 20],
}], { x: 7, y: 1, w: 5, h: 4, showPercent: true });
```

The defaults look dated. A clean chart:

```javascript
slide.addChart(deck.charts.BAR, data, {
  x: 0.5, y: 1, w: 9, h: 4, barDir: "col",
  chartColors: ["0D9488", "14B8A6", "5EEAD4"],           // from the deck's palette
  chartArea: { fill: { color: "FFFFFF" }, roundedCorners: true },
  catAxisLabelColor: "64748B", valAxisLabelColor: "64748B", // quiet axis labels
  valGridLine: { color: "E2E8F0", size: 0.5 },             // light value grid only
  catGridLine: { style: "none" },
  showValue: true, dataLabelPosition: "outEnd", dataLabelColor: "1E293B",
  showLegend: false,                                       // one series needs no legend
});
```

Other useful options: `legendPos` (`"b"`, `"t"`, `"l"`, `"r"`, `"tr"`),
`lineSmooth` for line charts. Chart types: BAR, LINE, PIE, DOUGHNUT, SCATTER,
BUBBLE, RADAR. Data label positions: `"outEnd"`, `"inEnd"`, `"center"`.

## Slide masters

```javascript
deck.defineSlideMaster({
  title: "TITLE_SLIDE",
  background: { color: "283A5E" },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 1, y: 2, w: 8, h: 2 } } }],
});

const titleSlide = deck.addSlide({ masterName: "TITLE_SLIDE" });
titleSlide.addText("Title", { placeholder: "title" });
```

## What breaks a deck

1. A `#` in a color (`"#FF0000"`) corrupts the file; write `"FF0000"`.
2. Alpha digits in a color (`"00000020"`) corrupt the file; set `opacity` (or
   `transparency`) instead.
3. A typed bullet character doubles the bullet; use `bullet: true`.
4. Runs without `breakLine: true` run together on one line.
5. `lineSpacing` on bullets leaves large gaps; use `paraSpaceAfter`.
6. Reusing a deck instance mixes decks; create a new one each time.
7. Reusing an options object corrupts the second shape: PptxGenJS converts its
   values in place. Build a new object for every call, as `softShadow()` does.
8. A straight accent strip cannot cover rounded corners; put accent strips on
   `RECTANGLE` cards, not `ROUNDED_RECTANGLE`.
