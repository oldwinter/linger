// Content check for a built deck: lists each slide's text and fails when a
// slide has no text, still holds placeholder text, a photo appears on more
// than one slide, or the slide count differs from the expected one.
//   NODE_PATH="$(pwd)/agent/node_modules" node check_deck.js <deck.pptx> [--slides N]
// Uses JSZip, which comes with pptxgenjs.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const PLACEHOLDER = /\b(TODO|XXX|TBD|PLACEHOLDER|lorem|ipsum)\b|\[insert/i;
// A picture smaller than this share of the slide is a logo or an icon, which
// may repeat; a larger one is a photo, which may not.
const PHOTO_SHARE = 0.05;

function relationTargets(xml) {
  return new Map(
    [...xml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
}

async function readDeck(deckPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(deckPath));
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  const relations = relationTargets(
    await zip.file("ppt/_rels/presentation.xml.rels").async("string"),
  );
  const size = presentation.match(/<p:sldSz [^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const slideArea = size ? Number(size[1]) * Number(size[2]) : 0;
  const slides = [];
  // Slides in presentation order, skipping masters and layouts.
  for (const [, id] of presentation.matchAll(/<p:sldId [^>]*r:id="(rId\d+)"/g)) {
    const target = relations.get(id);
    const name = target && `ppt/${target.replace(/^\/?ppt\//, "")}`;
    const file = name && zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
    const relsFile = zip.file(`${path.posix.dirname(name)}/_rels/${path.posix.basename(name)}.rels`);
    const slideRelations = relsFile ? relationTargets(await relsFile.async("string")) : new Map();
    const photos = [];
    // A background picture fills the slide; a picture shape covers its extent.
    const pictures = [
      ...[...xml.matchAll(/<p:bg>[\s\S]*?r:embed="(rId\d+)"[\s\S]*?<\/p:bg>/g)].map((m) => [m[1], 1]),
      ...[...xml.matchAll(/<p:pic>([\s\S]*?)<\/p:pic>/g)].map((m) => {
        const embed = m[1].match(/r:embed="(rId\d+)"/);
        const ext = m[1].match(/<a:ext cx="(\d+)" cy="(\d+)"/);
        const share = ext && slideArea ? (Number(ext[1]) * Number(ext[2])) / slideArea : 1;
        return [embed && embed[1], share];
      }),
    ];
    for (const [embed, share] of pictures) {
      const media = embed && slideRelations.get(embed);
      if (!media || share < PHOTO_SHARE) continue;
      const mediaFile = zip.file(path.posix.normalize(path.posix.join(path.posix.dirname(name), media)));
      if (!mediaFile) continue;
      const hash = crypto.createHash("sha256").update(await mediaFile.async("nodebuffer")).digest("hex");
      photos.push({ hash, media: path.posix.basename(media) });
    }
    slides.push({ text: runs.join(" "), photos });
  }
  return slides;
}

async function main() {
  const [deckPath, flag, count] = process.argv.slice(2);
  if (!deckPath) {
    console.error("usage: node check_deck.js <deck.pptx> [--slides N]");
    process.exit(2);
  }
  const expected = flag === "--slides" ? Number(count) : undefined;
  const slides = await readDeck(deckPath);
  const problems = [];
  slides.forEach(({ text }, i) => {
    if (!text) problems.push(`slide ${i + 1}: no text`);
    const match = text.match(PLACEHOLDER);
    if (match) problems.push(`slide ${i + 1}: placeholder text "${match[0]}"`);
  });
  const photoSlides = new Map();
  slides.forEach(({ photos }, i) => {
    for (const { hash, media } of photos) {
      const seen = photoSlides.get(hash) ?? { media, slides: new Set() };
      seen.slides.add(i + 1);
      photoSlides.set(hash, seen);
    }
  });
  for (const { media, slides: used } of photoSlides.values()) {
    if (used.size > 1) {
      problems.push(`photo ${media} repeats on slides ${[...used].join(", ")}: give each slide its own photo, chart or diagram`);
    }
  }
  if (expected !== undefined && slides.length !== expected) {
    problems.push(`slide count: expected ${expected}, found ${slides.length}`);
  }

  console.log(`${deckPath}: ${slides.length} slides`);
  slides.forEach(({ text }, i) => console.log(`  ${String(i + 1).padStart(2)}  ${text.slice(0, 70)}`));
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    problems.forEach((problem) => console.log(`  - ${problem}`));
    process.exit(1);
  }
  console.log("\nno problems found");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
