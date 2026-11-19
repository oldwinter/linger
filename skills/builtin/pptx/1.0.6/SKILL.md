---
name: pptx
description: Create a new PowerPoint PPTX deck with PptxGenJS, to a professional visual standard. Use whenever a new slide deck is a deliverable. Covers the workflow from material and research to a per-slide brief, tested layouts and palettes, the design rules (images, charts, diagrams) and slide-by-slide render checks.
effort: high
---

# PowerPoint decks

A finished deck must look rich and professional: every slide carries a real
visual, not just a title and bullets. Read this whole file before building.

## Runtime

Nothing here is preinstalled; set up what the task needs yourself. Install
PptxGenJS into the current Context's `./agent` project:

```bash
npm --prefix ./agent install pptxgenjs
```

This skill's folder holds `scripts/deck_template.js` (the starting script,
with the shared title bar, footer and card helpers), `scripts/check_deck.js`
(a content check), and in `references/` the tested slide layouts
(`layouts.md`), the palettes (`palettes.md`) and PptxGenJS usage
(`pptxgenjs.md`). Copy the template into `./playground/<scope>/` and run
scripts from the Context workspace:

```bash
NODE_PATH="$(pwd)/agent/node_modules" node ./playground/<scope>/deck.js ./playground/<scope>/<Deck>.pptx
```

Keep work under `./playground/<scope>/`. If `npm` or a system tool named under
Check is missing, follow the install rule in your instructions: ask the user
whether to install it, and install nothing globally without their yes.

## Workflow

The brief decides the content: topic, audience, slide order and facts. These
steps decide how you work, and every one of them runs whatever the brief says,
including a brief that only says to search the web or already lists the
slides. If a step cannot run, say why in the report.

1. **Read the requirement.** Keep the slide order and the meaning of each
   headline it gives; take numbers only from sources you can cite.
2. **Find the Human's existing material first (required for every new deck).**
   Before any web research, use your workspace tools (the documents and files
   available to you, and the Human's knowledge search; see the `teamhub-files`
   skill and your instructions) to check what the Human already has:
   - documents, spreadsheets, slides and PDFs about the same project, team,
     company or period, including any named in the brief;
   - facts recorded in their chats, meetings and documents, searched from
     several angles (results, causes, plans, asks, people);
   - **images, logos, brand files, team or office photos** of the company.
     Knowledge search covers text only, so look for these among the files.
   When the topic plainly lies outside anything the Human keeps (public news
   about someone else, a general explainer), one knowledge search is enough:
   record the query and that nothing relevant came back.
   Count content only if it is about the same project and period; the
   company's own logo, brand images and team or office photos count for any
   deck about that company. Read everything relevant, and write the inventory
   (found / used / not used and why, with IDs) to
   `./playground/<scope>/material.md`.
3. **Research the gaps** on the web, citing every source.
4. **Write the brief before coding**, in one go now that the material and
   research are in. First read [brief-template.md](brief-template.md) in this
   skill's folder; it is not repeated here. Then write
   `./playground/<scope>/brief.md` in that structure: copy what the
   requirement gives, fill every field it lacks yourself, marked as inferred,
   and give every slide its claim headline, its layout (one from
   `references/layouts.md`, or a custom one with the reason) and its exact
   visual (which image, chart or diagram). A photo is named by its URL or
   file, not just "photo"; plan one on the cover and on about every third or
   fourth slide. When the requirement does not give the audience, goal,
   setting or main message (a one-line request, say), infer them: pick the
   goal the deck serves and use its order (decide: situation → problem →
   options → recommendation → ask; understand: why it matters → how it works →
   example → limits → summary; persuade: pain → promise → how → proof → call
   to action; update: headline numbers → what went well → what didn't → risks
   → next steps). Unless the requirement says otherwise, the audience is the
   Human reading it on their own, in the language of the request. Report every
   field you inferred as an assumption.
