// Content check for a built deck: lists each slide's text and fails when a
// slide has no text, still holds placeholder text, or the slide count differs
// from the expected one.
//   NODE_PATH="$(pwd)/agent/node_modules" node check_deck.js <deck.pptx> [--slides N]
// Uses JSZip, which comes with pptxgenjs.

const fs = require("node:fs");
const JSZip = require("jszip");

const PLACEHOLDER = /\b(TODO|XXX|TBD|PLACEHOLDER|lorem|ipsum)\b|\[insert/i;

async function slideTexts(path) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path));
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  const relations = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
  const targets = new Map(
    [...relations.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]),
  );
  const texts = [];
  // Slides in presentation order, skipping masters and layouts.
  for (const [, id] of presentation.matchAll(/<p:sldId [^>]*r:id="(rId\d+)"/g)) {
    const target = targets.get(id);
    const file = target && zip.file(`ppt/${target.replace(/^\/?ppt\//, "")}`);
    if (!file) continue;
    const xml = await file.async("string");
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
    texts.push(runs.join(" "));
  }
  return texts;
}

async function main() {
  const [path, flag, count] = process.argv.slice(2);
  if (!path) {
    console.error("usage: node check_deck.js <deck.pptx> [--slides N]");
    process.exit(2);
  }
  const expected = flag === "--slides" ? Number(count) : undefined;
  const texts = await slideTexts(path);
  const problems = [];
  texts.forEach((text, i) => {
    if (!text) problems.push(`slide ${i + 1}: no text`);
    const match = text.match(PLACEHOLDER);
    if (match) problems.push(`slide ${i + 1}: placeholder text "${match[0]}"`);
  });
  if (expected !== undefined && texts.length !== expected) {
    problems.push(`slide count: expected ${expected}, found ${texts.length}`);
  }

  console.log(`${path}: ${texts.length} slides`);
  texts.forEach((text, i) => console.log(`  ${String(i + 1).padStart(2)}  ${text.slice(0, 70)}`));
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
