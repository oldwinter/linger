# Slide layouts

Seven tested layouts on the 10 × 5.625 in canvas. Each block builds one slide
with `deck`, `THEME`, `FONT` and the helpers `titleBar`, `pageFooter`,
`accentCard` and `softShadow` from `scripts/deck_template.js`. Copy a block,
replace the sample text with the brief's content, and keep the positions and
sizes; shorten text rather than shrinking it.

| Layout | Use it for |
|---|---|
| `cover` | the first slide |
| `two-column` | a problem and its answer, before and after, a list beside a panel |
| `flow` | a process, a pipeline, steps in order |
| `cards` | four parallel points (2 × 2) |
| `metrics` | up to six numbers that matter |
| `phases` | three stages, a roadmap, next steps |
| `closing` | the last slide: what is done, what is open, the ask |

## cover

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.ink };

  // Two vertical stripes on the left edge
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
    fontSize: 38, fontFace: FONT, bold: true, color: THEME.paper, margin: 0,
  });
  slide.addText("One-line subtitle", {
    x: 1.0, y: 2.15, w: 8.5, h: 0.4,
    fontSize: 18, fontFace: FONT, color: THEME.main, margin: 0,
  });
  // Short rule under the subtitle
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 1.0, y: 2.7, w: 3.5, h: 0.05,
    fill: { color: THEME.highlight }, line: { color: THEME.highlight },
  });
  slide.addText("Presenter  |  Team  |  Date", {
    x: 1.0, y: 4.9, w: 8, h: 0.3,
    fontSize: 11, fontFace: FONT, color: "888888", margin: 0,
  });
}
```

## two-column

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline", "Optional subheading");
  pageFooter(slide, "Deck title  |  Date", 2);

  // Left: a heading over a short bullet list
  slide.addText("Left heading", {
    x: 0.35, y: 1.05, w: 4.4, h: 0.35,
    fontSize: 14, fontFace: FONT, bold: true, color: THEME.ink, margin: 0,
  });
  slide.addText([
    { text: "First point", options: { bullet: true, breakLine: true } },
    { text: "Second point", options: { bullet: true, breakLine: true } },
    { text: "Third point", options: { bullet: true } },
  ], {
    x: 0.35, y: 1.45, w: 4.4, h: 2.5,
    fontSize: 11, fontFace: FONT, color: THEME.ink,
  });

  // Right: a tinted panel with a colored top edge
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 5.1, y: 1.05, w: 4.55, h: 3.9,
    fill: { color: THEME.canvas }, line: { color: "E0E0E0" },
  });
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 5.1, y: 1.05, w: 4.55, h: 0.06,
    fill: { color: THEME.main }, line: { color: THEME.main },
  });
  slide.addText("Right heading", {
    x: 5.25, y: 1.15, w: 4.2, h: 0.35,
    fontSize: 13, fontFace: FONT, bold: true, color: THEME.main, margin: 0,
  });
  slide.addText("Text for the right panel.", {
    x: 5.25, y: 1.6, w: 4.2, h: 3.2,
    fontSize: 10.5, fontFace: FONT, color: "555555", wrap: true, margin: 0,
  });
}
```

## flow

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline", "How it works");
  pageFooter(slide, "Deck title  |  Date", 3);

  const steps = [
    { label: "Step 1\nInput", color: THEME.main },
    { label: "Step 2\nProcess", color: THEME.support },
    { label: "Step 3\nCheck", color: THEME.highlight },
    { label: "Step 4\nOutput", color: "2E7D32" },
  ];

  steps.forEach((step, i) => {
    const x = 0.5 + i * 2.3;
    slide.addShape(deck.shapes.RECTANGLE, {
      x, y: 1.8, w: 2.0, h: 0.9,
      fill: { color: THEME.canvas }, line: { color: step.color, width: 1.5 },
      shadow: softShadow(3, 1, 0.1),
    });
    slide.addText(step.label, {
      x, y: 1.8, w: 2.0, h: 0.9,
      fontSize: 11, fontFace: FONT, bold: true, color: step.color,
      align: "center", valign: "middle", margin: 0,
    });
    // Connector to the next step
    if (i < steps.length - 1) {
      slide.addShape(deck.shapes.RECTANGLE, {
        x: x + 2.0, y: 2.2, w: 0.28, h: 0.06,
        fill: { color: "888888" }, line: { color: "888888" },
      });
      slide.addText("▶", {
        x: x + 2.16, y: 2.12, w: 0.18, h: 0.22,
        fontSize: 9, fontFace: FONT, color: "888888", margin: 0,
      });
    }
  });
}
```

## cards

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline", "Four points");
  pageFooter(slide, "Deck title  |  Date", 4);

  const cards = [
    { heading: "First point", text: "One or two lines on it.", color: THEME.main },
    { heading: "Second point", text: "One or two lines on it.", color: THEME.highlight },
    { heading: "Third point", text: "One or two lines on it.", color: "2E7D32" },
    { heading: "Fourth point", text: "One or two lines on it.", color: THEME.support },
  ];

  cards.forEach((card, i) => {
    const column = i % 2;
    const row = Math.floor(i / 2);
    accentCard(slide,
      0.3 + column * 4.85, 1.1 + row * 1.9, 4.5, 1.7,
      card.heading, card.text, card.color);
  });
}
```