5. **Collect images** (see Images) into `./playground/<scope>/img/`: download
   every image the brief names and record each source. Drop a planned photo
   only after you tried every source in the Images order (official sources,
   at least two free photo libraries, then neutral photos) and found nothing
   usable; list each search (query, site, result) in `brief.md`.
6. **Build** only once every slide in `brief.md` has its layout and visual and
   every image it names is in `img/`, with one script copied from
   `scripts/deck_template.js`. Set `THEME` once from `references/palettes.md`,
   build each slide from its layout in `references/layouts.md` with the
   template's helpers, and see `references/pptxgenjs.md` for images, charts
   and tables, so every slide looks the same.
7. **Render and inspect every slide** (see Check), fix, and render again.
8. **Report**: file path, the paths of `material.md` and `brief.md`, one line
   per slide, the Human's material found / used / not used and why, other
   sources used, every assumption, every missing fact, and any check you could
   not run.

## Design rules

### Story on the slide
- Every content slide's title is a **claim** (a sentence stating its point),
  not a label. Reading the titles in order tells the story.
- Keep each title to one line (about 60 Latin characters or 30 CJK
  characters at 28 pt); shorten the wording rather than wrapping.
- One point per slide. At most ~40 words of body text on a presented slide;
  put detail in speaker notes.
- Every fact has a short source line at the bottom of its slide.
- A claim about a person's private life, an allegation, an investigation or
  a legal dispute needs its primary source or two independent reputable
  outlets that you actually read; a page you could not open does not count.
  Never open a deck with such a claim on one source; if you keep it, say on
  the slide that one outlet reports it.

### Visual first
- **Every slide has one visual anchor**: a photo, a native chart, a diagram
  (flow, timeline, matrix, structure), KPI tiles or a big number. A slide that
  is only a title and bullets is a defect, except a short agenda.
- **Pick the visual from the content**: numbers that compare or change → chart;
  a sequence or mechanism → flow or timeline; options or trade-offs → cards or
  matrix; one striking figure → big number; people, products, places, mood →
  photo. A deck usually mixes all of these; there is no fixed ratio, but a deck
  without photos, without charts where there are numbers, or without a diagram
  where there is a process is not finished.
- **Vary the layouts**: never three slides in a row with the same layout. Use a
  full-bleed photo cover, section dividers for decks over ~8 slides, half-slide
  image beside text, cards and full-width charts.
- Speaker notes (`slide.addNotes(...)`) on every slide when the brief asks for
  them.

### Images
- **Every deck has real photos**: the cover, and image-beside-text, section and
  card slides wherever they fit; beyond the cover, about every third or fourth
  slide carries a photo.
- Find them in this order:
  1. the Human's own images, logos and photos found in step 2 (use the
     company logo on the cover or footer when there is one);
  2. official sources about the topic (company newsroom or press kit, product
     pages, official logos);
  3. free photo libraries with a clear license (Unsplash, Pexels, Pixabay,
     Wikimedia Commons), searching for the topic;
  4. if nothing on-topic fits, **neutral photos** from those libraries
     (architecture, city skyline, office or meeting scenes, landscapes,
     abstract textures) matching the deck's mood and colors.
  Never leave an empty image area, and never use a tiny or blurry image
  stretched up.
- **Each photo appears once in a deck**; only the company logo repeats, at
  logo size. When the sources run out, use a chart, diagram or cards instead.
