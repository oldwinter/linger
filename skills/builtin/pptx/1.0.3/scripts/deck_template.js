// Starting point for a new deck. Copy it next to your outputs, set THEME from
// references/palettes.md, replace the sample slides with layouts from
// references/layouts.md, then run:
//   NODE_PATH="$(pwd)/agent/node_modules" node <copy>.js <output>.pptx
// Requires pptxgenjs in ./agent (npm --prefix ./agent install pptxgenjs).

const PptxGenJS = require("pptxgenjs");

// Colors are 6-digit hex without "#". font must cover every script in the deck:
// for Chinese text use a CJK font such as "PingFang SC" or "Microsoft YaHei".
const THEME = {
  main: "0070C0", // title bars and the strongest accents
  support: "003087", // subheadings and second-level accents
  ink: "1A1A1A", // body text and dark backgrounds
  paper: "FFFFFF", // light backgrounds and text on dark
  canvas: "F5F5F5", // soft slide and card backgrounds
  highlight: "FF6B35", // the one color for what must stand out
  font: "Calibri",
};

const FONT = THEME.font;

const deck = new PptxGenJS();
deck.layout = "LAYOUT_16x9"; // 10 x 5.625 in
deck.author = "Author";
deck.title = "Deck title";

// A new object on every call: PptxGenJS rewrites option objects in place.
function softShadow(blur, offset, opacity) {
  return { type: "outer", color: "000000", blur, offset, angle: 135, opacity };
}

// Colored band across the top of a content slide, with its title.
function titleBar(slide, heading, subheading) {
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.85,
    fill: { color: THEME.main }, line: { color: THEME.main },
  });
  slide.addText(heading, {
    x: 0.35, y: 0.08, w: 9.3, h: 0.48,
    fontSize: 20, fontFace: FONT, bold: true,
    color: THEME.paper, valign: "middle", margin: 0,
  });
  if (subheading) {
    slide.addText(subheading, {
      x: 0.35, y: 0.56, w: 9.3, h: 0.22,
      fontSize: 10, fontFace: FONT, color: "DDDDDD",
      valign: "middle", margin: 0,
    });
  }
}

// Thin band along the bottom with a label and the page number.
function pageFooter(slide, label, page) {
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0, y: 5.38, w: 10, h: 0.25,
    fill: { color: THEME.canvas }, line: { color: "E0E0E0" },
  });
  slide.addText(label || "", {
    x: 0.2, y: 5.39, w: 8.5, h: 0.22,
    fontSize: 8, fontFace: FONT, color: "888888", valign: "middle", margin: 0,
  });
  if (page) {
    slide.addText(String(page), {
      x: 9.4, y: 5.39, w: 0.4, h: 0.22,
      fontSize: 8, fontFace: FONT, color: "888888",
      align: "right", valign: "middle", margin: 0,
    });
  }
}

// White card with a colored strip down its left edge.
function accentCard(slide, x, y, w, h, heading, text, color) {
  const strip = color || THEME.main;
  slide.addShape(deck.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: THEME.paper }, line: { color: "E0E0E0", width: 0.5 },
    shadow: softShadow(4, 2, 0.08),
  });
  slide.addShape(deck.shapes.RECTANGLE, {
    x, y, w: 0.07, h,
    fill: { color: strip }, line: { color: strip },
  });
  if (heading) {
    slide.addText(heading, {
      x: x + 0.16, y: y + 0.1, w: w - 0.22, h: 0.28,
      fontSize: 11, fontFace: FONT, bold: true, color: THEME.ink, margin: 0,
    });
  }
  if (text) {
    slide.addText(text, {
      x: x + 0.16, y: y + (heading ? 0.42 : 0.1),
      w: w - 0.22, h: h - (heading ? 0.55 : 0.2),
      fontSize: 10, fontFace: FONT, color: "555555", wrap: true, margin: 0,
    });
  }
}

// ---- Sample slides: replace them with layouts from references/layouts.md.

// Cover
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.ink };
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.55, h: 5.625,
    fill: { color: THEME.main }, line: { color: THEME.main },
  });
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0.55, y: 0, w: 0.12, h: 5.625,
    fill: { color: THEME.highlight }, line: { color: THEME.highlight },
  });
  slide.addText("Deck title", {
    x: 1.0, y: 1.3, w: 8.5, h: 0.75,
    fontSize: 36, fontFace: FONT, bold: true, color: THEME.paper, margin: 0,
  });
  slide.addText("One-line subtitle", {
    x: 1.0, y: 2.15, w: 8.5, h: 0.4,
    fontSize: 18, fontFace: FONT, color: THEME.main, margin: 0,
  });
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 1.0, y: 2.7, w: 3.5, h: 0.05,
    fill: { color: THEME.highlight }, line: { color: THEME.highlight },
  });
  slide.addText("Author  |  Team  |  Date", {
    x: 1.0, y: 4.9, w: 8, h: 0.3,
    fontSize: 11, fontFace: FONT, color: "888888", margin: 0,
  });
}

// Four cards
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline for this slide", "Optional subheading");
  pageFooter(slide, "Deck title  |  Date", 2);
  accentCard(slide, 0.3, 1.1, 4.4, 1.6, "First point", "One or two lines on it.", THEME.main);
  accentCard(slide, 5.0, 1.1, 4.4, 1.6, "Second point", "One or two lines on it.", THEME.highlight);
  accentCard(slide, 0.3, 2.9, 4.4, 1.6, "Third point", "One or two lines on it.", THEME.support);
  accentCard(slide, 5.0, 2.9, 4.4, 1.6, "Fourth point", "One or two lines on it.", "2E7D32");
}

// Closing
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.main };
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 9.5, y: 0, w: 0.5, h: 5.625,
    fill: { color: THEME.highlight }, line: { color: THEME.highlight },
  });
  slide.addText("Closing line", {
    x: 0.5, y: 1.5, w: 8.5, h: 0.9,
    fontSize: 42, fontFace: FONT, bold: true, color: THEME.paper, margin: 0,
  });
  slide.addText("The one thing to remember, or the ask.", {
    x: 0.5, y: 2.7, w: 8.5, h: 0.5,
    fontSize: 16, fontFace: FONT, color: "DDDDDD", margin: 0,
  });
  slide.addText("Author  |  Team  |  Date", {
    x: 0.5, y: 5.0, w: 8.5, h: 0.3,
    fontSize: 10, fontFace: FONT, color: "AAAAAA", margin: 0,
  });
}

const output = process.argv[2] || "deck.pptx";
deck
  .writeFile({ fileName: output })
  .then(() => console.log(`wrote ${output}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