## metrics

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline", "The numbers");
  pageFooter(slide, "Deck title  |  Date", 5);

  const metrics = [
    { value: "98%", label: "Uptime", note: "Last 30 days", color: "2E7D32" },
    { value: "1.2s", label: "Response time", note: "P99", color: THEME.main },
    { value: "400+", label: "Tests passing", note: "Automated", color: THEME.highlight },
    { value: "12", label: "Rules active", note: "Enforced", color: THEME.support },
    { value: "< 5m", label: "Deploy time", note: "Per service", color: "6A1B9A" },
    { value: "Zero", label: "Incidents", note: "This quarter", color: "E65100" },
  ];

  metrics.forEach((metric, i) => {
    const x = 0.3 + (i % 3) * 3.2;
    const y = 1.1 + Math.floor(i / 3) * 1.9;
    slide.addShape(deck.shapes.RECTANGLE, {
      x, y, w: 3.0, h: 1.6,
      fill: { color: THEME.paper }, line: { color: "E0E0E0" },
      shadow: softShadow(3, 1, 0.08),
    });
    // Colored top edge
    slide.addShape(deck.shapes.RECTANGLE, {
      x, y, w: 3.0, h: 0.07,
      fill: { color: metric.color }, line: { color: metric.color },
    });
    slide.addText(metric.value, {
      x: x + 0.15, y: y + 0.15, w: 2.7, h: 0.65,
      fontSize: 30, fontFace: FONT, bold: true, color: metric.color, margin: 0,
    });
    slide.addText(metric.label, {
      x: x + 0.15, y: y + 0.82, w: 2.7, h: 0.3,
      fontSize: 11.5, fontFace: FONT, bold: true, color: THEME.ink, margin: 0,
    });
    slide.addText(metric.note, {
      x: x + 0.15, y: y + 1.15, w: 2.7, h: 0.3,
      fontSize: 9, fontFace: FONT, color: "888888", margin: 0,
    });
  });
}
```

## phases

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.paper };
  titleBar(slide, "Claim headline", "Three stages");
  pageFooter(slide, "Deck title  |  Date", 6);

  const phases = [
    { label: "STAGE 1\nNow", color: THEME.main,
      items: ["First action", "Second action", "Third action"] },
    { label: "STAGE 2\nNext", color: THEME.highlight,
      items: ["First action", "Second action", "Third action"] },
    { label: "STAGE 3\nLater", color: THEME.support,
      items: ["First action", "Second action", "Third action"] },
  ];

  phases.forEach((phase, i) => {
    const x = 0.3 + i * 3.2;
    slide.addShape(deck.shapes.RECTANGLE, {
      x, y: 1.05, w: 3.0, h: 3.8,
      fill: { color: THEME.canvas }, line: { color: phase.color, width: 1 },
      shadow: softShadow(4, 2, 0.08),
    });
    slide.addShape(deck.shapes.RECTANGLE, {
      x, y: 1.05, w: 3.0, h: 0.65,
      fill: { color: phase.color }, line: { color: phase.color },
    });
    slide.addText(phase.label, {
      x: x + 0.12, y: 1.1, w: 2.76, h: 0.55,
      fontSize: 11, fontFace: FONT, bold: true, color: THEME.paper,
      align: "center", valign: "middle", margin: 0,
    });
    phase.items.forEach((item, j) => {
      slide.addShape(deck.shapes.RECTANGLE, {
        x: x + 0.15, y: 1.85 + j * 0.82, w: 0.07, h: 0.42,
        fill: { color: phase.color }, line: { color: phase.color },
      });
      slide.addText(item, {
        x: x + 0.32, y: 1.82 + j * 0.82, w: 2.5, h: 0.52,
        fontSize: 10.5, fontFace: FONT, color: THEME.ink, wrap: true, margin: 0,
      });
    });
  });
}
```

## closing

```javascript
{
  const slide = deck.addSlide();
  slide.background = { color: THEME.main };

  // Stripe on the right edge
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 9.5, y: 0, w: 0.5, h: 5.625,
    fill: { color: THEME.highlight }, line: { color: THEME.highlight },
  });

  slide.addText("Summary", {
    x: 0.5, y: 0.4, w: 8, h: 0.65,
    fontSize: 32, fontFace: FONT, bold: true, color: THEME.paper, margin: 0,
  });
  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0.5, y: 1.1, w: 5, h: 0.05,
    fill: { color: THEME.paper }, line: { color: THEME.paper },
  });

  const done = ["Done item 1", "Done item 2", "Done item 3"];
  const open = ["Open item 1", "Open item 2"];

  slide.addText("Done", {
    x: 0.5, y: 1.25, w: 4.2, h: 0.32,
    fontSize: 13, fontFace: FONT, bold: true, color: "FFCCCC", margin: 0,
  });
  done.forEach((item, i) => {
    slide.addText("✓  " + item, {
      x: 0.5, y: 1.62 + i * 0.42, w: 4.5, h: 0.34,
      fontSize: 11, fontFace: FONT, color: THEME.paper, margin: 0,
    });
  });

  slide.addText("Open", {
    x: 5.3, y: 1.25, w: 3.8, h: 0.32,
    fontSize: 13, fontFace: FONT, bold: true, color: "FFCCCC", margin: 0,
  });
  open.forEach((item, i) => {
    slide.addText("◎  " + item, {
      x: 5.3, y: 1.62 + i * 0.42, w: 4.0, h: 0.34,
      fontSize: 11, fontFace: FONT, color: "FFE0E0", margin: 0,
    });
  });

  slide.addShape(deck.shapes.RECTANGLE, {
    x: 0.5, y: 4.2, w: 8.8, h: 0.05,
    fill: { color: THEME.paper }, line: { color: THEME.paper },
  });
  slide.addText("The ask or the next step.", {
    x: 0.5, y: 4.35, w: 8.8, h: 0.32,
    fontSize: 12, fontFace: FONT, bold: true, color: THEME.paper, margin: 0,
  });
  slide.addText("Presenter  |  Team  |  Date", {
    x: 0.5, y: 5.0, w: 8.8, h: 0.25,
    fontSize: 9, fontFace: FONT, color: "FF9999", margin: 0,
  });
}
```