- **Always credit the source**: a small caption on the image ("Image: <site> /
  <author or page>") and the full URL in that slide's speaker notes; list all
  credits on the sources slide or in the notes.
- Download the largest reasonable size (≥1600 px wide for full-bleed). Fill
  the frame with `sizing: { type: "cover" }`; never distort. Put text over a
  photo only on a translucent dark overlay (a rectangle whose fill has a
  `transparency` of about 50).

### Charts
- Native, editable charts only (`slide.addChart`), never chart screenshots;
  style them as in `references/pptxgenjs.md`.
- Highlight what the headline claims in the accent color and keep the rest
  neutral grey; label values on the bars and remove gridlines and needless
  legends.
- One message per chart; the title says what the chart proves; source below.

### Diagrams
- Draw them with native shapes and connectors: flows of 3–6 steps, timelines,
  2×2 matrices only for two real dimensions, structure charts, cards, KPI
  tiles. Consistent corners, line weights and colors; highlight the step the
  slide is about.

### Look
- One style per deck: the one in the brief. Turn its name and description
  into exact colors, fonts and layout habits once at the top of the script,
  and use one accent color only for what the audience must notice. With no
  style given, pick the palette in `references/palettes.md` that fits the
  topic, never plain blue.

- 16:9 on the layouts' 10 × 5.625 in canvas, with their margins; nothing
  touches the edge except full-bleed photos and the layouts' own bands.
- Type: the sizes the layouts set (slide titles 20 pt, cover and closing
  titles 32–38 pt, body 10.5–14 pt, captions and sources 8–9 pt). Shorten
  text rather than shrinking it.
- **Size every text box to its content, for every viewer**: estimate the lines
  from characters per line at the chosen size, then make the box at least
  lines × font size × line height tall, plus its top and bottom insets, using
  1.2 for Latin text and 1.5 for Chinese, Japanese or Korean. Viewers such as
  web previews keep the stored box size and scroll or clip what does not fit,
  so never rely on auto-fit (`fit: "shrink"` or `"resize"`) to make room. Size
  cards to their text instead of leaving large empty areas. Keep footers to
  one short line.
- Chinese text: set `THEME.font` to a CJK font such as PingFang SC or
  Microsoft YaHei; `fontFace` sets the East Asian typeface too.

## Check (every slide)

First run the content check, which lists every slide's text and flags empty
slides, leftover placeholder text and a photo used on more than one slide:

```bash
NODE_PATH="$(pwd)/agent/node_modules" node <skill folder>/scripts/check_deck.js <deck.pptx> --slides <n>
```

Then render to images with LibreOffice (`soffice`) and Poppler (`pdftoppm`).
Both are system tools; check them first with `command -v soffice pdftoppm`:

```bash
soffice --headless --convert-to pdf --outdir <dir> <deck.pptx>
pdftoppm -png -r 80 <dir>/<deck>.pdf <dir>/slide
```

PyMuPDF in `./agent` (`uv --directory ./agent add pymupdf`) can turn the PDF
into images instead of `pdftoppm`. If `soffice` is missing, ask the user
whether to install LibreOffice, as the Runtime section says. If no renderer is
available, say so in the report.

Check in two levels, so slide images do not fill your context:

1. **Overview**: tile the slide images into contact sheets (with ImageMagick
   `montage` when `command -v montage` finds it, otherwise with Pillow in
   `./agent`; 4 per row, about 400 px wide each, up to 12 slides per sheet), open the
   sheets, and list the slides that look wrong or uncertain against the
   checklist below.
2. **Detail**: open the single-slide image only for those slides, fix them,
   re-render, and re-check only the slides you changed.

The checklist:

1. The title is a claim on one line; titles in order tell the story; order matches the brief.
2. The slide has a visual anchor; no three consecutive slides share a layout.
3. No text overflows its box, is cut off, overlaps, or touches the edge; footers stay on one line.
   LibreOffice grows auto-fit boxes, so a render can hide an overflow: also
   check in the script that every text box is at least as tall as the formula
   above.
4. No card, tile or text box is mostly empty; content fills its frame.
5. Images are sharp, not distorted, credited on the slide and in the notes.
6. Charts are native, labeled, and highlight what the title claims.
7. Text sizes are the ones the layouts set and stay within the word budget.
8. One style throughout: fonts, colors, title position, footer.
9. Every number has a source; nothing invented; gaps are marked visibly.
   Relevant material the Human already has is used, or the report says why
   not (off-topic, superseded).
10. Chinese text renders in a CJK font.
11. Speaker notes present when asked; the last slide states the ask or next step.

Fix every failure and render again before reporting.
